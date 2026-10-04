import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { VideoPlayerWithOverlay } from "./components/VideoPlayerWithOverlay";
import { SearchResultsList } from "./components/SearchResultsList";
import { IncidentCard } from "./components/IncidentCard";
import { VideoUploadModal } from "./components/VideoUploadModal";
import { api } from "./services/api";
import { Video, Film, CheckCircle2, ShieldCheck, Clock } from "lucide-react";

export function App() {
  const [role, setRole] = useState("AUDITOR");
  const [videos, setVideos] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchMeta, setSearchMeta] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [jumpToMs, setJumpToMs] = useState(null);
  const [currentPlaybackMs, setCurrentPlaybackMs] = useState(0);
  const [activeIncident, setActiveIncident] = useState(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Initialize data on component mount
  useEffect(() => {
    async function init() {
      const vids = await api.getVideos();
      setVideos(vids);
      if (vids.length > 0) {
        const first = vids[0];
        setActiveVideo(first);
        const telem = await api.getVideoTelemetry(first.id);
        setTelemetry(telem);
      }

      const incidents = await api.getIncidents();
      if (incidents.length > 0) {
        setActiveIncident(incidents[0]);
      }

      // Initial search run to populate matches for exploration
      handleSearch({
        query: "person with backpack near server rack",
        top_k: 5,
        min_score: 0.25,
      });
    }

    init();
  }, []);

  // Switch video stream
  const handleSelectVideo = async (video) => {
    setActiveVideo(video);
    const telem = await api.getVideoTelemetry(video.id);
    setTelemetry(telem);
    setSearchResults([]);
    setJumpToMs(0);
  };

  // Perform Natural-Language Semantic Search via Gateway
  const handleSearch = async ({ query, top_k, min_score }) => {
    setIsSearching(true);
    try {
      const resp = await api.searchSemantic({
        query,
        top_k,
        min_score,
        video_id: activeVideo ? activeVideo.id : null,
      });

      setSearchResults(resp.results || []);
      setSearchMeta({
        cache_hit: resp.cache_hit,
        execution_time_ms: resp.execution_time_ms,
        count: resp.results_count,
        layer: resp.cached_at_layer,
      });

      if (resp.results && resp.results.length > 0) {
        const topMatch = resp.results[0];
        // Automatically scrub video to the top match timestamp!
        setJumpToMs(topMatch.timestamp_ms);
        if (topMatch.incident_details) {
          setActiveIncident(topMatch.incident_details);
        }
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleStatusChange = async (incidentId, newStatus) => {
    const res = await api.updateIncidentStatus(incidentId, newStatus);
    if (activeIncident && activeIncident.id === incidentId) {
      setActiveIncident({ ...activeIncident, status: newStatus });
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* 1. Header with RBAC & cluster health */}
      <Header
        role={role}
        setRole={setRole}
        onOpenUpload={() => setIsUploadOpen(true)}
      />

      {/* 2. Main Container */}
      <main className="dashboard-container">
        {/* Natural Language Query Search Bar */}
        <SearchBar
          onSearch={handleSearch}
          isLoading={isSearching}
          lastMeta={searchMeta}
        />

        {/* Video Selector Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", overflowX: "auto", paddingBottom: "4px" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "6px" }}>
            <Film size={14} /> Active Feed:
          </span>
          {videos.map((vid) => {
            const isSelected = activeVideo && activeVideo.id === vid.id;
            return (
              <button
                key={vid.id}
                onClick={() => handleSelectVideo(vid)}
                style={{
                  background: isSelected ? "rgba(0, 242, 254, 0.15)" : "rgba(255, 255, 255, 0.04)",
                  border: isSelected ? "1px solid var(--accent-cyan)" : "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 14px",
                  color: isSelected ? "var(--text-highlight)" : "var(--text-secondary)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                }}
              >
                <span className="pulse-dot" style={{ backgroundColor: isSelected ? "var(--accent-cyan)" : "var(--accent-emerald)" }} />
                <span>{vid.title}</span>
                <span className="mono" style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  ({vid.duration_seconds}s)
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Content Grid: Video + Controls (Left) vs. Semantic Results (Right) */}
        <div className="grid-main">
          {/* Left Column: Video Player with Dynamic Bounding Box Overlay */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <VideoPlayerWithOverlay
              video={activeVideo}
              telemetry={telemetry}
              searchResults={searchResults}
              jumpToTimestampMs={jumpToMs}
              onTimestampChanged={(ms) => setCurrentPlaybackMs(ms)}
            />

            {/* Correlated Incident Card */}
            {activeIncident && (
              <IncidentCard
                incident={activeIncident}
                topConfidence={searchResults[0]?.score}
                onJumpToIncident={(startMs) => setJumpToMs(startMs)}
                onStatusChange={handleStatusChange}
                role={role}
              />
            )}
          </div>

          {/* Right Column: Search Results & Keyframe Matches */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <SearchResultsList
              results={searchResults}
              activeTimestampMs={currentPlaybackMs}
              onSelectTimestamp={(tsMs) => setJumpToMs(tsMs)}
              isLoading={isSearching}
            />

            {/* System Audit Info Card */}
            <div className="glass-panel" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ShieldCheck size={16} color="var(--accent-emerald)" />
                <h4 style={{ fontSize: "0.875rem" }}>Audit Integrity & Policy</h4>
              </div>
              <p style={{ fontSize: "0.775rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                All frame timestamps, YOLOv8 detections, and semantic searches are cryptographically logged in the
                PostgreSQL compliance audit trail. Searches with identical queries are served directly from Redis in &lt;10ms.
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                <span>Active Mode: <strong style={{ color: "var(--accent-cyan)" }}>{role}</strong></span>
                <span>Algorithm: <strong style={{ color: "var(--text-primary)" }}>FAISS FlatIP</strong></span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Video Upload Modal (Admin only) */}
      <VideoUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={async () => {
          const vids = await api.getVideos();
          setVideos(vids);
        }}
      />
    </div>
  );
}

export default App;
