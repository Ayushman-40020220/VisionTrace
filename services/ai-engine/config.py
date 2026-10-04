import os
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    PROJECT_NAME: str = "VisionTrace AI Engine"
    API_V1_STR: str = "/internal/v1"
    
    # Environment
    ENV: str = Field(default="development", env="ENV")
    PORT: int = Field(default=8000, env="AI_ENGINE_PORT")
    HOST: str = Field(default="0.0.0.0", env="AI_ENGINE_HOST")
    
    # MongoDB
    MONGO_URI: str = Field(default="mongodb://localhost:27017", env="MONGO_URI")
    MONGO_DB_NAME: str = Field(default="visiontrace", env="MONGO_DB_NAME")
    
    # Redis
    REDIS_HOST: str = Field(default="localhost", env="REDIS_HOST")
    REDIS_PORT: int = Field(default=6379, env="REDIS_PORT")
    REDIS_PASSWORD: str = Field(default="", env="REDIS_PASSWORD")
    REDIS_DB: int = Field(default=0, env="REDIS_DB")
    REDIS_CACHE_TTL_SECONDS: int = Field(default=3600, env="REDIS_CACHE_TTL_SECONDS") # 1 hour
    REDIS_TASK_TTL_SECONDS: int = Field(default=86400, env="REDIS_TASK_TTL_SECONDS") # 24 hours
    
    # AI Models
    YOLO_MODEL_PATH: str = Field(default="yolov8n.pt", env="YOLO_MODEL_PATH")
    EMBEDDING_MODEL_NAME: str = Field(default="all-MiniLM-L6-v2", env="EMBEDDING_MODEL_NAME")
    EMBEDDING_DIMENSION: int = 384
    
    # Video Ingestion Settings
    FRAME_SAMPLE_INTERVAL_SECONDS: float = Field(default=1.0, env="FRAME_SAMPLE_INTERVAL_SECONDS")
    YOLO_CONFIDENCE_THRESHOLD: float = Field(default=0.35, env="YOLO_CONFIDENCE_THRESHOLD")
    
    # Vector Index Persistence
    FAISS_INDEX_STORAGE_PATH: str = Field(default="./data/faiss_index.bin", env="FAISS_INDEX_STORAGE_PATH")
    FAISS_METADATA_STORAGE_PATH: str = Field(default="./data/faiss_metadata.json", env="FAISS_METADATA_STORAGE_PATH")
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
