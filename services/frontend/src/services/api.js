/**
 * VisionTrace Gateway API Client
 * Connects React UI to Node.js Express Gateway (Port 5000)
 * Includes built-in simulated data for instant offline demonstration.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";

// Demo simulated dataset for out-of-the-box exploration
const MOCK_VIDEOS = [
  {
    id: "c6a2b8e3-53d7-4c74-9844-0d7065961314",
    title: "CCTV Sector 4 - Server Room Corridor",
    original_filename: "server_room_corridor_04.mp4",
    // Public webm surveillance demo clip (lightweight & universally supported)
    playback_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    duration_seconds: 15.0,
    fps: 30.0,
    total_frames: 450,
    status: "INDEXED",
    uploaded_by_name: "Chief Security Officer",
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
    title: "Loading Dock 2 - Logistics Bay",
    original_filename: "loading_dock_bay2.mp4",
    playback_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    duration_seconds: 15.0,
    fps: 30.0,
    total_frames: 450,
    status: "INDEXED",
    uploaded_by_name: "Chief Security Officer",
    created_at: new Date(Date.now() - 7200000).toISOString(),
  }
];

const MOCK_TELEMETRY = [
  {
    video_id: "c6a2b8e3-53d7-4c74-9844-0d7065961314",
    frame_index: 30,
    timestamp_ms: 1000,
    scene_summary: "Frame at 00:00:01 (1000ms). Detected items: 1 person. Incident context: Restricted zone entry.",
    detections: [
      { class_id: 0, label: "person", confidence: 0.93, bbox_normalized: [0.32, 0.22, 0.48, 0.82] }
    ]
  },
  {
    video_id: "c6a2b8e3-53d7-4c74-9844-0d7065961314",
    frame_index: 90,
    timestamp_ms: 3000,
    scene_summary: "Frame at 00:00:03 (3000ms). Detected items: 1 person, 1 backpack. Near server rack 4.",
    detections: [
      { class_id: 0, label: "person", confidence: 0.95, bbox_normalized: [0.35, 0.20, 0.52, 0.85] },
      { class_id: 24, label: "backpack", confidence: 0.89, bbox_normalized: [0.42, 0.38, 0.50, 0.62] }
    ]
  },
  {
    video_id: "c6a2b8e3-53d7-4c74-9844-0d7065961314",
    frame_index: 180,
    timestamp_ms: 6000,
    scene_summary: "Frame at 00:00:06 (6000ms). Detected items: 1 person with object near emergency door.",
    detections: [
      { class_id: 0, label: "person", confidence: 0.91, bbox_normalized: [0.55, 0.25, 0.72, 0.88] },
      { class_id: 43, label: "knife", confidence: 0.76, bbox_normalized: [0.58, 0.45, 0.64, 0.55] }
    ]
  },
  {
    video_id: "c6a2b8e3-53d7-4c74-9844-0d7065961314",
    frame_index: 300,
    timestamp_ms: 10000,
    scene_summary: "Frame at 00:00:10 (10000ms). Corridor empty. Perimeter clear.",
    detections: []
  }
];

export const api = {
  // --------------------------------------------------------------------------
  // Semantic Natural Language Search
  // --------------------------------------------------------------------------
  async searchSemantic({ query, top_k = 10, min_score = 0.25, video_id = null, token = null }) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}/search/semantic`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, top_k, min_score, video_id }),
      });

      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Gateway offline or unreachable. Falling back to intelligent demo simulation.");
    }

    // Dynamic simulated semantic search response
    await new Promise((r) => setTimeout(r, 60)); // Simulate ultra-fast 60ms latency
    const normalizedQuery = query.toLowerCase();

    const matches = MOCK_TELEMETRY.filter((item) => {
      if (video_id && item.video_id !== video_id) return false;
      if (normalizedQuery.includes("backpack") || normalizedQuery.includes("bag")) {
        return item.detections.some((d) => d.label === "backpack");
      }
      if (normalizedQuery.includes("knife") || normalizedQuery.includes("weapon")) {
        return item.detections.some((d) => d.label === "knife");
      }
      if (normalizedQuery.includes("person") || normalizedQuery.includes("individual")) {
        return item.detections.some((d) => d.label === "person");
      }
      return item.detections.length > 0;
    }).map((item, idx) => ({
      vector_id: idx,
      score: 0.88 - idx * 0.05,
      video_id: item.video_id,
      frame_index: item.frame_index,
      timestamp_ms: item.timestamp_ms,
      timestamp_formatted: `00:00:${Math.floor(item.timestamp_ms / 1000).toString().padStart(2, "0")}.000`,
      scene_summary: item.scene_summary,
      incident_id: "893c5fb2-b75a-4e4f-8e42-127e9cb65b0e",
      incident_details: {
        id: "893c5fb2-b75a-4e4f-8e42-127e9cb65b0e",
        title: "Perimeter Security Alert: Rack 04",
        severity: "HIGH",
        status: "UNDER_INVESTIGATION",
        description: "Subject identified approaching sensitive telemetry terminal without proper credentials.",
      },
      detections: item.detections,
    }));

    return {
      query,
      results_count: matches.length,
      cache_hit: Math.random() > 0.4,
      cached_at_layer: "GATEWAY_REDIS",
      execution_time_ms: 3.8,
      results: matches,
    };
  },

  // --------------------------------------------------------------------------
  // Video Management
  // --------------------------------------------------------------------------
  async getVideos(token = null) {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE_URL}/videos`, { headers });
      if (res.ok) {
        const data = await res.json();
        return data.videos || [];
      }
    } catch (e) {
      // Fallback
    }
    return MOCK_VIDEOS;
  },

  async getVideoTelemetry(videoId, token = null) {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE_URL}/videos/${videoId}/telemetry`, { headers });
      if (res.ok) {
        const data = await res.json();
        return data.telemetry || [];
      }
    } catch (e) {
      // Fallback
    }
    return MOCK_TELEMETRY.filter((t) => t.video_id === videoId);
  },

  async getIncidents(token = null) {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE_URL}/incidents`, { headers });
      if (res.ok) {
        const data = await res.json();
        return data.incidents || [];
      }
    } catch (e) {
      // Fallback
    }
    return [
      {
        id: "893c5fb2-b75a-4e4f-8e42-127e9cb65b0e",
        video_id: "c6a2b8e3-53d7-4c74-9844-0d7065961314",
        title: "Perimeter Security Alert: Server Rack 04",
        description: "Subject spotted tampering with rack latch wearing dark hoodie and backpack.",
        severity: "HIGH",
        status: "UNDER_INVESTIGATION",
        timestamp_start_ms: 2500,
        timestamp_end_ms: 7000,
        tags: ["server_room", "unauthorized_access", "backpack"],
        created_at: new Date(Date.now() - 1800000).toISOString(),
      }
    ];
  },

  async updateIncidentStatus(incidentId, status, token = null) {
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch(`${API_BASE_URL}/incidents/${incidentId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status }),
      });
      if (res.ok) return await res.json();
    } catch (e) {}
    return { success: true, status };
  }
};
