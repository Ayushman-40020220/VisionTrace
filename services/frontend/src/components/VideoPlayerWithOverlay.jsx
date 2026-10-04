import React, { useRef, useState, useEffect } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize2,
  Eye,
  EyeOff,
  Crosshair
} from "lucide-react";

export function VideoPlayerWithOverlay({
  video,
  telemetry = [],
  searchResults = [],
  jumpToTimestampMs,
  onTimestampChanged,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationSec, setDurationSec] = useState(video?.duration_seconds || 15);
  const [isMuted, setIsMuted] = useState(true);
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeDetections, setActiveDetections] = useState([]);

  // Auto-jump to timestamp when an external result is clicked
  useEffect(() => {
    if (jumpToTimestampMs !== null && jumpToTimestampMs !== undefined && videoRef.current) {
      const targetSec = jumpToTimestampMs / 1000;
      videoRef.current.currentTime = Math.max(0, Math.min(targetSec, durationSec));
      setCurrentTimeMs(jumpToTimestampMs);
      if (!isPlaying) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }, [jumpToTimestampMs, durationSec]);

  // Update current time and match active detection frame telemetry
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const currentMs = Math.round(videoRef.current.currentTime * 1000);
    setCurrentTimeMs(currentMs);
    if (onTimestampChanged) onTimestampChanged(currentMs);

    // Find closest frame telemetry within 1200ms tolerance
    if (telemetry && telemetry.length > 0) {
      const closest = telemetry.reduce((prev, curr) => {
        return Math.abs(curr.timestamp_ms - currentMs) < Math.abs(prev.timestamp_ms - currentMs)
          ? curr
          : prev;
      }, telemetry[0]);

      if (Math.abs(closest.timestamp_ms - currentMs) <= 1200) {
        setActiveDetections(closest.detections || []);
      } else {
        setActiveDetections([]);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDurationSec(videoRef.current.duration || video?.duration_seconds || 15);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const scrubRelative = (seconds) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(
      0,
      Math.min(videoRef.current.currentTime + seconds, durationSec)
    );
  };

  const handleScrubberClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(clickX / rect.width, 1));
    const targetSec = percent * durationSec;
    if (videoRef.current) {
      videoRef.current.currentTime = targetSec;
      setCurrentTimeMs(Math.round(targetSec * 1000));
    }
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const millis = ms % 1000;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0").slice(0, 2)}`;
  };

  const durationMs = Math.round(durationSec * 1000);
  const progressPercent = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;

  return (
    <div className="glass-panel" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Video Viewport & Dynamic Overlay Container */}
      <div ref={containerRef} className="video-wrapper">
        <video
          ref={videoRef}
          src={video?.playback_url}
          className="video-element"
          muted={isMuted}
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onClick={togglePlay}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Dynamic Bounding Box Overlay Layer */}
        {showOverlays && activeDetections.length > 0 && (
          <svg className="overlay-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
            {activeDetections.map((det, idx) => {
              const [x1, y1, x2, y2] = det.bbox_normalized || [0.2, 0.2, 0.5, 0.5];
              const leftPercent = x1 * 100;
              const topPercent = y1 * 100;
              const widthPercent = (x2 - x1) * 100;
              const heightPercent = (y2 - y1) * 100;

              const isWeapon = det.label === "knife" || det.label === "gun" || det.label === "weapon";
              const isHighConfidence = det.confidence >= 0.9;
              let strokeClass = "bbox-rect";
              if (isWeapon) strokeClass += " weapon-alert";
              else if (isHighConfidence) strokeClass += " high-confidence";

              return (
                <g key={idx}>
                  {/* Bounding Box Rectangle */}
                  <rect
                    x={`${leftPercent}%`}
                    y={`${topPercent}%`}
                    width={`${widthPercent}%`}
                    height={`${heightPercent}%`}
                    rx="1"
                    className={strokeClass}
                  />

                  {/* Corner Reticles */}
                  <line
                    x1={`${leftPercent}%`}
                    y1={`${topPercent}%`}
                    x2={`${leftPercent + 3}%`}
                    y2={`${topPercent}%`}
                    stroke="var(--accent-cyan)"
                    strokeWidth="3"
                  />
                  <line
                    x1={`${leftPercent}%`}
                    y1={`${topPercent}%`}
                    x2={`${leftPercent}%`}
                    y2={`${topPercent + 4}%`}
                    stroke="var(--accent-cyan)"
                    strokeWidth="3"
                  />
                </g>
              );
            })}
          </svg>
        )}

        {/* Floating Detection Tags on Video */}
        {showOverlays && (
          <div style={{ position: "absolute", top: 16, left: 16, display: "flex", gap: "8px", zIndex: 20 }}>
            {activeDetections.map((det, idx) => (
              <div
                key={idx}
                style={{
                  background: det.label === "knife" ? "rgba(255, 51, 102, 0.85)" : "rgba(0, 242, 254, 0.85)",
                  color: "#050a14",
                  fontWeight: 700,
                  fontSize: "0.75rem",
                  padding: "4px 8px",
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                }}
              >
                <Crosshair size={12} />
                <span>
                  {det.label.toUpperCase()} ({(det.confidence * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Live Surveillance Timestamp Watermark */}
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: "var(--accent-cyan)",
            border: "1px solid rgba(0, 242, 254, 0.3)",
            zIndex: 20,
          }}
        >
          {formatTime(currentTimeMs)} / {formatTime(durationMs)}
        </div>
      </div>

      {/* Interactive Controls & Scrubbing Bar */}
      <div className="video-controls-bar">
        {/* Play/Pause */}
        <button onClick={togglePlay} className="btn btn-secondary" style={{ padding: "8px 12px" }}>
          {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
        </button>

        {/* Rewind / Fast Forward */}
        <button onClick={() => scrubRelative(-5)} className="btn btn-secondary" style={{ padding: "8px" }} title="Rewind 5s">
          <RotateCcw size={16} />
        </button>
        <button onClick={() => scrubRelative(5)} className="btn btn-secondary" style={{ padding: "8px" }} title="Forward 5s">
          <RotateCw size={16} />
        </button>

        {/* Timeline Scrubber with FAISS Semantic Match Marker Ticks */}
        <div className="scrubber-track-container" onClick={handleScrubberClick}>
          <div className="scrubber-rail">
            {/* Playhead Progress */}
            <div className="scrubber-progress" style={{ width: `${progressPercent}%` }} />

            {/* Render Amber Ticks for All Semantic Search Matches */}
            {searchResults.map((res, index) => {
              const tickPercent = durationMs > 0 ? (res.timestamp_ms / durationMs) * 100 : 0;
              return (
                <div
                  key={index}
                  className="scrubber-tick"
                  style={{ left: `${tickPercent}%` }}
                  title={`Match at ${res.timestamp_formatted} (${(res.score * 100).toFixed(0)}% Similarity)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    videoRef.current.currentTime = res.timestamp_ms / 1000;
                    setCurrentTimeMs(res.timestamp_ms);
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Timestamp Display */}
        <span className="mono" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", minWidth: "110px" }}>
          {formatTime(currentTimeMs)}
        </span>

        {/* Overlay BBoxes Toggle */}
        <button
          onClick={() => setShowOverlays(!showOverlays)}
          className="btn btn-secondary"
          style={{
            padding: "8px 12px",
            color: showOverlays ? "var(--accent-cyan)" : "var(--text-muted)",
            borderColor: showOverlays ? "rgba(0, 242, 254, 0.4)" : "var(--border-color)",
          }}
          title={showOverlays ? "Hide Bounding Boxes" : "Show Bounding Boxes"}
        >
          {showOverlays ? <Eye size={16} /> : <EyeOff size={16} />}
          <span style={{ fontSize: "0.75rem" }}>BBoxes</span>
        </button>

        {/* Mute/Unmute */}
        <button onClick={() => setIsMuted(!isMuted)} className="btn btn-secondary" style={{ padding: "8px" }}>
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
    </div>
  );
}
