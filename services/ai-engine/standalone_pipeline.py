#!/usr/bin/env python3
"""
===============================================================================
VisionTrace - Multi-Modal Video Audit & Semantic Incident Search Engine
Standalone End-to-End Pipeline Script
===============================================================================
This self-contained script executes:
1. Video Ingestion & Frame Sampling via OpenCV
2. Frame Object Detection via Ultralytics YOLOv8
3. Contextual Text Synthesis (Incident Logs + Detections)
4. Dense Vector Embedding via Sentence Transformers (all-MiniLM-L6-v2)
5. Vector Indexing & Cosine Similarity Search via FAISS (IndexFlatIP)
6. Optional MongoDB & Redis integration with in-memory fallbacks

Usage:
  python standalone_pipeline.py --video sample.mp4 --query "person with a backpack"
  python standalone_pipeline.py --demo # Generates a synthetic test video and runs full flow!
===============================================================================
"""

import os
import sys
import time
import json
import uuid
import hashlib
import argparse
import logging
from typing import List, Dict, Any, Tuple, Optional

import cv2
import numpy as np

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("VisionTrace")

# =============================================================================
# 1. AI Models Wrappers (YOLOv8, Sentence Transformers, FAISS)
# =============================================================================
try:
    from ultralytics import YOLO
except ImportError:
    logger.error("ultralytics not installed. Install via: pip install ultralytics")
    sys.exit(1)

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    logger.error("sentence-transformers not installed. Install via: pip install sentence-transformers")
    sys.exit(1)

try:
    import faiss
except ImportError:
    logger.error("faiss-cpu not installed. Install via: pip install faiss-cpu")
    sys.exit(1)

# Optional Redis & MongoDB
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

try:
    from pymongo import MongoClient
    MONGO_AVAILABLE = True
except ImportError:
    MONGO_AVAILABLE = False


