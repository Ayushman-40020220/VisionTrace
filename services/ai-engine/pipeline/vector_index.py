import os
import json
import logging
import threading
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import faiss
from config import settings

logger = logging.getLogger(__name__)

class FaissIndexManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FaissIndexManager, cls).__new__(cls)
            cls._instance._index: Optional[faiss.IndexFlatIP] = None
            cls._instance._metadata_map: Dict[int, Dict[str, Any]] = {}
            cls._instance._next_id: int = 0
        return cls._instance

    def initialize(self):
        with self._lock:
            # Check if persisted index exists
            if os.path.exists(settings.FAISS_INDEX_STORAGE_PATH) and os.path.exists(settings.FAISS_METADATA_STORAGE_PATH):
                try:
                    logger.info("Loading existing FAISS index from %s", settings.FAISS_INDEX_STORAGE_PATH)
                    self._index = faiss.read_index(settings.FAISS_INDEX_STORAGE_PATH)
                    with open(settings.FAISS_METADATA_STORAGE_PATH, "r", encoding="utf-8") as f:
                        raw_meta = json.load(f)
                        self._metadata_map = {int(k): v for k, v in raw_meta.items()}
                    self._next_id = len(self._metadata_map)
                    logger.info("FAISS index loaded successfully with %d vectors", self._index.ntotal)
                    return
                except Exception as e:
                    logger.error("Failed to load existing FAISS index: %s. Creating fresh index.", e)

            # Create fresh IndexFlatIP for exact cosine similarity
            logger.info("Initializing fresh FAISS IndexFlatIP (dim=%d)", settings.EMBEDDING_DIMENSION)
            self._index = faiss.IndexFlatIP(settings.EMBEDDING_DIMENSION)
            self._metadata_map = {}
            self._next_id = 0

    @property
    def total_vectors(self) -> int:
        return self._index.ntotal if self._index is not None else 0

    def add_vectors(self, embeddings: np.ndarray, metadata_list: List[Dict[str, Any]]) -> List[int]:
        """
        Adds a batch of L2-normalized embeddings and registers their associated metadata.
        Returns list of assigned vector IDs.
        """
        if self._index is None:
            self.initialize()

        if embeddings.ndim == 1:
            embeddings = np.expand_dims(embeddings, axis=0)

        num_vectors = embeddings.shape[0]
        if num_vectors != len(metadata_list):
            raise ValueError(f"Vectors count ({num_vectors}) does not match metadata count ({len(metadata_list)})")

        assigned_ids = []
        with self._lock:
            start_id = self._next_id
            for i, meta in enumerate(metadata_list):
                vid = start_id + i
                self._metadata_map[vid] = meta
                assigned_ids.append(vid)
            self._next_id += num_vectors

            # FAISS IndexFlatIP add
            self._index.add(embeddings)
            logger.info("Added %d vectors to FAISS index. Total count: %d", num_vectors, self._index.ntotal)

        # Asynchronously or synchronously persist
        self.save_index()
        return assigned_ids

    def search(
        self,
        query_vector: np.ndarray,
        top_k: int = 10,
        min_score: float = 0.25,
        video_id_filter: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Executes a vector search using Inner Product (Cosine Similarity on normalized vectors).
        Applies score thresholding and optional video_id filtering.
        """
        if self._index is None:
            self.initialize()

        if self._index.ntotal == 0:
            return []

        if query_vector.ndim == 1:
            query_vector = np.expand_dims(query_vector, axis=0)

        # Retrieve a wider candidate pool if filtering is applied
        fetch_k = min(top_k * 4 if video_id_filter else top_k, self._index.ntotal)
        
        with self._lock:
            distances, indices = self._index.search(query_vector, fetch_k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                continue
            
            score = float(dist)
            if score < min_score:
                continue

            meta = self._metadata_map.get(int(idx), {})
            if video_id_filter and meta.get("video_id") != video_id_filter:
                continue

            results.append({
                "vector_id": int(idx),
                "score": round(score, 4),
                "video_id": meta.get("video_id"),
                "frame_index": meta.get("frame_index"),
                "timestamp_ms": meta.get("timestamp_ms"),
                "scene_summary": meta.get("scene_summary"),
                "incident_id": meta.get("incident_id")
            })

            if len(results) >= top_k:
                break

        return results

    def save_index(self):
        """Persists the FAISS binary index and metadata JSON to disk."""
        try:
            os.makedirs(os.path.dirname(settings.FAISS_INDEX_STORAGE_PATH), exist_ok=True)
            with self._lock:
                faiss.write_index(self._index, settings.FAISS_INDEX_STORAGE_PATH)
                with open(settings.FAISS_METADATA_STORAGE_PATH, "w", encoding="utf-8") as f:
                    json.dump(self._metadata_map, f, indent=2)
            logger.debug("Successfully saved FAISS index and metadata to disk.")
        except Exception as e:
            logger.error("Failed to persist FAISS index: %s", e)

vector_index_manager = FaissIndexManager()
