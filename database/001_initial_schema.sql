-- =============================================================================
-- Performance Testing Platform — Database Schema
-- PostgreSQL 14+
--
-- Tables:
--   environments      — Target environments (dev, staging, prod)
--   test_plans         — JMeter test plans (.jmx) with metadata
--   test_executions    — Test run lifecycle tracking
--   test_schedules     — Cron-based recurring test schedules
--
-- Design principles:
--   - All timestamps in UTC
--   - Soft references via IDs (not foreign keys that block deletes)
--   - JSON columns for flexible config/parameters/summary
--   - Indexes on frequently filtered columns
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Environments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS environments (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT DEFAULT '',
    base_url        VARCHAR(500) DEFAULT '',
    namespace       VARCHAR(100) DEFAULT 'perf-testing',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default environments
INSERT INTO environments (name, description, base_url, namespace) VALUES
    ('development', 'Development environment', 'https://dev.example.com', 'perf-dev'),
    ('staging', 'Staging / Pre-production', 'https://staging.example.com', 'perf-staging'),
    ('production', 'Production environment', 'https://example.com', 'perf-prod')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Test Plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_plans (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     TEXT DEFAULT '',
    jmx_file_name   VARCHAR(255) NOT NULL,
    jmx_content     TEXT NOT NULL,                      -- Full JMX XML stored in DB
    created_by      VARCHAR(100) DEFAULT 'anonymous',
    environment_id  INTEGER REFERENCES environments(id) ON DELETE SET NULL,
    config          JSONB DEFAULT '{}',                  -- Default test parameters

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_test_plans_name ON test_plans (name);
CREATE INDEX idx_test_plans_env ON test_plans (environment_id);
CREATE INDEX idx_test_plans_created ON test_plans (created_at DESC);

-- ---------------------------------------------------------------------------
-- Test Executions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_executions (
    id                  SERIAL PRIMARY KEY,
    test_plan_id        INTEGER NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        -- PENDING | PROVISIONING | RUNNING | COMPLETED | FAILED | STOPPED
    triggered_by        VARCHAR(100) DEFAULT 'api',     -- user, schedule:id, api, ci
    worker_count        INTEGER DEFAULT 1,
    parameters          JSONB DEFAULT '{}',              -- Runtime parameters

    environment_id      INTEGER REFERENCES environments(id) ON DELETE SET NULL,

    -- Kubernetes resource references
    controller_job_name VARCHAR(100),
    worker_job_name     VARCHAR(100),
    kube_namespace      VARCHAR(100),

    -- Results
    jtl_path            VARCHAR(500),                    -- Path to JTL on PVC
    report_path         VARCHAR(500),                    -- Path to HTML report on PVC
    summary             JSONB DEFAULT '{}',              -- Parsed summary statistics
    error_message       TEXT,

    -- Timestamps
    started_at          TIMESTAMP WITH TIME ZONE,
    finished_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_executions_status ON test_executions (status);
CREATE INDEX idx_executions_plan ON test_executions (test_plan_id);
CREATE INDEX idx_executions_env ON test_executions (environment_id);
CREATE INDEX idx_executions_created ON test_executions (created_at DESC);
CREATE INDEX idx_executions_kube ON test_executions (controller_job_name);

-- ---------------------------------------------------------------------------
-- Test Schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_schedules (
    id              SERIAL PRIMARY KEY,
    test_plan_id    INTEGER NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
    cron_expression VARCHAR(100) NOT NULL,               -- e.g., '0 2 * * *' (daily at 2am)
    worker_count    INTEGER DEFAULT 1,
    parameters      JSONB DEFAULT '{}',
    environment_id  INTEGER REFERENCES environments(id) ON DELETE SET NULL,
    enabled         BOOLEAN DEFAULT TRUE,
    created_by      VARCHAR(100) DEFAULT 'api',
    last_run_at     TIMESTAMP WITH TIME ZONE,

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_schedules_enabled ON test_schedules (enabled) WHERE enabled = TRUE;
CREATE INDEX idx_schedules_plan ON test_schedules (test_plan_id);

-- ---------------------------------------------------------------------------
-- Knex migrations tracking (if using knex)
-- ---------------------------------------------------------------------------
-- Knex creates this automatically, but defining here for documentation:
-- CREATE TABLE IF NOT EXISTS knex_migrations (...);
-- CREATE TABLE IF NOT EXISTS knex_migrations_lock (...);
