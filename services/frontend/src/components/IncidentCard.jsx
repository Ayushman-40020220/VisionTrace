import React from "react";
import { AlertTriangle, CheckCircle, Clock, ShieldAlert, Tag, Play } from "lucide-react";

export function IncidentCard({ incident, topConfidence, onJumpToIncident, onStatusChange, role }) {
  if (!incident) return null;

  const severityColor =
    incident.severity === "CRITICAL"
      ? "badge-crimson"
      : incident.severity === "HIGH"
      ? "badge-amber"
      : "badge-cyan";

  const isResolved = incident.status === "RESOLVED";

  const formatInterval = (startMs, endMs) => {
    const sSec = (startMs / 1000).toFixed(1);
    const eSec = (endMs / 1000).toFixed(1);
    return `${sSec}s – ${eSec}s`;
  };

  return (
    <div className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
        <div>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Correlated Incident Log
          </span>
          <h3 style={{ fontSize: "1.1rem", marginTop: "4px", color: "var(--text-highlight)" }}>
            {incident.title}
          </h3>
        </div>

        {/* Severity Badge */}
        <span className={`badge ${severityColor}`}>
          <AlertTriangle size={12} />
          {incident.severity}
        </span>
      </div>

      {/* Description */}
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {incident.description}
      </p>

      {/* Metadata Metrics Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          padding: "12px",
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-color)",
        }}
      >
        <div>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block" }}>
            Target Window:
          </span>
          <span className="mono" style={{ fontSize: "0.85rem", color: "var(--accent-cyan)", fontWeight: 600 }}>
            {formatInterval(incident.timestamp_start_ms, incident.timestamp_end_ms)}
          </span>
        </div>

        <div>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block" }}>
            AI Match Confidence:
          </span>
          <span style={{ fontSize: "0.85rem", color: "var(--accent-emerald)", fontWeight: 700 }}>
            {topConfidence ? `${(topConfidence * 100).toFixed(1)}%` : "High Precision"}
          </span>
        </div>
      </div>

      {/* Tags */}
      {incident.tags && incident.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {incident.tags.map((tag, tIdx) => (
            <span
              key={tIdx}
              style={{
                fontSize: "0.7rem",
                padding: "2px 8px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Tag size={10} color="var(--accent-cyan)" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Action Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
        <button
          onClick={() => onJumpToIncident(incident.timestamp_start_ms)}
          className="btn btn-secondary"
          style={{ padding: "8px 14px", fontSize: "0.75rem" }}
        >
          <Play size={12} fill="currentColor" />
          <span>Play Incident Window</span>
        </button>

        {role === "ADMIN" && (
          <button
            onClick={() => onStatusChange(incident.id, isResolved ? "UNDER_INVESTIGATION" : "RESOLVED")}
            className="btn btn-secondary"
            style={{
              padding: "8px 14px",
              fontSize: "0.75rem",
              borderColor: isResolved ? "var(--accent-emerald)" : "var(--accent-crimson)",
              color: isResolved ? "var(--accent-emerald)" : "var(--accent-crimson)",
            }}
          >
            <CheckCircle size={14} />
            <span>{isResolved ? "Incident Resolved" : "Mark as Resolved"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
