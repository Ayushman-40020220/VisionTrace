-- ============================================================================
-- VisionTrace PostgreSQL DDL Schema
-- Multi-Modal Video Audit & Semantic Incident Search Engine
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('ADMIN', 'AUDITOR');
CREATE TYPE video_status AS ENUM ('QUEUED', 'PROCESSING', 'INDEXED', 'FAILED');
CREATE TYPE incident_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE incident_status AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED');

-- ----------------------------------------------------------------------------
-- 1. Users Table (RBAC: Admin vs. Auditor)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role user_role NOT NULL DEFAULT 'AUDITOR',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ----------------------------------------------------------------------------
-- 2. Videos Table (Metadata & Storage references)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    storage_path VARCHAR(1024) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    duration_seconds NUMERIC(10, 2) DEFAULT 0.00,
    fps NUMERIC(6, 2) DEFAULT 0.00,
    total_frames INTEGER DEFAULT 0,
    resolution_width INTEGER,
    resolution_height INTEGER,
    status video_status NOT NULL DEFAULT 'QUEUED',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_uploaded_by ON videos(uploaded_by);
CREATE INDEX idx_videos_created_at ON videos(created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Incidents Table (Audit Incident Logs linked to Video clips)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    severity incident_severity NOT NULL DEFAULT 'MEDIUM',
    status incident_status NOT NULL DEFAULT 'OPEN',
    timestamp_start_ms BIGINT NOT NULL CHECK (timestamp_start_ms >= 0),
    timestamp_end_ms BIGINT NOT NULL CHECK (timestamp_end_ms >= timestamp_start_ms),
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incidents_video_id ON incidents(video_id);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_timestamps ON incidents(video_id, timestamp_start_ms, timestamp_end_ms);
CREATE INDEX idx_incidents_tags ON incidents USING GIN (tags);

-- ----------------------------------------------------------------------------
-- 4. Audit Logs Table (Strict Compliance & Action Trails)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- e.g., 'VIDEO_UPLOAD', 'INCIDENT_CREATE', 'SEMANTIC_SEARCH', 'RBAC_CHANGE'
    target_resource VARCHAR(100) NOT NULL, -- e.g., 'video', 'incident', 'user'
    target_id UUID,
    metadata JSONB DEFAULT '{}'::JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_metadata ON audit_logs USING GIN (metadata);

-- ----------------------------------------------------------------------------
-- Automatic updated_at Trigger Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
