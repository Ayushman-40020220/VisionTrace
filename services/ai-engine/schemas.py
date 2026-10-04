from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

# ----------------------------------------------------------------------------
# Ingestion Schemas
# ----------------------------------------------------------------------------
class IngestVideoRequest(BaseModel):
    video_id: str = Field(..., description="UUID of the video in PostgreSQL")
    video_path: str = Field(..., description="Absolute path or URI to the video file")
    title: Optional[str] = Field(None, description="Title of the video recording")
    incident_id: Optional[str] = Field(None, description="Optional associated incident UUID")
    incident_title: Optional[str] = Field(None, description="Incident title for contextual embedding")
    incident_notes: Optional[str] = Field(None, description="Incident notes or description")
    sample_interval_sec: Optional[float] = Field(1.0, description="Interval in seconds between sampled frames")

class IngestTaskResponse(BaseModel):
    task_id: str
    video_id: str
    status: str
    message: str

class TaskStatusResponse(BaseModel):
    task_id: str
    video_id: Optional[str] = None
    status: str # QUEUED, PROCESSING, COMPLETED, FAILED
    progress_percentage: float = 0.0
    current_frame: int = 0
    total_frames: int = 0
    stage: str = "INITIALIZING"
    error: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

# ----------------------------------------------------------------------------
# Object Detection & Telemetry Schemas
# ----------------------------------------------------------------------------
class BoundingBox(BaseModel):
    x_min: float
    y_min: float
    x_max: float
    y_max: float

class DetectionObject(BaseModel):
    class_id: int
    label: str
    confidence: float
    bbox: List[float] # [x_min, y_min, x_max, y_max]
    bbox_normalized: List[float] # [x_norm_min, y_norm_min, x_norm_max, y_norm_max]

class FrameTelemetry(BaseModel):
    video_id: str
    frame_index: int
    timestamp_ms: int
    frame_width: int
    frame_height: int
    scene_summary: str
    incident_context: Optional[str] = None
    detections: List[DetectionObject]
    created_at: datetime = Field(default_factory=datetime.utcnow)

# ----------------------------------------------------------------------------
# Semantic Search Schemas
# ----------------------------------------------------------------------------
class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=2, description="Natural language search query")
    top_k: int = Field(default=10, ge=1, le=100, description="Number of results to retrieve")
    min_score: float = Field(default=0.25, ge=0.0, le=1.0, description="Minimum cosine similarity score threshold")
    video_id: Optional[str] = Field(None, description="Filter search to a specific video ID")

class MatchedFrameResult(BaseModel):
    vector_id: int
    score: float
    video_id: str
    frame_index: int
    timestamp_ms: int
    timestamp_formatted: str
    scene_summary: str
    incident_id: Optional[str] = None
    detections: List[DetectionObject]

class SemanticSearchResponse(BaseModel):
    query: str
    results_count: int
    cache_hit: bool
    execution_time_ms: float
    results: List[MatchedFrameResult]

# ----------------------------------------------------------------------------
# Health & Stats Schemas
# ----------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str
    indexed_vectors: int
    embedding_dimension: int
    yolo_model: str
    mongo_connected: bool
    redis_connected: bool
