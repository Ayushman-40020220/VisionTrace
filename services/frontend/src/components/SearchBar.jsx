import React, { useState } from "react";
import { Search, Zap, SlidersHorizontal, Sparkles } from "lucide-react";

export function SearchBar({ onSearch, isLoading, lastMeta }) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(10);
  const [minScore, setMinScore] = useState(0.25);
  const [showFilters, setShowFilters] = useState(false);

  const presets = [
    "Find forklift in loading dock",
    "Person wearing backpack near server rack",
    "Suspicious movement near emergency exit",
    "Weapon or sharp object detected"
  ];

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    onSearch({ query: query.trim(), top_k: topK, min_score: minScore });
  };

  const handlePresetClick = (presetText) => {
    setQuery(presetText);
    onSearch({ query: presetText, top_k: topK, min_score: minScore });
  };

  return (
    <div className="glass-panel" style={{ padding: "20px" }}>
      {/* Main Search Bar Input */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
          <Search
            size={20}
            style={{
              position: "absolute",
              left: "16px",
              color: "var(--accent-cyan)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Natural-language incident search... (e.g. 'Find forklift in loading dock' or 'person with backpack')"
            style={{
              width: "100%",
              padding: "14px 16px 14px 48px",
              background: "rgba(0, 0, 0, 0.4)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-highlight)",
              fontSize: "1rem",
              fontFamily: "var(--font-body)",
              outline: "none",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--accent-cyan)";
              e.target.style.boxShadow = "var(--shadow-cyan-glow)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--border-color)";
              e.target.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Filter Toggle Button */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="btn btn-secondary"
          style={{
            padding: "12px 16px",
            borderColor: showFilters ? "var(--accent-cyan)" : "var(--border-color)",
            color: showFilters ? "var(--accent-cyan)" : "var(--text-secondary)",
          }}
          title="Search Hyperparameters (Top-K, Threshold)"
        >
          <SlidersHorizontal size={18} />
          <span>Tune</span>
        </button>

        {/* Search Submit */}
        <button type="submit" disabled={isLoading} className="btn btn-primary" style={{ padding: "12px 24px" }}>
          {isLoading ? (
            <span>Searching...</span>
          ) : (
            <>
              <Sparkles size={18} />
              <span>Search FAISS</span>
            </>
          )}
        </button>
      </form>

      {/* Expandable Hyperparameters Drawer */}
      {showFilters && (
        <div
          style={{
            marginTop: "16px",
            padding: "14px",
            background: "rgba(0, 0, 0, 0.25)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-color)",
            display: "flex",
            gap: "32px",
            alignItems: "center",
          }}
        >
          {/* Top-K Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.825rem", color: "var(--text-secondary)" }}>Top-K Results:</span>
            {[5, 10, 20].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTopK(k)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: topK === k ? "var(--accent-cyan)" : "rgba(255, 255, 255, 0.05)",
                  color: topK === k ? "#050a14" : "var(--text-secondary)",
                  border: "none",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Min Similarity Score Slider */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, maxWidth: "340px" }}>
            <span style={{ fontSize: "0.825rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              Min Cosine Score: <strong style={{ color: "var(--accent-cyan)" }}>{(minScore * 100).toFixed(0)}%</strong>
            </span>
            <input
              type="range"
              min="0.10"
              max="0.85"
              step="0.05"
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent-cyan)", cursor: "pointer" }}
            />
          </div>
        </div>
      )}

      {/* Suggested Query Preset Chips & Redis Telemetry */}
      <div
        style={{
          marginTop: "14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
            Quick Prompts:
          </span>
          {presets.map((preset) => (
            <button
              key={preset}
              onClick={() => handlePresetClick(preset)}
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "var(--radius-full)",
                padding: "4px 12px",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.target.style.borderColor = "var(--accent-cyan)";
                e.target.style.color = "var(--text-highlight)";
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = "rgba(255, 255, 255, 0.08)";
                e.target.style.color = "var(--text-secondary)";
              }}
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Redis Caching Status Indicator Badge */}
        {lastMeta && (
          <div
            className={`badge ${lastMeta.cache_hit ? "badge-emerald" : "badge-amber"}`}
            style={{ fontSize: "0.72rem", padding: "4px 12px" }}
          >
            <Zap size={12} />
            <span>
              {lastMeta.cache_hit ? "⚡ Redis Cache Hit (<10ms)" : "FAISS Vector Search"} (
              {lastMeta.execution_time_ms}ms)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
