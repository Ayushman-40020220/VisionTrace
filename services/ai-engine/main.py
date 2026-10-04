import os
import uuid
import time
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from schemas import (
    IngestVideoRequest,
    IngestTaskResponse,
    TaskStatusResponse,
    SemanticSearchRequest,
    SemanticSearchResponse,
    MatchedFrameResult,
    DetectionObject,
    HealthResponse
)
from db.mongo import mongo_repo
from db.redis_client import redis_manager
from pipeline.embedder import embedder
from pipeline.vector_index import vector_index_manager
from pipeline.video_processor import video_processor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("visiontrace.ai_engine")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize DB connections and pre-load AI models
    logger.info("Starting VisionTrace AI Engine microservice...")
    mongo_repo.connect()
    redis_manager.connect()
    embedder.load_model()
    vector_index_manager.initialize()
    logger.info("VisionTrace AI Engine is ready to receive requests.")
    yield
    # Shutdown
    logger.info("Shutting down VisionTrace AI Engine...")
    vector_index_manager.save_index()
    mongo_repo.close()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Multi-Modal Video Audit & Semantic Incident Search Engine AI Service",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# 1. Health & Status
# ----------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["System"])
def health_check():
    return HealthResponse(
        status="HEALTHY",
        indexed_vectors=vector_index_manager.total_vectors,
        embedding_dimension=settings.EMBEDDING_DIMENSION,
        yolo_model=settings.YOLO_MODEL_PATH,
        mongo_connected=mongo_repo.is_connected(),
        redis_connected=redis_manager.is_connected()
    )

# ----------------------------------------------------------------------------
# 2. Video Ingestion Endpoint (Asynchronous Worker Execution)
# ----------------------------------------------------------------------------
@app.post(
    f"{settings.API_V1_STR}/ingest",
    response_model=IngestTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Ingestion"]
)
def trigger_video_ingestion(
    payload: IngestVideoRequest,
    background_tasks: BackgroundTasks
):
    """
    Kicks off asynchronous video frame extraction, YOLOv8 object detection,
    dense embedding generation, MongoDB telemetry storage, and FAISS indexing.
    """
    if not os.path.exists(payload.video_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Video file does not exist at path: {payload.video_path}"
        )

    task_id = str(uuid.uuid4())
    redis_manager.init_task(task_id, payload.video_id)

    # Dispatch to background task worker
    background_tasks.add_task(
        video_processor.process_video,
        task_id=task_id,
        video_id=payload.video_id,
        video_path=payload.video_path,
        incident_id=payload.incident_id,
        incident_title=payload.incident_title,
        incident_notes=payload.incident_notes,
        sample_interval_sec=payload.sample_interval_sec or settings.FRAME_SAMPLE_INTERVAL_SECONDS
    )

    return IngestTaskResponse(
        task_id=task_id,
        video_id=payload.video_id,
        status="QUEUED",
        message="Video ingestion task queued successfully for processing."
    )

# ----------------------------------------------------------------------------
# 3. Asynchronous Task Status Endpoint
# ----------------------------------------------------------------------------
@app.get(
    f"{settings.API_V1_STR}/tasks/{{task_id}}",
    response_model=TaskStatusResponse,
    tags=["Ingestion"]
)
def get_task_status(task_id: str):
    task_data = redis_manager.get_task_status(task_id)
    if not task_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task ID '{task_id}' not found or expired."
        )
    return TaskStatusResponse(**task_data)

# ----------------------------------------------------------------------------
# 4. Multi-Modal Semantic Search Endpoint with Redis Caching
# ----------------------------------------------------------------------------
@app.post(
    f"{settings.API_V1_STR}/search",
    response_model=SemanticSearchResponse,
    tags=["Search"]
)
def semantic_search(request: SemanticSearchRequest):
    """
    Performs high-performance semantic search over video frames:
    1. Checks Redis cache using deterministic SHA-256 query fingerprint.
    2. Encodes query into dense vector with Sentence Transformers.
    3. Runs vector similarity query in FAISS IndexFlatIP (Cosine Similarity).
    4. Hydrates top matches with MongoDB frame detections & bounding boxes.
    5. Caches output in Redis and returns matched clips.
    """
    start_time = time.time()
    
    # Step 1: Redis Caching Strategy - Query Hashing
    query_hash = redis_manager.generate_query_hash(
        query=request.query,
        top_k=request.top_k,
        min_score=request.min_score,
        video_id=request.video_id
    )

    cached_result = redis_manager.get_cached_search(query_hash)
    if cached_result:
        cached_result["cache_hit"] = True
        cached_result["execution_time_ms"] = round((time.time() - start_time) * 1000, 2)
        return SemanticSearchResponse(**cached_result)

    # Step 2: Compute Dense Embedding
    query_embedding = embedder.encode(request.query, normalize=True)

    # Step 3: FAISS Vector Index Search
    raw_matches = vector_index_manager.search(
        query_vector=query_embedding,
        top_k=request.top_k,
        min_score=request.min_score,
        video_id_filter=request.video_id
    )

    # Step 4: MongoDB Telemetry Hydration (Bounding Boxes, Detections, Confidence)
    hydrated_results: List[MatchedFrameResult] = []
    for match in raw_matches:
        v_id = match["video_id"]
        f_idx = match["frame_index"]
        t_ms = match["timestamp_ms"]

        telemetry_doc = mongo_repo.get_telemetry_for_frame(v_id, f_idx)
        detections_list: List[DetectionObject] = []

        if telemetry_doc and "detections" in telemetry_doc:
            for d in telemetry_doc["detections"]:
                detections_list.append(DetectionObject(**d))

        formatted_time = video_processor.format_timestamp(t_ms)

        hydrated_results.append(MatchedFrameResult(
            vector_id=match["vector_id"],
            score=match["score"],
            video_id=v_id,
            frame_index=f_idx,
            timestamp_ms=t_ms,
            timestamp_formatted=formatted_time,
            scene_summary=match.get("scene_summary", ""),
            incident_id=match.get("incident_id"),
            detections=detections_list
        ))

    execution_time_ms = round((time.time() - start_time) * 1000, 2)

    response_payload = {
        "query": request.query,
        "results_count": len(hydrated_results),
        "cache_hit": False,
        "execution_time_ms": execution_time_ms,
        "results": [r.dict() for r in hydrated_results]
    }

    # Step 5: Save to Redis Cache with TTL
    redis_manager.set_cached_search(query_hash, response_payload)

    return SemanticSearchResponse(**response_payload)

# ----------------------------------------------------------------------------
# 5. Video Telemetry Retrieval Endpoint
# ----------------------------------------------------------------------------
@app.get(
    f"{settings.API_V1_STR}/telemetry/{{video_id}}",
    tags=["Telemetry"]
)
def get_video_telemetry(
    video_id: str,
    limit: int = Query(default=200, ge=1, le=1000)
):
    """Fetches raw frame-by-frame object detection telemetry from MongoDB."""
    telemetry = mongo_repo.get_video_telemetry(video_id, limit=limit)
    return {
        "video_id": video_id,
        "count": len(telemetry),
        "telemetry": telemetry
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
