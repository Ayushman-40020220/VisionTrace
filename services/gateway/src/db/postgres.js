const { Pool } = require("pg");
const config = require("../config");

const pool = new Pool(config.postgres);

pool.on("connect", () => {
  console.log("[PostgreSQL] Connection pool established with database:", config.postgres.database);
});

pool.on("error", (err) => {
  console.error("[PostgreSQL] Unexpected error on idle client in pool:", err);
});

/**
 * Executes a SQL query with parameter binding
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      console.warn(`[PostgreSQL Slow Query] (${duration}ms) Query: ${text}`);
    }
    return res;
  } catch (err) {
    console.error(`[PostgreSQL Query Error] ${err.message}. SQL: ${text}`);
    throw err;
  }
}

/**
 * Logs an immutable audit trail entry for security compliance
 */
async function logAuditTrail(userId, action, targetResource, targetId, metadata = {}, ipAddress = null) {
  const sql = `
    INSERT INTO audit_logs (user_id, action, target_resource, target_id, metadata, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, created_at;
  `;
  try {
    const res = await pool.query(sql, [
      userId || null,
      action,
      targetResource,
      targetId || null,
      JSON.stringify(metadata),
      ipAddress || null,
    ]);
    return res.rows[0];
  } catch (err) {
    console.error("[PostgreSQL Audit Log Error]", err.message);
    return null;
  }
}

/**
 * Creates a structured incident linked to a video and specific timestamp window
 */
async function createIncident({
  videoId,
  userId,
  title,
  description,
  severity = "MEDIUM",
  timestampStartMs,
  timestampEndMs,
  tags = [],
  ipAddress = null,
}) {
  const sql = `
    INSERT INTO incidents (video_id, created_by, title, description, severity, timestamp_start_ms, timestamp_end_ms, tags)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;
  const res = await pool.query(sql, [
    videoId,
    userId,
    title,
    description,
    severity,
    timestampStartMs,
    timestampEndMs,
    tags,
  ]);
  const incident = res.rows[0];

  await logAuditTrail(
    userId,
    "INCIDENT_CREATE",
    "incident",
    incident.id,
    { title, severity, timestampStartMs, timestampEndMs },
    ipAddress
  );

  return incident;
}

/**
 * Retrieves incident records with optional filters
 */
async function queryIncidents({ videoId, severity, status, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (videoId) {
    params.push(videoId);
    conditions.push(`i.video_id = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    conditions.push(`i.severity = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`i.status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    SELECT i.*, v.title AS video_title, v.original_filename, u.full_name AS created_by_name, u.email AS created_by_email
    FROM incidents i
    JOIN videos v ON i.video_id = v.id
    JOIN users u ON i.created_by = u.id
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;

  const res = await pool.query(sql, params);
  return res.rows;
}

/**
 * Updates an incident's resolution status with an audit entry
 */
async function updateIncidentStatus(incidentId, newStatus, userId, ipAddress = null) {
  const sql = `
    UPDATE incidents
    SET status = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *;
  `;
  const res = await pool.query(sql, [newStatus, incidentId]);
  if (res.rows.length === 0) return null;

  const updated = res.rows[0];
  await logAuditTrail(
    userId,
    "INCIDENT_STATUS_UPDATE",
    "incident",
    incidentId,
    { previous_status: updated.status, new_status: newStatus },
    ipAddress
  );

  return updated;
}

/**
 * Inserts or updates video metadata
 */
async function createVideoRecord({ userId, title, originalFilename, storagePath, fileSizeBytes }) {
  const sql = `
    INSERT INTO videos (uploaded_by, title, original_filename, storage_path, file_size_bytes, status)
    VALUES ($1, $2, $3, $4, $5, 'QUEUED')
    RETURNING *;
  `;
  const res = await pool.query(sql, [userId, title, originalFilename, storagePath, fileSizeBytes]);
  return res.rows[0];
}

async function updateVideoStatus(videoId, status, durationSec = null, fps = null, totalFrames = null, errorMsg = null) {
  const sql = `
    UPDATE videos
    SET status = $1,
        duration_seconds = COALESCE($2, duration_seconds),
        fps = COALESCE($3, fps),
        total_frames = COALESCE($4, total_frames),
        error_message = $5,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $6
    RETURNING *;
  `;
  const res = await pool.query(sql, [status, durationSec, fps, totalFrames, errorMsg, videoId]);
  return res.rows[0];
}

async function listVideos() {
  const sql = `
    SELECT v.*, u.full_name AS uploaded_by_name
    FROM videos v
    JOIN users u ON v.uploaded_by = u.id
    ORDER BY v.created_at DESC;
  `;
  const res = await pool.query(sql);
  return res.rows;
}

async function getVideoById(id) {
  const sql = `
    SELECT v.*, u.full_name AS uploaded_by_name
    FROM videos v
    JOIN users u ON v.uploaded_by = u.id
    WHERE v.id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
}

module.exports = {
  pool,
  query,
  logAuditTrail,
  createIncident,
  queryIncidents,
  updateIncidentStatus,
  createVideoRecord,
  updateVideoStatus,
  listVideos,
  getVideoById,
};
