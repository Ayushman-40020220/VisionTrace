require("dotenv").config();

module.exports = {
  port: parseInt(process.env.GATEWAY_PORT || "5000", 10),
  jwtSecret: process.env.JWT_SECRET || "visiontrace_jwt_super_secret_key_2026",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  
  // PostgreSQL Configuration (Users, Videos, Incidents, Audit Logs)
  postgres: {
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    database: process.env.PG_DATABASE || "visiontrace",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgrespassword",
    max: 20, // Connection pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
  },

  // MongoDB Configuration (Frame Telemetry & Detection Coordinates)
  mongo: {
    uri: process.env.MONGO_URI || "mongodb://localhost:27017",
    dbName: process.env.MONGO_DB_NAME || "visiontrace",
    collectionName: "frame_telemetry",
  },

  // Redis Configuration (Semantic Search Query Caching & Task Tracking)
  redis: {
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "6379"}`,
    cacheTTLSeconds: parseInt(process.env.REDIS_CACHE_TTL_SECONDS || "3600", 10),
  },

  // Downstream FastAPI AI Engine Reverse Proxy URL
  aiEngineUrl: process.env.AI_ENGINE_URL || "http://localhost:8000/internal/v1",
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
};
