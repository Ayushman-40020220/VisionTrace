#!/usr/bin/env python3
"""
===============================================================================
VisionTrace - Automated Synthetic Video & Incident Telemetry Generator
===============================================================================
Generates a realistic 60-second multi-zone surveillance video using OpenCV:
- Moving geometric targets simulating real-world security entities:
    1. Forklift with mast and beacon in Loading Dock (Zone A)
    2. Personnel with backpack in Server Room Vault (Zone B)
    3. Vehicle/Truck parked in Emergency Fire Lane (Zone C)
- Synthesizes correlated incident logs (JSON) matching frame timestamps.
- Features an automated client to register, upload, and trigger ingestion
  through the Node.js Express API Gateway (or fallback directly).
===============================================================================
"""

import os
import sys
import time
import json
import math
import argparse
import logging
from typing import Dict, Any, List

import numpy as np

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("VisionTrace.SyntheticData")

# Optional requests library for Gateway integration
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


class SyntheticVideoGenerator:
    def __init__(
        self,
        output_path: str = "synthetic_surveillance_60s.mp4",
        duration_sec: int = 60,
        fps: int = 15,
        width: int = 960,
        height: int = 540
    ):
        self.output_path = output_path
        self.duration_sec = duration_sec
        self.fps = fps
        self.width = width
        self.height = height
        self.total_frames = duration_sec * fps

    def generate(self) -> str:
        if not CV2_AVAILABLE:
            raise RuntimeError("OpenCV (cv2) is required for video synthesis. Install via: pip install opencv-python-headless")
        logger.info(
            "Synthesizing %d-second surveillance video at %d FPS (%dx%d) -> %s",
            self.duration_sec, self.fps, self.width, self.height, self.output_path
        )
        os.makedirs(os.path.dirname(os.path.abspath(self.output_path)) or ".", exist_ok=True)

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(self.output_path, fourcc, self.fps, (self.width, self.height))

        if not out.isOpened():
            raise RuntimeError(f"OpenCV could not open VideoWriter for {self.output_path}")

        start_epoch = 1791100000.0  # Base synthetic timestamp

        for frame_idx in range(self.total_frames):
            current_sec = frame_idx / self.fps
            timestamp_ms = int(current_sec * 1000)

            # Base Dark Facility Canvas
            frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
            frame[:] = (18, 22, 28)  # Deep obsidian surveillance tint

            # Draw Perspective Floor Grid & Safety Zones
            self._draw_facility_backdrop(frame)

            # -----------------------------------------------------------------
            # Target 1: Forklift in Loading Bay (Zone A, active 5s to 26s)
            # -----------------------------------------------------------------
            if 5.0 <= current_sec <= 26.0:
                rel_t = (current_sec - 5.0) / 21.0
                forklift_x = int(60 + rel_t * (self.width * 0.45))
                forklift_y = int(self.height * 0.65 - math.sin(rel_t * math.pi) * 30)
                self._draw_forklift(frame, forklift_x, forklift_y, frame_idx)

            # -----------------------------------------------------------------
            # Target 2: Personnel with Backpack in Server Vault (Zone B, active 18s to 48s)
            # -----------------------------------------------------------------
            if 18.0 <= current_sec <= 48.0:
                rel_t = (current_sec - 18.0) / 30.0
                person_x = int(self.width * 0.45 + rel_t * (self.width * 0.35))
                person_y = int(self.height * 0.42 + math.sin(rel_t * 6 * math.pi) * 8)
                self._draw_personnel_with_backpack(frame, person_x, person_y, frame_idx)

            # -----------------------------------------------------------------
            # Target 3: Vehicle / Truck in Emergency Lane (Zone C, active 35s to 58s)
            # -----------------------------------------------------------------
            if 35.0 <= current_sec <= 58.0:
                rel_t = min(1.0, (current_sec - 35.0) / 14.0)  # Drives in and parks
                truck_x = int(self.width * 0.88 - rel_t * (self.width * 0.30))
                truck_y = int(self.height * 0.70)
                self._draw_vehicle(frame, truck_x, truck_y, frame_idx)

            # -----------------------------------------------------------------
            # Surveillance HUD & HUD Telemetry Overlays
            # -----------------------------------------------------------------
            self._draw_hud_overlay(frame, frame_idx, current_sec, start_epoch)

            out.write(frame)

            if frame_idx % (self.fps * 10) == 0:
                logger.info("Rendered %d / %d frames (%.1f%%)", frame_idx, self.total_frames, (frame_idx / self.total_frames) * 100)

        out.release()
        logger.info("Synthetic video synthesis completed: %s", os.path.abspath(self.output_path))
        return os.path.abspath(self.output_path)

    def _draw_facility_backdrop(self, frame: np.ndarray):
        h, w = self.height, self.width

        # Facility Walls & Ceilings
        cv2.line(frame, (0, int(h * 0.35)), (w, int(h * 0.35)), (40, 48, 60), 2)
        cv2.line(frame, (int(w * 0.45), 0), (int(w * 0.45), int(h * 0.35)), (45, 55, 70), 2)
        cv2.line(frame, (int(w * 0.75), 0), (int(w * 0.75), int(h * 0.35)), (45, 55, 70), 2)

        # Floor grid perspective lines
        for x in range(0, w, 80):
            cv2.line(frame, (x, int(h * 0.35)), (int(x * 1.4 - w * 0.2), h), (28, 34, 45), 1)

        # Zone A: Loading Dock
        cv2.rectangle(frame, (40, int(h * 0.48)), (int(w * 0.42), int(h * 0.92)), (35, 45, 30), 1)
        cv2.putText(frame, "[ZONE A - CARGO LOADING BAY]", (50, int(h * 0.52)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 180, 100), 1)

        # Zone B: Server Room Perimeter
        cv2.rectangle(frame, (int(w * 0.46), int(h * 0.38)), (int(w * 0.72), int(h * 0.70)), (45, 30, 40), 1)
        cv2.putText(frame, "[ZONE B - SECURE SERVER VAULT]", (int(w * 0.48), int(h * 0.42)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (150, 100, 200), 1)

        # Zone C: Emergency Fire Lane
        cv2.rectangle(frame, (int(w * 0.74), int(h * 0.45)), (w - 20, int(h * 0.92)), (50, 30, 30), 1)
        cv2.putText(frame, "[ZONE C - EMERGENCY ACCESS LANE]", (int(w * 0.75), int(h * 0.50)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 100, 100), 1)

    def _draw_forklift(self, frame: np.ndarray, x: int, y: int, frame_idx: int):
        # Chassis (Yellow/Amber industrial)
        cv2.rectangle(frame, (x, y), (x + 75, y + 40), (20, 180, 240), -1)
        # Mast (black upright)
        cv2.rectangle(frame, (x + 75, y - 25), (x + 85, y + 35), (80, 80, 90), -1)
        # Forks
        cv2.line(frame, (x + 85, y + 30), (x + 115, y + 30), (160, 160, 170), 4)
        # Cab cage
        cv2.rectangle(frame, (x + 20, y - 20), (x + 55, y), (50, 50, 60), 2)
        # Wheels
        cv2.circle(frame, (x + 20, y + 42), 12, (30, 30, 35), -1)
        cv2.circle(frame, (x + 65, y + 42), 12, (30, 30, 35), -1)
        # Blinking beacon
        if (frame_idx // 4) % 2 == 0:
            cv2.circle(frame, (x + 38, y - 24), 6, (0, 100, 255), -1)

    def _draw_personnel_with_backpack(self, frame: np.ndarray, x: int, y: int, frame_idx: int):
        # Head (skin/light)
        cv2.circle(frame, (x, y - 40), 12, (200, 210, 225), -1)
        # Torso (Dark jacket)
        cv2.rectangle(frame, (x - 14, y - 26), (x + 14, y + 15), (70, 75, 90), -1)
        # Backpack (Greenish cargo bag on back)
        cv2.rectangle(frame, (x - 24, y - 22), (x - 12, y + 6), (50, 140, 70), -1)
        # Legs with walking gait
        leg_offset = int(math.sin(frame_idx * 0.4) * 8)
        cv2.line(frame, (x - 7, y + 15), (x - 7 - leg_offset, y + 42), (40, 45, 55), 4)
        cv2.line(frame, (x + 7, y + 15), (x + 7 + leg_offset, y + 42), (40, 45, 55), 4)

    def _draw_vehicle(self, frame: np.ndarray, x: int, y: int, frame_idx: int):
        # Truck Cargo Box (Blue)
        cv2.rectangle(frame, (x, y - 45), (x + 110, y + 25), (180, 100, 40), -1)
        # Cab (Dark Blue)
        cv2.rectangle(frame, (x - 35, y - 20), (x, y + 25), (140, 70, 25), -1)
        # Windshield
        cv2.rectangle(frame, (x - 30, y - 16), (x - 12, y), (220, 220, 240), -1)
        # Wheels
        cv2.circle(frame, (x - 15, y + 27), 11, (25, 25, 30), -1)
        cv2.circle(frame, (x + 35, y + 27), 11, (25, 25, 30), -1)
        cv2.circle(frame, (x + 85, y + 27), 11, (25, 25, 30), -1)

    def _draw_hud_overlay(self, frame: np.ndarray, frame_idx: int, current_sec: float, start_epoch: float):
        # Top HUD Banner
        cv2.rectangle(frame, (0, 0), (self.width, 36), (10, 14, 18), -1)
        cv2.line(frame, (0, 36), (self.width, 36), (0, 242, 254), 1)

        # Blinking REC dot
        if (frame_idx // 10) % 2 == 0:
            cv2.circle(frame, (20, 18), 6, (0, 0, 255), -1)
        cv2.putText(frame, "REC", (32, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)

        # Camera Identifier
        cv2.putText(frame, "CAM-04 [FACILITY NORTH SECTOR]", (80, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

        # High Precision Timestamp
        millis = int((current_sec % 1.0) * 1000)
        secs = int(current_sec)
        time_str = f"2026-10-04 10:45:{secs:02d}.{millis:03d} UTC"
        cv2.putText(frame, time_str, (self.width - 290, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 242, 254), 1)

        # Frame counter & FPS indicator at bottom
        cv2.putText(
            frame,
            f"FRAME: {frame_idx:05d}/{self.total_frames} | {self.fps:.1f} FPS | RES: {self.width}x{self.height}",
            (16, self.height - 14),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (120, 130, 140),
            1
        )


def generate_structured_incidents() -> List[Dict[str, Any]]:
    """
    Generates structured incident events correlated with the 60-second video footage.
    """
    incidents = [
        {
            "title": "Forklift Speed Violation & Perimeter Breach in Zone A",
            "description": "Industrial forklift detected traveling in excess of authorized 8 km/h speed threshold in Cargo Loading Bay.",
            "severity": "HIGH",
            "timestamp_start_ms": 7000,
            "timestamp_end_ms": 23000,
            "tags": ["forklift", "loading_dock", "speed_violation", "zone_a"],
            "target_label": "forklift"
        },
        {
            "title": "Unauthorized Personnel with Cargo Bag Entering Server Vault",
            "description": "Unregistered individual carrying a green backpack identified traversing into Zone B Secure Server Room without escort.",
            "severity": "CRITICAL",
            "timestamp_start_ms": 21000,
            "timestamp_end_ms": 44000,
            "tags": ["person", "backpack", "restricted_access", "server_vault", "zone_b"],
            "target_label": "person"
        },
        {
            "title": "Vehicle Obstruction in Emergency Fire Lane",
            "description": "Commercial delivery truck stationary within designated emergency egress lane in Zone C.",
            "severity": "MEDIUM",
            "timestamp_start_ms": 38000,
            "timestamp_end_ms": 56000,
            "tags": ["vehicle", "truck", "emergency_lane", "obstruction", "zone_c"],
            "target_label": "truck"
        }
    ]
    return incidents


def auto_upload_to_gateway(
    gateway_url: str,
    video_path: str,
    incidents: List[Dict[str, Any]]
) -> bool:
    """
    Automates authentication, video upload, incident logging, and task verification
    through the Node.js API Gateway.
    """
    if not REQUESTS_AVAILABLE:
        logger.error("'requests' library is not installed. Run: pip install requests")
        return False

    logger.info("Connecting to VisionTrace Gateway at: %s", gateway_url)

    # 1. Authenticate / Register Admin
    auth_url = f"{gateway_url}/api/v1/auth"
    admin_creds = {
        "email": "auto_admin@visiontrace.internal",
        "password": "AutoAdminPassword123!",
        "full_name": "Automated Benchmark Admin",
        "role": "ADMIN"
    }

    token = None
    try:
        # Attempt Login first
        login_res = requests.post(f"{auth_url}/login", json={
            "email": admin_creds["email"],
            "password": admin_creds["password"]
        }, timeout=4)

        if login_res.status_code == 200:
            token = login_res.json().get("token")
            logger.info("Admin login successful. JWT token acquired.")
        else:
            # Register if not exists
            reg_res = requests.post(f"{auth_url}/register", json=admin_creds, timeout=4)
            if reg_res.status_code in (200, 201):
                token = reg_res.json().get("token")
                logger.info("Admin registered successfully. JWT token acquired.")
            else:
                logger.error("Authentication failed: %s", reg_res.text)
                return False
    except Exception as e:
        logger.warning("Could not reach Gateway at %s (%s).", gateway_url, e)
        return False

    headers = {"Authorization": f"Bearer {token}"}

    # 2. Upload Video
    logger.info("Uploading %s through Gateway...", video_path)
    try:
        with open(video_path, "rb") as vf:
            files = {"video": (os.path.basename(video_path), vf, "video/mp4")}
            data = {
                "title": "Facility North Sector - 60s Multi-Zone Audit",
                "incident_title": incidents[0]["title"],
                "incident_notes": incidents[0]["description"],
                "sample_interval_sec": "1.0"
            }
            upload_res = requests.post(f"{gateway_url}/api/v1/videos/upload", headers=headers, files=files, data=data, timeout=30)

        if upload_res.status_code not in (200, 201, 202):
            logger.error("Video upload failed: %s", upload_res.text)
            return False

        upload_data = upload_res.json()
        video_id = upload_data["video"]["id"]
        task_id = upload_data.get("task", {}).get("task_id")
        logger.info("Video successfully uploaded! Video ID: %s | Task ID: %s", video_id, task_id)

        # 3. Create Structured Incidents in PostgreSQL
        for inc in incidents:
            inc_payload = {
                "video_id": video_id,
                "title": inc["title"],
                "description": inc["description"],
                "severity": inc["severity"],
                "timestamp_start_ms": inc["timestamp_start_ms"],
                "timestamp_end_ms": inc["timestamp_end_ms"],
                "tags": inc["tags"]
            }
            inc_res = requests.post(f"{gateway_url}/api/v1/incidents", headers=headers, json=inc_payload, timeout=4)
            if inc_res.status_code in (200, 201):
                logger.info("Created incident record: '%s' [%s]", inc["title"], inc["severity"])
            else:
                logger.warning("Incident creation warning: %s", inc_res.text)

        # 4. Poll Ingestion Progress from Redis
        if task_id:
            logger.info("Polling asynchronous AI ingestion task %s...", task_id)
            for _ in range(30):
                poll_res = requests.get(f"{gateway_url}/api/v1/videos/tasks/{task_id}", headers=headers, timeout=3)
                if poll_res.status_code == 200:
                    status_data = poll_res.json()
                    stage = status_data.get("stage", "UNKNOWN")
                    pct = status_data.get("progress_percentage", 0.0)
                    logger.info("Ingestion Progress: %.1f%% [Stage: %s]", pct, stage)
                    if status_data.get("status") in ("COMPLETED", "FAILED"):
                        logger.info("Ingestion reached terminal state: %s", status_data.get("status"))
                        break
                time.sleep(1.5)

        return True
    except Exception as e:
        logger.error("Error during automated gateway upload: %s", e)
        return False


def main():
    parser = argparse.ArgumentParser(description="VisionTrace Synthetic Video & Telemetry Generator")
    parser.add_argument("--output", type=str, default="synthetic_surveillance_60s.mp4", help="Output video file path")
    parser.add_argument("--duration", type=int, default=60, help="Video duration in seconds")
    parser.add_argument("--fps", type=int, default=15, help="Frame rate")
    parser.add_argument("--upload", action="store_true", help="Automatically upload video and incidents to Gateway")
    parser.add_argument("--gateway-url", type=str, default="http://localhost:5000", help="Gateway base URL")
    parser.add_argument("--dump-incidents", type=str, default="scripts/synthetic_incidents.json", help="Path to save incident JSON")
    parser.add_argument("--only-incidents", action="store_true", help="Generate incident JSON without rendering video")

    args = parser.parse_args()

    # 1. Synthesize Video (if not skipped)
    video_abs_path = None
    if not args.only_incidents:
        generator = SyntheticVideoGenerator(
            output_path=args.output,
            duration_sec=args.duration,
            fps=args.fps
        )
        video_abs_path = generator.generate()

    # 2. Generate Incident Events
    incidents = generate_structured_incidents()
    os.makedirs(os.path.dirname(os.path.abspath(args.dump_incidents)) or ".", exist_ok=True)
    with open(args.dump_incidents, "w", encoding="utf-8") as f:
        json.dump(incidents, f, indent=2)
    logger.info("Exported %d structured incident events to %s", len(incidents), args.dump_incidents)

    # 3. Optional Automated Upload
    if args.upload:
        success = auto_upload_to_gateway(args.gateway_url, video_abs_path, incidents)
        if success:
            logger.info("Data seeding pipeline successfully executed!")
        else:
            logger.warning("Gateway upload skipped or failed. Video saved at %s", video_abs_path)
    else:
        print("\n" + "=" * 65)
        print("SYNTHETIC DATA READY FOR INGESTION:")
        print(f"  - Video File:    {video_abs_path}")
        print(f"  - Incident JSON: {os.path.abspath(args.dump_incidents)}")
        print("  - To auto-upload through Gateway, run:")
        print("      python scripts/generate_synthetic_data.py --upload")
        print("=" * 65)


if __name__ == "__main__":
    main()
