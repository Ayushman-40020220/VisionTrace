const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const config = require("./config");

// Database & Cache Connections
const postgres = require("./db/postgres");
const mongoDb = require("./db/mongo");
const redisDb = require("./db/redis");

// Route Handlers
const authRoutes = require("./routes/auth.routes");
const videoRoutes = require("./routes/video.routes");
const incidentRoutes = require("./routes/incident.routes");
const searchRoutes = require("./routes/search.routes");

const app = express();

// Security & Parsing Middleware
app.use(helmet({ crossOriginResourcePolicy: false })); // Allow cross-origin video streaming
app.use(cors({ origin: "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Static Video Streaming Directory
app.use("/uploads", express.static(path.resolve(config.uploadDir)));

// Mount REST Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/videos", videoRoutes);
app.use("/api/v1/incidents", incidentRoutes);
app.use("/api/v1/search", searchRoutes);

// Health & System Status Endpoint
app.get("/health", async (req, res) => {
  let pgHealthy = false;
  try {
    await postgres.query("SELECT 1");
    pgHealthy = true;
  } catch (e) {
    pgHealthy = false;
  }

  res.json({
    status: "HEALTHY",
    service: "VisionTrace Node.js API Gateway",
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    databases: {
      postgres: pgHealthy ? "CONNECTED" : "DISCONNECTED",
      mongo: "CONNECTED",
      redis: "CONNECTED",
    },
    ai_engine_upstream: config.aiEngineUrl,
  });
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error("[VisionTrace Gateway Error]", err);
  res.status(err.status || 500).json({
    error: err.name || "InternalServerError",
    message: err.message || "An unexpected error occurred on the API Gateway.",
  });
});

// Initialize Polyglot Database Connections and Start Server
async function startServer() {
  await mongoDb.connectMongo();
  await redisDb.connectRedis();

  app.listen(config.port, () => {
    console.log("============================================================");
    console.log(`[VisionTrace Gateway] Server running on port ${config.port}`);
    console.log(`[VisionTrace Gateway] Forwarding AI queries to: ${config.aiEngineUrl}`);
    console.log(`[VisionTrace Gateway] Media uploads served from: ${config.uploadDir}`);
    console.log("============================================================");
  });
}

startServer();

module.exports = app;
