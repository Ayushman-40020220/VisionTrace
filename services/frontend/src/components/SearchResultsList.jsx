import React from "react";
import { Clock, Play, Tag, Crosshair, AlertCircle } from "lucide-react";

export function SearchResultsList({
  results = [],
  activeTimestampMs,
  onSelectTimestamp,
  isLoading,
}) {
  if (isLoading) {
    return (
      <div className="glass-panel" style={{ padding: "24px", textAlign: "center" }}>
        <div style={{ color: "var(--accent-cyan)", marginBottom: "12px" }}>
          <span className="pulse-dot" style={{ display: "inline-block", width: "12px", height: "12px" }}></span>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Scanning FAISS vector index & hydrating MongoDB frame telemetry...
        </p>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: "24px", textAlign: "center" }}>
        <AlertCircle size={32} style={{ color: "var(--text-muted)", margin: "0 auto 12px" }} />
        <h4 style={{ fontSize: "1rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
          No Matching Incidents Found
        </h4>
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
          Try adjusting the cosine similarity threshold or searching for general objects like "person" or "backpack".
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: "1rem", display: "flex", alignItems: "center", gap: "8px" }}>
          <Clock size={16} color="var(--accent-cyan)" />
          <span>Retrieved Incident Keyframes ({results.length})</span>
        </h3>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Click match to auto-scrub video
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "420px", overflowY: "auto", paddingRight: "4px" }}>
        {results.map((item, idx) => {
          const isActive = Math.abs(activeTimestampMs - item.timestamp_ms) <= 800;
          const matchPercent = (item.score * 100).toFixed(1);

          return (
            <div
              key={idx}
              className={`result-card ${isActive ? "active-match" : ""}`}
              onClick={() => onSelectTimestamp(item.timestamp_ms)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {/* Timestamp Pill */}
                <div className="badge badge-cyan mono">
                  <Play size={10} fill="currentColor" />
                  <span>{item.timestamp_formatted || `${item.timestamp_ms}ms`}</span>
                </div>

                {/* Match Score Meter */}
                <span
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    color: item.score >= 0.8 ? "var(--accent-emerald)" : "var(--accent-cyan)",
                  }}
                >
                  {matchPercent}% Match
                </span>
              </div>

              {/* Scene Summary */}
              <p style={{ fontSize: "0.825rem", color: "var(--text-primary)", lineHeight: 1.4 }}>
                {item.scene_summary}
              </p>

              {/* Detected Items Tags */}
              {item.detections && item.detections.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "2px" }}>
                  {item.detections.map((det, dIdx) => (
                    <span
                      key={dIdx}
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <Crosshair size={10} color="var(--accent-cyan)" />
                      {det.label} ({(det.confidence * 100).toFixed(0)}%)
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
