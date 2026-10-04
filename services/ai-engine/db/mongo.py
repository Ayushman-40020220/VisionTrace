import logging
from typing import List, Dict, Any, Optional
from pymongo import MongoClient, ASCENDING
from pymongo.collection import Collection
from config import settings

logger = logging.getLogger(__name__)

class MongoRepository:
    def __init__(self):
        self._client: Optional[MongoClient] = None
        self._db = None
        self._telemetry: Optional[Collection] = None

    def connect(self):
        try:
            self._client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=3000)
            self._db = self._client[settings.MONGO_DB_NAME]
            self._telemetry = self._db["frame_telemetry"]
            # Ping
            self._client.admin.command('ping')
            self._ensure_indexes()
            logger.info("Successfully connected to MongoDB (%s)", settings.MONGO_DB_NAME)
        except Exception as e:
            logger.warning("MongoDB connection warning: %s. Running in fallback mode if offline.", e)

    def _ensure_indexes(self):
        if self._telemetry is not None:
            self._telemetry.create_index([("video_id", ASCENDING), ("frame_index", ASCENDING)], unique=True)
            self._telemetry.create_index([("video_id", ASCENDING), ("timestamp_ms", ASCENDING)])
            self._telemetry.create_index([("detections.label", ASCENDING)])

    def is_connected(self) -> bool:
        if not self._client:
            return False
        try:
            self._client.admin.command('ping')
            return True
        except Exception:
            return False

    def insert_frame_telemetry(self, doc: Dict[str, Any]):
        if self._telemetry is not None:
            self._telemetry.update_one(
                {"video_id": doc["video_id"], "frame_index": doc["frame_index"]},
                {"$set": doc},
                upsert=True
            )

    def insert_batch_telemetry(self, docs: List[Dict[str, Any]]):
        if self._telemetry is not None and docs:
            from pymongo import UpdateOne
            operations = [
                UpdateOne(
                    {"video_id": d["video_id"], "frame_index": d["frame_index"]},
                    {"$set": d},
                    upsert=True
                )
                for d in docs
            ]
            self._telemetry.bulk_write(operations, ordered=False)

    def get_telemetry_for_frame(self, video_id: str, frame_index: int) -> Optional[Dict[str, Any]]:
        if self._telemetry is None:
            return None
        return self._telemetry.find_one(
            {"video_id": video_id, "frame_index": frame_index},
            {"_id": 0}
        )

    def get_telemetry_for_timestamp(self, video_id: str, timestamp_ms: int, tolerance_ms: int = 1000) -> Optional[Dict[str, Any]]:
        if self._telemetry is None:
            return None
        return self._telemetry.find_one(
            {
                "video_id": video_id,
                "timestamp_ms": {
                    "$gte": max(0, timestamp_ms - tolerance_ms),
                    "$lte": timestamp_ms + tolerance_ms
                }
            },
            {"_id": 0},
            sort=[("timestamp_ms", ASCENDING)]
        )

    def get_video_telemetry(self, video_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        if self._telemetry is None:
            return []
        cursor = self._telemetry.find({"video_id": video_id}, {"_id": 0}).sort("frame_index", ASCENDING).limit(limit)
        return list(cursor)

    def close(self):
        if self._client:
            self._client.close()

mongo_repo = MongoRepository()