class VisionTracePipeline:
    def __init__(
        self,
        yolo_model_name: str = "yolov8n.pt",
        embedding_model_name: str = "all-MiniLM-L6-v2",
        embedding_dim: int = 384,
        confidence_threshold: float = 0.35,
        redis_host: str = "localhost",
        redis_port: int = 6379,
        mongo_uri: str = "mongodb://localhost:27017"
    ):
        self.embedding_dim = embedding_dim
        self.confidence_threshold = confidence_threshold

        logger.info("Initializing YOLOv8 model: %s", yolo_model_name)
        self.yolo = YOLO(yolo_model_name)

        logger.info("Initializing Sentence Transformer: %s", embedding_model_name)
        self.embedder = SentenceTransformer(embedding_model_name)

        logger.info("Initializing FAISS IndexFlatIP (dim=%d)", embedding_dim)
        # Inner Product on L2-normalized vectors == Cosine Similarity
        self.index = faiss.IndexFlatIP(embedding_dim)
        self.metadata_registry: Dict[int, Dict[str, Any]] = {}
        self.next_vector_id = 0

        # In-memory caches / fallbacks
        self.search_cache: Dict[str, Dict[str, Any]] = {}
        self.frame_telemetry_store: List[Dict[str, Any]] = []

        # Connect external services if accessible
        self.redis_client = None
        if REDIS_AVAILABLE:
            try:
                r = redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1)
                r.ping()
                self.redis_client = r
                logger.info("Connected to Redis at %s:%d", redis_host, redis_port)
            except Exception:
                logger.warning("Redis not reachable. Using in-memory query cache.")

        self.mongo_collection = None
        if MONGO_AVAILABLE:
            try:
                m = MongoClient(mongo_uri, serverSelectionTimeoutMS=1000)
                m.admin.command('ping')
                self.mongo_collection = m["visiontrace"]["frame_telemetry"]
                logger.info("Connected to MongoDB at %s", mongo_uri)
            except Exception:
                logger.warning("MongoDB not reachable. Using in-memory telemetry store.")

    # =========================================================================
    # 2. Redis Caching Logic
    # =========================================================================
    @staticmethod
    def hash_query(query: str, top_k: int, min_score: float) -> str:
        normalized = " ".join(query.strip().lower().split())
        raw_key = f"q={normalized}|k={top_k}|s={min_score:.4f}"
        return hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

    def get_from_cache(self, query_hash: str) -> Optional[Dict[str, Any]]:
        if self.redis_client:
            val = self.redis_client.get(f"cache:search:{query_hash}")
            if val:
                return json.loads(val)
        return self.search_cache.get(query_hash)

    def set_to_cache(self, query_hash: str, data: Dict[str, Any], ttl_sec: int = 3600):
        if self.redis_client:
            self.redis_client.setex(f"cache:search:{query_hash}", ttl_sec, json.dumps(data))
        self.search_cache[query_hash] = data

    def invalidate_cache(self):
        if self.redis_client:
            keys = self.redis_client.keys("cache:search:*")
            if keys:
                self.redis_client.delete(*keys)
        self.search_cache.clear()
        logger.info("Semantic query cache invalidated.")

    # =========================================================================
    # 3. Video Processing & Keyframe Extraction
    # =========================================================================
    def ingest_video(
        self,
        video_path: str,
        video_id: Optional[str] = None,
        incident_notes: Optional[str] = None,
        sample_interval_sec: float = 1.0
    ) -> Dict[str, Any]:
        """
        Samples video frames, executes YOLO detection, extracts bounding boxes,
        synthesizes scene summaries, encodes vectors, and adds them to FAISS.
        """
        video_id = video_id or str(uuid.uuid4())
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            raise RuntimeError(f"Unable to open video: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration_sec = total_frames / fps if fps > 0 else 0.0

        step_frames = max(1, int(fps * sample_interval_sec))
        logger.info("Ingesting Video ID: %s", video_id)
        logger.info("Video Meta: %d frames, %.1f FPS, %dx%d, Duration: %.2fs",
                    total_frames, fps, width, height, duration_sec)

        names = self.yolo.names if hasattr(self.yolo, 'names') else {}
        frame_idx = 0
        extracted_telemetry = []
        scene_summaries = []
        frame_metadata_list = []

        start_time = time.time()

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % step_frames == 0:
                timestamp_ms = int((frame_idx / fps) * 1000)
                seconds = timestamp_ms // 1000
                formatted_time = f"{seconds // 60:02d}:{seconds % 60:02d}.{timestamp_ms % 1000:03d}"

                # YOLOv8 Inference
                results = self.yolo(frame, conf=self.confidence_threshold, verbose=False)
                detections = []
                counts = {}

                for r in results:
                    for box in r.boxes:
                        cls_id = int(box.cls[0].item())
                        conf = float(box.conf[0].item())
                        xyxy = box.xyxy[0].tolist()
                        label = names.get(cls_id, f"obj_{cls_id}")

                        # Normalized BBox
                        norm_box = [
                            round(xyxy[0] / width, 4),
                            round(xyxy[1] / height, 4),
                            round(xyxy[2] / width, 4),
                            round(xyxy[3] / height, 4)
                        ]

                        detections.append({
                            "class_id": cls_id,
                            "label": label,
                            "confidence": round(conf, 3),
                            "bbox": [round(c, 1) for c in xyxy],
                            "bbox_normalized": norm_box
                        })
                        counts[label] = counts.get(label, 0) + 1

                # Synthesize natural language scene description
                labels_desc = ", ".join([f"{c} {l}" for l, c in counts.items()]) if counts else "no prominent objects"
                incident_desc = f"Incident context: {incident_notes}." if incident_notes else ""
                scene_summary = f"Timestamp {formatted_time} ({timestamp_ms}ms). Visible detections: {labels_desc}. {incident_desc}".strip()

                telemetry_item = {
                    "video_id": video_id,
                    "frame_index": frame_idx,
                    "timestamp_ms": timestamp_ms,
                    "formatted_time": formatted_time,
                    "detections": detections,
                    "scene_summary": scene_summary
                }

                extracted_telemetry.append(telemetry_item)
                scene_summaries.append(scene_summary)
                frame_metadata_list.append({
                    "video_id": video_id,
                    "frame_index": frame_idx,
                    "timestamp_ms": timestamp_ms,
                    "formatted_time": formatted_time,
                    "scene_summary": scene_summary,
                    "detections": detections
                })

            frame_idx += 1

        cap.release()

        # ---------------------------------------------------------------------
        # Dense Vector Embedding & FAISS Vector Indexing
        # ---------------------------------------------------------------------
        if scene_summaries:
            logger.info("Computing dense embeddings for %d keyframe scene summaries...", len(scene_summaries))
            embeddings = self.embedder.encode(
                scene_summaries,
                convert_to_numpy=True,
                normalize_embeddings=True # Crucial: L2 normalize so InnerProduct == Cosine Sim
            ).astype(np.float32)

            start_id = self.next_vector_id
            for i, meta in enumerate(frame_metadata_list):
                vid = start_id + i
                self.metadata_registry[vid] = meta
            self.next_vector_id += len(embeddings)

            # Add to FAISS Index
            self.index.add(embeddings)
            logger.info("Indexed %d vectors in FAISS. Total index count: %d", len(embeddings), self.index.ntotal)

        # Persist Telemetry to MongoDB or in-memory
        if self.mongo_collection is not None and extracted_telemetry:
            self.mongo_collection.insert_many(extracted_telemetry)
        else:
            self.frame_telemetry_store.extend(extracted_telemetry)

        # Invalidate Cache
        self.invalidate_cache()

        elapsed = time.time() - start_time
        logger.info("Ingestion completed in %.2f seconds for %d frames.", elapsed, len(extracted_telemetry))

        return {
            "video_id": video_id,
            "total_frames_sampled": len(extracted_telemetry),
            "total_vectors_in_index": self.index.ntotal,
            "duration_sec": duration_sec,
            "fps": fps,
            "processing_time_sec": round(elapsed, 2)
        }

    # =========================================================================
    # 4. Multi-Modal Semantic Search
    # =========================================================================
    def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.20
    ) -> Dict[str, Any]:
        """
        Executes semantic search against FAISS index with Redis cache check.
        Returns matching frames, timestamps, and YOLO bounding boxes.
        """
        start_time = time.time()
        q_hash = self.hash_query(query, top_k, min_score)

        # Check Cache
        cached = self.get_from_cache(q_hash)
        if cached:
            cached["cache_hit"] = True
            cached["execution_time_ms"] = round((time.time() - start_time) * 1000, 2)
            return cached

        if self.index.ntotal == 0:
            return {"query": query, "results": [], "cache_hit": False, "count": 0}

        # Encode Query Vector
        query_vec = self.embedder.encode(
            [query],
            convert_to_numpy=True,
            normalize_embeddings=True
        ).astype(np.float32)

        # FAISS Inner Product Search
        search_k = min(top_k, self.index.ntotal)
        distances, indices = self.index.search(query_vec, search_k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                continue
            score = float(dist)
            if score < min_score:
                continue

            meta = self.metadata_registry.get(int(idx), {})
            results.append({
                "vector_id": int(idx),
                "cosine_similarity": round(score, 4),
                "video_id": meta.get("video_id"),
                "frame_index": meta.get("frame_index"),
                "timestamp_ms": meta.get("timestamp_ms"),
                "formatted_time": meta.get("formatted_time"),
                "scene_summary": meta.get("scene_summary"),
                "detections": meta.get("detections", [])
            })

        execution_ms = round((time.time() - start_time) * 1000, 2)
        output = {
            "query": query,
            "count": len(results),
            "cache_hit": False,
            "execution_time_ms": execution_ms,
            "results": results
        }

        # Cache Output
        self.set_to_cache(q_hash, output)
        return output

# =============================================================================
# 5. Synthetic Demo Video Generator (For Instant Testing)
# =============================================================================
def generate_synthetic_demo_video(output_path: str = "demo_audit.mp4", duration_sec: int = 5):
    """
    Generates a synthetic 5-second video with simulated frames
    to allow instant out-of-the-box pipeline testing without external media.
    """
    logger.info("Generating synthetic demo video: %s (%d seconds)...", output_path, duration_sec)
    fps = 10
    width, height = 640, 480
    total_frames = fps * duration_sec

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    for i in range(total_frames):
        # Create dark background
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:] = (30, 30, 35)

        # Draw a moving "person" (yellow circle + blue rectangle)
        x_pos = int(50 + (i / total_frames) * 450)
        cv2.circle(frame, (x_pos, 150), 30, (0, 200, 255), -1) # Head
        cv2.rectangle(frame, (x_pos - 25, 180), (x_pos + 25, 300), (255, 100, 50), -1) # Body
        # Draw a backpack
        cv2.rectangle(frame, (x_pos + 15, 190), (x_pos + 45, 270), (50, 180, 50), -1)

        # Text overlay
        cv2.putText(
            frame,
            f"VisionTrace Demo Feed | Frame: {i}/{total_frames} | Time: {i/fps:.1f}s",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (200, 200, 200),
            1
        )
        out.write(frame)

    out.release()
    logger.info("Synthetic video generated at: %s", os.path.abspath(output_path))


