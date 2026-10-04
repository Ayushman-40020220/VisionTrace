const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const axios = require("axios");
const postgres = require("../db/postgres");
const mongoDb = require("../db/mongo");
const redisDb = require("../db/redis");
const config = require("../config");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();

const uploadDirectory = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirectory),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

/**
 * POST /api/v1/videos/upload
 * Requires ADMIN role. Uploads video, registers in PostgreSQL, invalidates cache,
 * and delegates AI processing to FastAPI.
 */
router.post(
  "/upload",
  authenticateToken,
  requireRole(["ADMIN"]),
  upload.single("video"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No video file attached in form-data." });
    }

    const { title, incident_title, incident_notes, sample_interval_sec } = req.body;
    const videoTitle = title || req.file.originalname;
    const filePath = path.resolve(req.file.path);
    const fileSizeBytes = req.file.size;

    try {
      // 1. Create PostgreSQL Video Record
      const video = await postgres.createVideoRecord({
        userId: req.user.id,
        title: videoTitle,
        originalFilename: req.file.originalname,
        storagePath: filePath,
        fileSizeBytes,
      });

      // 2. Delegate Ingestion to FastAPI AI Engine
      let aiTaskResponse = null;
      try {
        const aiResponse = await axios.post(
          `${config.aiEngineUrl}/ingest`,
          {
            video_id: video.id,
            video_path: filePath,
            title: videoTitle,
            incident_title: incident_title || null,
            incident_notes: incident_notes || null,
            sample_interval_sec: sample_interval_sec ? parseFloat(sample_interval_sec) : 1.0,
          },
          { timeout: 5000 }
        );
        aiTaskResponse = aiResponse.data;
        await postgres.updateVideoStatus(video.id, "PROCESSING");
      } catch (aiErr) {
        console.error("[AI Ingest Error]", aiErr.message);
        await postgres.updateVideoStatus(video.id, "FAILED", null, null, null, aiErr.message);
      }

      // 3. Invalidate Redis Semantic Search Cache (New video indexed)
      await redisDb.invalidateSearchCache();

      // 4. Log Compliance Audit Trail
      await postgres.logAuditTrail(
        req.user.id,
        "VIDEO_UPLOAD",
        "video",
        video.id,
        { filename: req.file.originalname, size: fileSizeBytes, task: aiTaskResponse },
        req.ip
      );

      return res.status(202).json({
        message: "Video uploaded successfully. AI ingestion worker dispatched.",
        video: { ...video, status: "PROCESSING" },
        task: aiTaskResponse,
      });
    } catch (err) {
      console.error("[Upload Route Error]", err);
      return res.status(500).json({ error: "Failed to process video upload." });
    }
  }
);

/**
 * GET /api/v1/videos
 * Accessible by ADMIN and AUDITOR.
 */
router.get("/", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  try {
    const videos = await postgres.listVideos();
    return res.json({ count: videos.length, videos });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list videos." });
  }
});

/**
 * GET /api/v1/videos/:id
 */
router.get("/:id", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  try {
    const video = await postgres.getVideoById(req.params.id);
    if (!video) {
      return res.status(404).json({ error: "Video not found." });
    }
    return res.json({ video });
  } catch (err) {
    return res.status(500).json({ error: "Database error." });
  }
});

/**
 * GET /api/v1/videos/tasks/:taskId
 * Checks real-time video processing progress directly from Redis (or proxies to FastAPI)
 */
router.get("/tasks/:taskId", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  const taskId = req.params.taskId;

  // 1. Direct Redis Check (Fastest)
  const taskStatus = await redisDb.getTaskStatus(taskId);
  if (taskStatus) {
    return res.json(taskStatus);
  }

  // 2. Fallback to FastAPI endpoint
  try {
    const response = await axios.get(`${config.aiEngineUrl}/tasks/${taskId}`, { timeout: 3000 });
    return res.json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 404;
    return res.status(status).json({ error: "Task not found or expired." });
  }
});

/**
 * GET /api/v1/videos/:id/telemetry
 * Fetches MongoDB frame telemetry (detection coordinates, labels, confidences)
 */
router.get("/:id/telemetry", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  const videoId = req.params.id;
  const limit = req.query.limit || 500;

  try {
    // Direct MongoDB Query from Gateway
    const telemetry = await mongoDb.listVideoTelemetry(videoId, limit);
    if (telemetry && telemetry.length > 0) {
      return res.json({
        video_id: videoId,
        source: "GATEWAY_MONGODB_DIRECT",
        count: telemetry.length,
        telemetry,
      });
    }

    // Fallback to FastAPI
    const response = await axios.get(`${config.aiEngineUrl}/telemetry/${videoId}?limit=${limit}`);
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to retrieve frame telemetry." });
  }
});

module.exports = router;
