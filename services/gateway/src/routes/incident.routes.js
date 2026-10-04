const express = require("express");
const postgres = require("../db/postgres");
const redisDb = require("../db/redis");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();

/**
 * POST /api/v1/incidents
 * Accessible by ADMIN and AUDITOR roles.
 * Creates structured incident linked to a video and specific timestamp window.
 */
router.post("/", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  const {
    video_id,
    title,
    description,
    severity,
    timestamp_start_ms,
    timestamp_end_ms,
    tags,
  } = req.body;

  if (!video_id || !title || !description || timestamp_start_ms === undefined || timestamp_end_ms === undefined) {
    return res.status(400).json({
      error: "Missing required fields: video_id, title, description, timestamp_start_ms, timestamp_end_ms",
    });
  }

  try {
    const incident = await postgres.createIncident({
      videoId: video_id,
      userId: req.user.id,
      title,
      description,
      severity: severity || "MEDIUM",
      timestampStartMs: parseInt(timestamp_start_ms, 10),
      timestampEndMs: parseInt(timestamp_end_ms, 10),
      tags: Array.isArray(tags) ? tags : [],
      ipAddress: req.ip,
    });

    // Invalidate semantic query cache to incorporate new incident context
    await redisDb.invalidateSearchCache();

    return res.status(201).json({
      message: "Incident logged successfully.",
      incident,
    });
  } catch (err) {
    console.error("[Create Incident Error]", err);
    return res.status(500).json({ error: "Failed to create incident record." });
  }
});

/**
 * GET /api/v1/incidents
 * Accessible by ADMIN and AUDITOR roles.
 */
router.get("/", authenticateToken, requireRole(["ADMIN", "AUDITOR"]), async (req, res) => {
  const { video_id, severity, status, limit, offset } = req.query;

  try {
    const incidents = await postgres.queryIncidents({
      videoId: video_id,
      severity,
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return res.json({ count: incidents.length, incidents });
  } catch (err) {
    console.error("[Query Incidents Error]", err);
    return res.status(500).json({ error: "Failed to retrieve incidents." });
  }
});

/**
 * PATCH /api/v1/incidents/:id/status
 * Updates status (e.g. OPEN -> UNDER_INVESTIGATION -> RESOLVED)
 * Accessible by ADMIN (and AUDITOR if allowed)
 */
router.patch("/:id/status", authenticateToken, requireRole(["ADMIN"]), async (req, res) => {
  const { status } = req.body;
  const allowed = ["OPEN", "UNDER_INVESTIGATION", "RESOLVED", "CLOSED"];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(", ")}` });
  }

  try {
    const updated = await postgres.updateIncidentStatus(
      req.params.id,
      status,
      req.user.id,
      req.ip
    );

    if (!updated) {
      return res.status(404).json({ error: "Incident not found." });
    }

    return res.json({ message: "Incident status updated.", incident: updated });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update incident status." });
  }
});

module.exports = router;
