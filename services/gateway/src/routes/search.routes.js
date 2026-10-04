const express = require("express");
const axios = require("axios");
const postgres = require("../db/postgres");
const redisDb = require("../db/redis");
const mongoDb = require("../db/mongo");
const config = require("../config");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();

/**
 * POST /api/v1/search/semantic
 * Accessible by both ADMIN and AUDITOR roles.
 *
 * Performance Pipeline:
 * 1. Hashes query (SHA-256) and probes Redis cache directly (sub-10ms latency).
 * 2. On Cache Hit: returns immediately from Redis without downstream AI Engine load.
 * 3. On Cache Miss: forwards to FastAPI AI Engine (/internal/v1/search).
 * 4. Hydrates results with PostgreSQL incident records and MongoDB detection coordinates.
 * 5. Caches output in Redis with TTL and logs immutable audit trail in PostgreSQL.
 */
router.post("/semantic", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  const { query, top_k, min_score, video_id } = req.body;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: "Search query must be at least 2 characters long." });
  }

  const topK = top_k ? parseInt(top_k, 10) : 10;
  const minScore = min_score !== undefined ? parseFloat(min_score) : 0.25;
  const videoFilter = video_id || null;
  const queryHash = redisDb.generateQueryHash(query, topK, minScore, videoFilter);

  // 1. Direct Redis Cache Check (Sub-10ms target)
  const cached = await redisDb.getCachedSearch(queryHash);
  if (cached) {
    // Asynchronously log audit trail in PostgreSQL
    postgres.logAuditTrail(
      req.user.id,
      "SEMANTIC_SEARCH_HIT",
      "search_cache",
      null,
      {
        query: query.trim(),
        query_hash: queryHash,
        results_count: cached.results_count,
        latency_ms: cached.execution_time_ms,
      },
      req.ip
    );

    return res.json(cached);
  }

  // 2. Cache Miss: Forward request to FastAPI AI Engine
  const requestStart = Date.now();
  try {
    const aiResponse = await axios.post(
      `${config.aiEngineUrl}/search`,
      {
        query: query.trim(),
        top_k: topK,
        min_score: minScore,
        video_id: videoFilter,
      },
      { timeout: 8000 }
    );

    const searchData = aiResponse.data;

    // 3. Hydrate matched incidents from PostgreSQL
    if (searchData.results && searchData.results.length > 0) {
      const incidentIds = searchData.results
        .map((r) => r.incident_id)
        .filter((id) => id !== null && id !== undefined);

      if (incidentIds.length > 0) {
        const incidentQuery = await postgres.query(
          "SELECT id, title, description, severity, status FROM incidents WHERE id = ANY($1::uuid[])",
          [incidentIds]
        );
        const incidentMap = new Map();
        incidentQuery.rows.forEach((row) => incidentMap.set(row.id, row));

        searchData.results = searchData.results.map((r) => ({
          ...r,
          incident_details: r.incident_id ? incidentMap.get(r.incident_id) || null : null,
        }));
      }

      // If detection coordinates are missing or require enrichment from MongoDB
      for (const item of searchData.results) {
        if (!item.detections || item.detections.length === 0) {
          const telemetryDoc = await mongoDb.getFrameTelemetry(item.video_id, item.frame_index);
          if (telemetryDoc && telemetryDoc.detections) {
            item.detections = telemetryDoc.detections;
          }
        }
      }
    }

    const totalLatencyMs = Date.now() - requestStart;
    searchData.execution_time_ms = totalLatencyMs;
    searchData.cached_at_layer = "NONE (FRESH_EVALUATION)";

    // 4. Populate Redis Cache
    await redisDb.setCachedSearch(queryHash, searchData);

    // 5. Write Compliance Audit Trail in PostgreSQL
    await postgres.logAuditTrail(
      req.user.id,
      "SEMANTIC_SEARCH_EVAL",
      "video_search",
      null,
      {
        query: query.trim(),
        query_hash: queryHash,
        results_count: searchData.results_count,
        latency_ms: totalLatencyMs,
      },
      req.ip
    );

    return res.json(searchData);
  } catch (err) {
    console.error("[Semantic Search Gateway Error]", err.message);
    const status = err.response ? err.response.status : 502;
    const errorDetails = err.response ? err.response.data : { error: "AI Engine vision service is unavailable." };
    return res.status(status).json(errorDetails);
  }
});

module.exports = router;
