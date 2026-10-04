// ============================================================================
// VisionTrace MongoDB Schema Validation & Index Setup Script
// Frame Telemetry Document Store
// ============================================================================

db = db.getSiblingDB("visiontrace");

// 1. Create or update collection with JSON Schema Validation
db.createCollection("frame_telemetry", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["video_id", "frame_index", "timestamp_ms", "detections", "created_at"],
      properties: {
        _id: {
          bsonType: "objectId"
        },
        video_id: {
          bsonType: "string",
          pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
          description: "Must be a valid UUID string matching PostgreSQL video ID"
        },
        frame_index: {
          bsonType: "int",
          minimum: 0,
          description: "Zero-based sequential frame number"
        },
        timestamp_ms: {
          bsonType: "int",
          minimum: 0,
          description: "Elapsed time in milliseconds from video start"
        },
        frame_width: {
          bsonType: "int",
          minimum: 1
        },
        frame_height: {
          bsonType: "int",
          minimum: 1
        },
        scene_summary: {
          bsonType: "string",
          description: "Synthesized natural language summary of detections and context"
        },
        incident_context: {
          bsonType: "string",
          description: "Associated incident log text if frame falls within incident window"
        },
        detections: {
          bsonType: "array",
          description: "Array of objects detected by YOLOv8 in this frame",
          items: {
            bsonType: "object",
            required: ["class_id", "label", "confidence", "bbox", "bbox_normalized"],
            properties: {
              class_id: {
                bsonType: "int",
                minimum: 0
              },
              label: {
                bsonType: "string"
              },
              confidence: {
                bsonType: "double",
                minimum: 0.0,
                maximum: 1.0
              },
              bbox: {
                bsonType: "array",
                minItems: 4,
                maxItems: 4,
                items: { bsonType: "double" },
                description: "[x_min, y_min, x_max, y_max] in pixels"
              },
              bbox_normalized: {
                bsonType: "array",
                minItems: 4,
                maxItems: 4,
                items: { bsonType: "double" },
                description: "[x_min, y_min, x_max, y_max] normalized from 0.0 to 1.0"
              }
            }
          }
        },
        created_at: {
          bsonType: "date"
        }
      }
    }
  },
  validationLevel: "moderate",
  validationAction: "warn"
});

// 2. High-Performance Compound & Multikey Indexes
db.frame_telemetry.createIndex(
  { video_id: 1, frame_index: 1 },
  { unique: true, name: "idx_video_frame_unique" }
);

db.frame_telemetry.createIndex(
  { video_id: 1, timestamp_ms: 1 },
  { name: "idx_video_timestamp" }
);

db.frame_telemetry.createIndex(
  { "detections.label": 1, confidence: -1 },
  { name: "idx_detections_label_confidence" }
);

db.frame_telemetry.createIndex(
  { video_id: 1, "detections.label": 1 },
  { name: "idx_video_detections_label" }
);

print("VisionTrace MongoDB schema validator and indexes initialized successfully.");
