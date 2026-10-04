import hashlib
import json
import logging
import time
from typing import Optional, Dict, Any, List
import redis
from config import settings

logger = logging.getLogger(__name__)

class RedisManager:
    def __init__(self):
        self._client: Optional[redis.Redis] = None
        self._local_fallback_cache: Dict[str, Any] = {}
        self._local_fallback_tasks: Dict[str, Dict[str, Any]] = {}

    def connect(self):
        try:
            self._client = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                password=settings.REDIS_PASSWORD or None,
                db=settings.REDIS_DB,
                decode_responses=True,
                socket_connect_timeout=2.0
            )
            self._client.ping()
            logger.info("Successfully connected to Redis at %s:%s", settings.REDIS_HOST, settings.REDIS_PORT)
        except Exception as e:
            logger.warning("Redis connection warning: %s. Using safe in-memory fallback for local execution.", e)
            self._client = None

    def is_connected(self) -> bool:
        if not self._client:
            return False
        try:
            self._client.ping()
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------------
    # Query Canonicalization & Hashing
    # ------------------------------------------------------------------------
    @staticmethod
    def generate_query_hash(query: str, top_k: int, min_score: float, video_id: Optional[str] = None) -> str:
        """
        Creates a deterministic SHA-256 fingerprint for a semantic query.
        Normalizes:
        - Lowercases and strips redundant whitespace.
        - Canonicalizes floats to 4 decimal places.
        - Handles optional video_id filtering.
        """
        normalized_query = " ".join(query.strip().lower().split())
        canonical_str = f"q={normalized_query}|k={top_k}|s={min_score:.4f}|v={video_id or 'all'}"
        return hashlib.sha256(canonical_str.encode('utf-8')).hexdigest()

    # ------------------------------------------------------------------------
    # Semantic Search Result Caching
    # ------------------------------------------------------------------------
    def get_cached_search(self, query_hash: str) -> Optional[Dict[str, Any]]:
        key = f"cache:search:{query_hash}"
        try:
            if self._client:
                data = self._client.get(key)
                if data:
                    logger.debug("Redis Cache HIT for key: %s", key)
                    return json.loads(data)
                return None
            else:
                entry = self._local_fallback_cache.get(key)
                if entry and time.time() < entry["expires_at"]:
                    return entry["data"]
                return None
        except Exception as e:
            logger.error("Error reading from Redis cache: %s", e)
            return None

    def set_cached_search(self, query_hash: str, results: Dict[str, Any], ttl_seconds: Optional[int] = None) -> None:
        key = f"cache:search:{query_hash}"
        ttl = ttl_seconds or settings.REDIS_CACHE_TTL_SECONDS
        payload = json.dumps(results)
        try:
            if self._client:
                self._client.setex(key, ttl, payload)
                logger.debug("Saved search results to Redis cache: %s (TTL: %ds)", key, ttl)
            else:
                self._local_fallback_cache[key] = {
                    "data": results,
                    "expires_at": time.time() + ttl
                }
        except Exception as e:
            logger.error("Error writing to Redis cache: %s", e)

    def invalidate_search_cache(self, pattern: str = "cache:search:*") -> int:
        """
        Invalidates all cached search queries when a new video or incident is indexed.
        Uses SCAN to prevent blocking the Redis event loop.
        """
        count = 0
        try:
            if self._client:
                cursor = 0
                while True:
                    cursor, keys = self._client.scan(cursor=cursor, match=pattern, count=100)
                    if keys:
                        self._client.delete(*keys)
                        count += len(keys)
                    if cursor == 0:
                        break
                logger.info("Invalidated %d cached search keys from Redis", count)
            else:
                count = len(self._local_fallback_cache)
                self._local_fallback_cache.clear()
        except Exception as e:
            logger.error("Error invalidating Redis search cache: %s", e)
        return count

    # ------------------------------------------------------------------------
    # Asynchronous Ingestion Task Tracking
    # ------------------------------------------------------------------------
    def init_task(self, task_id: str, video_id: str, total_frames: int = 0):
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        data = {
            "task_id": task_id,
            "video_id": video_id,
            "status": "QUEUED",
            "stage": "QUEUED",
            "progress_percentage": "0.0",
            "current_frame": "0",
            "total_frames": str(total_frames),
            "error": "",
            "created_at": now,
            "updated_at": now
        }
        key = f"task:status:{task_id}"
        try:
            if self._client:
                self._client.hset(key, mapping=data)
                self._client.expire(key, settings.REDIS_TASK_TTL_SECONDS)
            else:
                self._local_fallback_tasks[task_id] = data
        except Exception as e:
            logger.error("Error initializing task status in Redis: %s", e)

    def update_task_progress(self, task_id: str, stage: str, current_frame: int, total_frames: int, progress: float):
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        updates = {
            "status": "PROCESSING",
            "stage": stage,
            "current_frame": str(current_frame),
            "total_frames": str(total_frames),
            "progress_percentage": f"{progress:.1f}",
            "updated_at": now
        }
        key = f"task:status:{task_id}"
        try:
            if self._client:
                self._client.hset(key, mapping=updates)
            else:
                if task_id in self._local_fallback_tasks:
                    self._local_fallback_tasks[task_id].update(updates)
        except Exception as e:
            logger.error("Error updating task progress in Redis: %s", e)

    def complete_task(self, task_id: str):
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        updates = {
            "status": "COMPLETED",
            "stage": "COMPLETED",
            "progress_percentage": "100.0",
            "updated_at": now
        }
        key = f"task:status:{task_id}"
        try:
            if self._client:
                self._client.hset(key, mapping=updates)
            else:
                if task_id in self._local_fallback_tasks:
                    self._local_fallback_tasks[task_id].update(updates)
        except Exception as e:
            logger.error("Error completing task in Redis: %s", e)

    def fail_task(self, task_id: str, error_msg: str):
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        updates = {
            "status": "FAILED",
            "stage": "FAILED",
            "error": error_msg,
            "updated_at": now
        }
        key = f"task:status:{task_id}"
        try:
            if self._client:
                self._client.hset(key, mapping=updates)
            else:
                if task_id in self._local_fallback_tasks:
                    self._local_fallback_tasks[task_id].update(updates)
        except Exception as e:
            logger.error("Error setting task failure in Redis: %s", e)

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        key = f"task:status:{task_id}"
        try:
            if self._client:
                data = self._client.hgetall(key)
                if data:
                    return {
                        "task_id": data.get("task_id", task_id),
                        "video_id": data.get("video_id"),
                        "status": data.get("status", "UNKNOWN"),
                        "stage": data.get("stage", "UNKNOWN"),
                        "progress_percentage": float(data.get("progress_percentage", 0.0)),
                        "current_frame": int(data.get("current_frame", 0)),
                        "total_frames": int(data.get("total_frames", 0)),
                        "error": data.get("error") or None,
                        "created_at": data.get("created_at"),
                        "updated_at": data.get("updated_at")
                    }
                return None
            else:
                task = self._local_fallback_tasks.get(task_id)
                if task:
                    return {
                        "task_id": task.get("task_id", task_id),
                        "video_id": task.get("video_id"),
                        "status": task.get("status", "UNKNOWN"),
                        "stage": task.get("stage", "UNKNOWN"),
                        "progress_percentage": float(task.get("progress_percentage", 0.0)),
                        "current_frame": int(task.get("current_frame", 0)),
                        "total_frames": int(task.get("total_frames", 0)),
                        "error": task.get("error") or None,
                        "created_at": task.get("created_at"),
                        "updated_at": task.get("updated_at")
                    }
                return None
        except Exception as e:
            logger.error("Error retrieving task status from Redis: %s", e)
            return None

redis_manager = RedisManager()
