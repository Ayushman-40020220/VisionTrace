const { MongoClient } = require("mongodb");
const config = require("../config");

let client = null;
let db = null;
let telemetryCollection = null;

// In-memory fallback if MongoDB service is offline during local test runs
const localTelemetryStore = new Map();

async function connectMongo() {
  if (telemetryCollection) return telemetryCollection;

  try {
    client = new MongoClient(config.mongo.uri, {
      serverSelectionTimeoutMS: 2500,
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
    });
    await client.connect();
    db = client.db(config.mongo.dbName);
    telemetryCollection = db.collection(config.mongo.collectionName);

    // Ensure Indexes
    await telemetryCollection.createIndex({ video_id: 1, frame_index: 1 }, { unique: true });
    await telemetryCollection.createIndex({ video_id: 1, timestamp_ms: 1 });
    await telemetryCollection.createIndex({ "detections.label": 1 });

    console.log(`[MongoDB] Connected successfully to collection: ${config.mongo.dbName}.${config.mongo.collectionName}`);
    return telemetryCollection;
  } catch (err) {
    console.warn(`[MongoDB Warning] Could not connect to MongoDB (${err.message}). Using resilient in-memory fallback.`);
    telemetryCollection = null;
    return null;
  }
}

/**
 * Retrieves a single frame's detection telemetry and coordinates
 */
async function getFrameTelemetry(videoId, frameIndex) {
  if (telemetryCollection) {
    return await telemetryCollection.findOne(
      { video_id: videoId, frame_index: parseInt(frameIndex, 10) },
      { projection: { _id: 0 } }
    );
  }
  const key = `${videoId}:${frameIndex}`;
  return localTelemetryStore.get(key) || null;
}

/**
 * Retrieves telemetry across a timestamp interval (e.g. for an incident playback range)
 */
async function getTelemetryByTimestampRange(videoId, startMs, endMs) {
  if (telemetryCollection) {
    const cursor = telemetryCollection
      .find({
        video_id: videoId,
        timestamp_ms: { $gte: parseInt(startMs, 10), $lte: parseInt(endMs, 10) },
      })
      .project({ _id: 0 })
      .sort({ timestamp_ms: 1 });
    return await cursor.toArray();
  }

  const results = [];
  for (const item of localTelemetryStore.values()) {
    if (item.video_id === videoId && item.timestamp_ms >= startMs && item.timestamp_ms <= endMs) {
      results.push(item);
    }
  }
  return results.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
}

/**
 * Stores a frame telemetry document with bounding boxes and coordinates
 */
async function saveFrameTelemetry(doc) {
  if (telemetryCollection) {
    await telemetryCollection.updateOne(
      { video_id: doc.video_id, frame_index: doc.frame_index },
      { $set: doc },
      { upsert: true }
    );
  } else {
    const key = `${doc.video_id}:${doc.frame_index}`;
    localTelemetryStore.set(key, doc);
  }
}

/**
 * Batch stores frame telemetry documents
 */
async function saveBatchFrameTelemetry(docs) {
  if (!docs || docs.length === 0) return;

  if (telemetryCollection) {
    const operations = docs.map((doc) => ({
      updateOne: {
        filter: { video_id: doc.video_id, frame_index: doc.frame_index },
        update: { $set: doc },
        upsert: true,
      },
    }));
    await telemetryCollection.bulkWrite(operations, { ordered: false });
  } else {
    for (const doc of docs) {
      const key = `${doc.video_id}:${doc.frame_index}`;
      localTelemetryStore.set(key, doc);
    }
  }
}

/**
 * Lists all telemetry for a video up to a limit
 */
async function listVideoTelemetry(videoId, limit = 500) {
  if (telemetryCollection) {
    return await telemetryCollection
      .find({ video_id: videoId })
      .project({ _id: 0 })
      .sort({ frame_index: 1 })
      .limit(parseInt(limit, 10))
      .toArray();
  }

  const list = [];
  for (const item of localTelemetryStore.values()) {
    if (item.video_id === videoId) list.push(item);
  }
  return list.sort((a, b) => a.frame_index - b.frame_index).slice(0, limit);
}

module.exports = {
  connectMongo,
  getFrameTelemetry,
  getTelemetryByTimestampRange,
  saveFrameTelemetry,
  saveBatchFrameTelemetry,
  listVideoTelemetry,
};
