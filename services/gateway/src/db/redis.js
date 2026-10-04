const crypto = require("crypto");
const redis = require("redis");
const config = require("../config");

let client = null;
const memoryCache = new Map();
const memoryTasks = new Map();

async function connectRedis() {
  if (client && client.isOpen) return client;

  try {
    client = redis.createClient({
      url: config.redis.url,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => {
          if (retries > 5) return new Error("Redis reconnect attempts exceeded");
          return Math.min(retries * 500, 3000);
        },
      },
    });

    client.on("error", (err) => {
      // Avoid spamming logs if offline in local standalone mode
    });

    client.on("connect", () => {
      console.log(`[Redis] Connected successfully to Redis at: ${config.redis.url}`);
    });

    await client.connect();
    return client;
  } catch (err) {
    console.warn(`[Redis Warning] Could not connect to Redis (${err.message}). Using resilient in-memory fallback cache.`);
    client = null;
    return null;
  }
}

/**
 * Generates deterministic SHA-256 fingerprint for a semantic query
 */
function generateQueryHash(query, topK = 10, minScore = 0.25, videoId = null) {
  const normalizedQuery = (query || "").trim().toLowerCase().replace(/\s+/g, " ");
  const formattedScore = parseFloat(minScore || 0).toFixed(4);
  const canonical = `q=${normalizedQuery}|k=${parseInt(topK, 10)}|s=${formattedScore}|v=${videoId || "all"}`;
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Retrieves cached semantic query result directly from Redis with sub-10ms response time
 */
async function getCachedSearch(queryHash) {
  const start = Date.now();
  const cacheKey = `cache:search:${queryHash}`;

  try {
    if (client && client.isOpen) {
      const data = await client.get(cacheKey);
      if (data) {
        const latencyMs = Date.now() - start;
        const parsed = JSON.parse(data);
        return {
          ...parsed,
          cache_hit: true,
          cached_at_layer: "GATEWAY_REDIS",
          execution_time_ms: latencyMs,
        };
      }
      return null;
    }

    // In-memory fallback
    const memEntry = memoryCache.get(cacheKey);
    if (memEntry && Date.now() < memEntry.expiresAt) {
      const latencyMs = Date.now() - start;
      return {
        ...memEntry.data,
        cache_hit: true,
        cached_at_layer: "GATEWAY_MEMORY_FALLBACK",
        execution_time_ms: latencyMs,
      };
    }
    return null;
  } catch (err) {
    console.error("[Redis Read Error]", err.message);
    return null;
  }
}

/**
 * Persists query results into Redis with TTL
 */
async function setCachedSearch(queryHash, data, ttlSeconds = null) {
  const cacheKey = `cache:search:${queryHash}`;
  const ttl = ttlSeconds || config.redis.cacheTTLSeconds;

  try {
    const serialized = JSON.stringify(data);
    if (client && client.isOpen) {
      await client.set(cacheKey, serialized, { EX: ttl });
    } else {
      memoryCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttl * 1000,
      });
    }
  } catch (err) {
    console.error("[Redis Write Error]", err.message);
  }
}

/**
 * Non-blocking pattern invalidation when new videos or incidents are indexed
 */
async function invalidateSearchCache(pattern = "cache:search:*") {
  try {
    let deletedCount = 0;
    if (client && client.isOpen) {
      for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        await client.del(key);
        deletedCount++;
      }
      console.log(`[Redis Invalidation] Cleared ${deletedCount} cached semantic search entries.`);
      return deletedCount;
    }

    deletedCount = memoryCache.size;
    memoryCache.clear();
    return deletedCount;
  } catch (err) {
    console.error("[Redis Invalidation Error]", err.message);
    return 0;
  }
}

/**
 * Retrieves asynchronous task tracking status directly from Redis
 */
async function getTaskStatus(taskId) {
  const key = `task:status:${taskId}`;
  try {
    if (client && client.isOpen) {
      const data = await client.hGetAll(key);
      if (data && Object.keys(data).length > 0) {
        return {
          task_id: data.task_id || taskId,
          video_id: data.video_id,
          status: data.status || "UNKNOWN",
          stage: data.stage || "UNKNOWN",
          progress_percentage: parseFloat(data.progress_percentage || 0),
          current_frame: parseInt(data.current_frame || 0, 10),
          total_frames: parseInt(data.total_frames || 0, 10),
          error: data.error || null,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
      }
      return null;
    }

    return memoryTasks.get(taskId) || null;
  } catch (err) {
    console.error("[Redis Task Read Error]", err.message);
    return null;
  }
}

module.exports = {
  connectRedis,
  generateQueryHash,
  getCachedSearch,
  setCachedSearch,
  invalidateSearchCache,
  getTaskStatus,
};