# =============================================================================
# 6. CLI Execution Entrypoint
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="VisionTrace Multi-Modal AI Ingestion & Semantic Search Engine")
    parser.add_argument("--video", type=str, help="Path to input video file")
    parser.add_argument("--query", type=str, default="person with a backpack", help="Semantic incident search query")
    parser.add_argument("--demo", action="store_true", help="Generate a synthetic video and run full pipeline demonstration")
    parser.add_argument("--incident", type=str, default="Security breach alert: suspicious individual near server room.", help="Incident description")
    parser.add_argument("--top_k", type=int, default=5, help="Number of search matches to return")

    args = parser.parse_args()

    video_path = args.video
    if args.demo or not video_path:
        video_path = "demo_audit.mp4"
        if not os.path.exists(video_path):
            generate_synthetic_demo_video(video_path)

    # Initialize Pipeline
    pipeline = VisionTracePipeline()

    # Step 1: Ingest Video
    print("\n" + "=" * 60)
    print("STEP 1: INGESTING VIDEO & EXTRACTING TELEMETRY")
    print("=" * 60)
    ingest_stats = pipeline.ingest_video(
        video_path=video_path,
        incident_notes=args.incident,
        sample_interval_sec=1.0
    )
    print(json.dumps(ingest_stats, indent=2))

    # Step 2: Semantic Query 1 (Cold Cache)
    print("\n" + "=" * 60)
    print(f"STEP 2: SEMANTIC SEARCH QUERY: '{args.query}' (Cold Cache)")
    print("=" * 60)
    results_cold = pipeline.search(args.query, top_k=args.top_k)
    print(f"Results Count: {results_cold['count']} | Cache Hit: {results_cold['cache_hit']} | Latency: {results_cold['execution_time_ms']}ms")
    for r in results_cold["results"]:
        print(f" -> Timestamp: {r['formatted_time']} | Similarity: {r['cosine_similarity']} | Summary: {r['scene_summary']}")
        print(f"    Bounding Boxes: {json.dumps(r['detections'])}")

    # Step 3: Semantic Query 2 (Hot Cache Verification)
    print("\n" + "=" * 60)
    print(f"STEP 3: REPEATING QUERY TO VERIFY REDIS CACHE HIT: '{args.query}'")
    print("=" * 60)
    results_hot = pipeline.search(args.query, top_k=args.top_k)
    print(f"Results Count: {results_hot['count']} | Cache Hit: {results_hot['cache_hit']} | Latency: {results_hot['execution_time_ms']}ms (Near Zero!)")

if __name__ == "__main__":
    main()
