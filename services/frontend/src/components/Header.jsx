import React from "react";
import { Shield, Database, Cpu, Radio, UploadCloud, UserCheck } from "lucide-react";

export function Header({ role, setRole, onOpenUpload }) {
  return (
    <header className="app-header">
      {/* Brand */}
      <div className="brand-logo">
        <div className="brand-icon">
          <Radio size={20} />
        </div>
        <div>
          <h1 className="brand-title">VisionTrace</h1>
          <p className="brand-tag">Multi-Modal Video Audit & Semantic Search Engine</p>
        </div>
      </div>

      {/* Cluster Health Indicators */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div className="badge badge-emerald" title="PostgreSQL 16 Relational Store">
          <Database size={13} />
          <span>Postgres</span>
        </div>
        <div className="badge badge-cyan" title="MongoDB 7.0 Telemetry Store">
          <Database size={13} />
          <span>MongoDB</span>
        </div>
        <div className="badge badge-amber" title="Redis 7 Query Cache">
          <Cpu size={13} />
          <span>Redis Cache</span>
        </div>
        <div className="badge badge-cyan" title="FastAPI + YOLOv8 + FAISS Index">
          <span className="pulse-dot" style={{ backgroundColor: "var(--accent-cyan)" }}></span>
          <span>FAISS Engine</span>
        </div>
      </div>

      {/* Role Switcher & Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {/* Role Toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.05)",
            padding: "4px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-color)",
          }}
        >
          <button
            onClick={() => setRole("AUDITOR")}
            className="btn"
            style={{
              padding: "6px 14px",
              fontSize: "0.75rem",
              background: role === "AUDITOR" ? "rgba(0, 242, 254, 0.2)" : "transparent",
              color: role === "AUDITOR" ? "var(--accent-cyan)" : "var(--text-secondary)",
              borderColor: role === "AUDITOR" ? "var(--accent-cyan)" : "transparent",
            }}
          >
            <UserCheck size={14} />
            Auditor Mode
          </button>
          <button
            onClick={() => setRole("ADMIN")}
            className="btn"
            style={{
              padding: "6px 14px",
              fontSize: "0.75rem",
              background: role === "ADMIN" ? "rgba(255, 183, 3, 0.2)" : "transparent",
              color: role === "ADMIN" ? "var(--accent-amber)" : "var(--text-secondary)",
              borderColor: role === "ADMIN" ? "var(--accent-amber)" : "transparent",
            }}
          >
            <Shield size={14} />
            Admin Mode
          </button>
        </div>

        {/* Upload Button (Admin only) */}
        {role === "ADMIN" && (
          <button onClick={onOpenUpload} className="btn btn-primary" style={{ padding: "8px 16px" }}>
            <UploadCloud size={16} />
            Upload Video
          </button>
        )}
      </div>
    </header>
  );
}
