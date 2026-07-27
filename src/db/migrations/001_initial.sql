-- Eter-Router: Initial Schema
-- Creates all core tables for the AI LLM router

-- ──────────────── Extensions ────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────── Core tables ────────────────

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash        TEXT UNIQUE NOT NULL,        -- SHA-256 of the bearer token
    key_prefix      TEXT NOT NULL,               -- first 8 chars (for display: "sk-abc...")
    name            TEXT NOT NULL,               -- human label
    description     TEXT DEFAULT '',
    is_active       BOOLEAN DEFAULT true,
    rate_limit      INTEGER DEFAULT 0,           -- 0 = unlimited
    allowed_ips     TEXT[] DEFAULT '{}',          -- CIDR notation
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE provider_groups (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL UNIQUE,
    description      TEXT DEFAULT '',
    routing_strategy TEXT NOT NULL DEFAULT 'fastest-first'
                     CHECK (routing_strategy IN ('fastest-first', 'priority', 'round-robin')),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Junction: API keys can belong to multiple groups
CREATE TABLE api_key_groups (
    api_key_id       UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    provider_group_id UUID NOT NULL REFERENCES provider_groups(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (api_key_id, provider_group_id)
);

CREATE TABLE providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    provider_type   TEXT NOT NULL
                    CHECK (provider_type IN ('openai-compatible', 'anthropic', 'custom')),
    base_url        TEXT NOT NULL,
    api_key_enc     TEXT NOT NULL,               -- AES-256-GCM encrypted
    api_key_iv      TEXT NOT NULL,               -- initialization vector
    models          TEXT[] NOT NULL DEFAULT '{}', -- models this provider can serve
    is_active       BOOLEAN DEFAULT true,
    timeout_ms      INTEGER DEFAULT 60000,
    max_retries     INTEGER DEFAULT 2,
    extra_headers   JSONB DEFAULT '{}',          -- for custom providers
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE provider_group_members (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_group_id UUID NOT NULL REFERENCES provider_groups(id) ON DELETE CASCADE,
    provider_id      UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    priority         INTEGER DEFAULT 0,          -- for priority-based routing
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (provider_group_id, provider_id)
);

-- ──────────────── Observability tables ────────────────

CREATE TABLE request_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id       UUID REFERENCES api_keys(id),
    api_key_prefix   TEXT NOT NULL,               -- for quick display
    provider_id      UUID REFERENCES providers(id),
    provider_name    TEXT NOT NULL,
    model            TEXT NOT NULL,
    model_mapped     TEXT,                        -- if model name was remapped
    prompt_tokens    INTEGER,
    completion_tokens INTEGER,
    total_tokens     INTEGER,
    latency_ms       INTEGER,                    -- total request time
    ttfb_ms          INTEGER,                    -- time to first byte
    is_streaming     BOOLEAN DEFAULT false,
    status           TEXT NOT NULL
                     CHECK (status IN ('success', 'error', 'timeout', 'failover')),
    error_message    TEXT,
    request_body     TEXT,                        -- truncated to 1KB for debugging
    response_body    TEXT,                        -- truncated to 1KB for debugging
    ip_address       INET,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_request_logs_created_at ON request_logs (created_at DESC);
CREATE INDEX idx_request_logs_api_key ON request_logs (api_key_id, created_at DESC);

CREATE TABLE latency_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    ttfb_ms         INTEGER NOT NULL,
    total_ms        INTEGER NOT NULL,
    is_streaming    BOOLEAN DEFAULT false,
    success         BOOLEAN DEFAULT true,
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_latency_metrics_provider ON latency_metrics (provider_id, model, recorded_at DESC);

CREATE TABLE health_check_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    status          TEXT NOT NULL
                    CHECK (status IN ('healthy', 'unhealthy', 'degraded')),
    latency_ms      INTEGER,
    error_message   TEXT,
    checked_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_health_checks_provider ON health_check_logs (provider_id, checked_at DESC);

-- ──────────────── Seed data ────────────────

-- Insert a default provider group for quick setup
INSERT INTO provider_groups (name, description) VALUES
    ('default', 'Default provider group for quick setup');

-- ──────────────── Auto-cleanup function ────────────────

CREATE OR REPLACE FUNCTION cleanup_old_logs(retention_days INTEGER DEFAULT 30)
RETURNS void AS $$
BEGIN
    DELETE FROM request_logs WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    DELETE FROM latency_metrics WHERE recorded_at < NOW() - (retention_days || ' days')::INTERVAL;
    DELETE FROM health_check_logs WHERE checked_at < NOW() - (retention_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;