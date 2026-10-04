import os
import cv2
import logging
import time
from typing import Dict, Any, List, Optional
import numpy as np
from ultralytics import YOLO

from config import settings
from db.mongo import mongo_repo
from db.redis_client import redis_manager
from pipeline.embedder import embedder
from pipeline.vector_index import vector_index_manager

logger = logging.getLogger(__name__)

class VideoIngestionProcessor:
    def __init__(self):
        self._yolo_model: Optional[YOLO] = None

    def _get_yolo_model(self) -> YOLO:
        if self._yolo_model is None:
            logger.info("Loading YOLO model: %s", settings.YOLO_MODEL_PATH)
            self._yolo_model = YOLO(settings.YOLO_MODEL_PATH)
        return self._yolo_model

    @staticmethod
    def format_timestamp(timestamp_ms: int) -> str:
        seconds = timestamp_ms // 1000
        ms = timestamp_ms % 1000
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        secs = seconds % 60
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"

    def process_video(
        self,
        task_id: str,
        video_id: str,
        video_path: str,
        incident_id: Optional[str] = None,
        incident_title: Optional[str] = None,
        incident_notes: Optional[str] = None,
        sample_interval_sec: float = 1.0
    ):
        """
        Hardened end-to-end video ingestion worker:
        - Validates file integrity, headers, and container decodability.
        - Gracefully recovers from truncated or corrupted frames without process crashes.
        - Indexes partial valid frames if unexpected EOF occurs.
        - Persists telemetry into MongoDB, embeds with Sentence Transformers,
          and indexes into FAISS with automatic Redis cache invalidation.
        """
        logger.info("Starting hardened ingestion task %s for video %s (%s)", task_id, video_id, video_path)

        # ---------------------------------------------------------------------
        # Edge Case 1: File Existence & Zero-Byte Verification
        # ---------------------------------------------------------------------
        if not os.path.exists(video_path):
            error_msg = f"Video file not found at path: {video_path}"
            logger.error(error_msg)
            redis_manager.fail_task(task_id, error_msg)
            return

        file_size = os.path.getsize(video_path)
        if file_size == 0:
            error_msg = f"Corrupted media: 0-byte video file uploaded ({video_path})"
            logger.error(error_msg)
            redis_manager.fail_task(task_id, error_msg)
            return

        cap = None
        try:
            # -----------------------------------------------------------------
            # Edge Case 2: Codec & Header Decodability Probe
            # -----------------------------------------------------------------
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                error_msg = f"Failed to open video container. Incompatible codec or corrupted header in {video_path}"
                logger.error(error_msg)
                redis_manager.fail_task(task_id, error_msg)
                return

            # Probe initial frame to confirm decoder stability
            probe_ret, probe_frame = cap.read()
            if not probe_ret or probe_frame is None:
                error_msg = f"Corrupted media: Unable to decode first frame in {video_path}"
                logger.error(error_msg)
                redis_manager.fail_task(task_id, error_msg)
                return

            # Reset position to 0 after probe
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

            total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            if fps <= 0.1 or fps > 240.0 or math_isnan(fps):
                logger.warning("Unreliable FPS reported (%.2f). Defaulting to 30.0 FPS.", fps)
                fps = 30.0

            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if width <= 0 or height <= 0:
                width, height = probe_frame.shape[1], probe_frame.shape[0]

            duration_sec = total_video_frames / fps if fps > 0 and total_video_frames > 0 else 0.0

            logger.info("Validated video stream: %d frames, %.2f FPS, %dx%d, Duration: %.2fs",
                        total_video_frames, fps, width, height, duration_sec)

            redis_manager.init_task(task_id, video_id, max(1, total_video_frames))
            frame_step = max(1, int(fps * sample_interval_sec))

            yolo = self._get_yolo_model()
            names_dict = yolo.names if hasattr(yolo, 'names') else {}

            telemetry_batch: List[Dict[str, Any]] = []
            text_summaries_batch: List[str] = []
            metadata_batch: List[Dict[str, Any]] = []

            frame_idx = 0
            processed_samples = 0
            corrupted_frames_encountered = 0

            # -----------------------------------------------------------------
            # Safe Frame Decoding & Inference Loop
            # -----------------------------------------------------------------
            while cap.isOpened():
                try:
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        # Reached natural end of file or unexpected stream truncation
                        break
                except (cv2.error, Exception) as decode_err:
                    logger.warning("Decoder exception on frame %d: %s. Halting stream gracefully.", frame_idx, decode_err)
                    corrupted_frames_encountered += 1
                    break

                if frame_idx % frame_step == 0:
                    timestamp_ms = int((frame_idx / fps) * 1000)
                    time_str = self.format_timestamp(timestamp_ms)

                    try:
                        # YOLO Object Detection
                        results = yolo(frame, conf=settings.YOLO_CONFIDENCE_THRESHOLD, verbose=False)
                        detections: List[Dict[str, Any]] = []
                        labels_count: Dict[str, int] = {}

                        for r in results:
                            boxes = r.boxes
                            for box in boxes:
                                cls_id = int(box.cls[0].item())
                                conf = float(box.conf[0].item())
                                coords = box.xyxy[0].tolist()
                                label = names_dict.get(cls_id, f"object_{cls_id}")

                                # Normalized coordinates [0.0 - 1.0]
                                x1_norm = max(0.0, min(1.0, coords[0] / max(1, width)))
                                y1_norm = max(0.0, min(1.0, coords[1] / max(1, height)))
                                x2_norm = max(0.0, min(1.0, coords[2] / max(1, width)))
                                y2_norm = max(0.0, min(1.0, coords[3] / max(1, height)))

                                detections.append({
                                    "class_id": cls_id,
                                    "label": label,
                                    "confidence": round(conf, 4),
                                    "bbox": [round(c, 2) for c in coords],
                                    "bbox_normalized": [round(c, 4) for c in [x1_norm, y1_norm, x2_norm, y2_norm]]
                                })
                                labels_count[label] = labels_count.get(label, 0) + 1

                        # Formulate scene text
                        detected_str = ", ".join([f"{count} {lbl}" for lbl, count in labels_count.items()])
                        if not detected_str:
                            detected_str = "no prominent objects detected"

                        incident_context_str = ""
                        if incident_title or incident_notes:
                            incident_context_str = f"Incident context: {incident_title or ''}. {incident_notes or ''}".strip()

                        scene_summary = (
                            f"Frame at {time_str} ({timestamp_ms}ms). "
                            f"Detected items: {detected_str}. "
                            f"{incident_context_str}"
                        ).strip()

                        telemetry_doc = {
                            "video_id": video_id,
                            "frame_index": frame_idx,
                            "timestamp_ms": timestamp_ms,
                            "frame_width": width,
                            "frame_height": height,
                            "scene_summary": scene_summary,
                            "incident_context": incident_context_str if incident_context_str else None,
                            "detections": detections,
                            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        }

                        telemetry_batch.append(telemetry_doc)
                        text_summaries_batch.append(scene_summary)
                        metadata_batch.append({
                            "video_id": video_id,
                            "frame_index": frame_idx,
                            "timestamp_ms": timestamp_ms,
                            "scene_summary": scene_summary,
                            "incident_id": incident_id
                        })

                        processed_samples += 1
                        progress = min(90.0, (frame_idx / max(1, total_video_frames)) * 100.0)
                        redis_manager.update_task_progress(task_id, "PROCESSING_FRAMES", frame_idx, total_video_frames, progress)

                    except Exception as frame_err:
                        logger.error("Error evaluating frame %d: %s. Skipping frame.", frame_idx, frame_err)
                        continue

                frame_idx += 1

            # -----------------------------------------------------------------
            # Edge Case 3: Partial / Truncated Recovery
            # -----------------------------------------------------------------
            if processed_samples == 0:
                error_msg = "Corrupted video: Zero valid keyframes could be decoded and processed."
                logger.error(error_msg)
                redis_manager.fail_task(task_id, error_msg)
                return

            if corrupted_frames_encountered > 0 or (total_video_frames > 0 and frame_idx < total_video_frames * 0.7):
                logger.warning("Video stream truncated early at frame %d/%d. Proceeding with %d indexed samples.",
                               frame_idx, total_video_frames, processed_samples)

            # Batch MongoDB Ingestion
            redis_manager.update_task_progress(task_id, "SAVING_TELEMETRY", frame_idx, total_video_frames, 92.0)
            logger.info("Persisting %d frame telemetry documents into MongoDB", len(telemetry_batch))
            mongo_repo.insert_batch_telemetry(telemetry_batch)

            # Batch Sentence Transformers Embedding & FAISS Indexing
            redis_manager.update_task_progress(task_id, "GENERATING_EMBEDDINGS", frame_idx, total_video_frames, 95.0)
            if text_summaries_batch:
                logger.info("Generating dense embeddings for %d scene summaries", len(text_summaries_batch))
                embeddings = embedder.encode(text_summaries_batch, normalize=True)

                redis_manager.update_task_progress(task_id, "UPDATING_FAISS_INDEX", frame_idx, total_video_frames, 98.0)
                logger.info("Indexing embeddings into FAISS")
                vector_index_manager.add_vectors(embeddings, metadata_batch)

            # Invalidate Redis Semantic Query Cache
            invalidated_keys = redis_manager.invalidate_search_cache()
            logger.info("Search cache invalidated (%d entries cleared) due to new video indexing.", invalidated_keys)

            redis_manager.complete_task(task_id)
            logger.info("Ingestion task %s for video %s successfully completed (%d frames sampled)!",
                        task_id, video_id, processed_samples)

        except Exception as e:
            logger.exception("Unexpected error during video ingestion for %s: %s", video_id, e)
            redis_manager.fail_task(task_id, str(e))
        finally:
            if cap is not None and cap.isOpened():
                cap.release()
                logger.debug("Released OpenCV capture stream.")


def math_isnan(val: float) -> bool:
    import math
    return math.isnan(val)

video_processor = VideoIngestionProcessor()
