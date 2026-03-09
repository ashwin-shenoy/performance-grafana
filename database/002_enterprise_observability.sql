-- ============================================================
-- Migration 002: Enterprise Observability Schema
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. EXTEND EXISTING TABLES
-- ─────────────────────────────────────────────────────────────
ALTER TABLE test_plans
    ADD COLUMN IF NOT EXISTS team     TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS service  TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS scenario TEXT NOT NULL DEFAULT 'stress'
        CHECK (scenario IN ('smoke','load','stress','soak','spike','custom'));

ALTER TABLE test_executions
    ADD COLUMN IF NOT EXISTS p50_ms          REAL,
    ADD COLUMN IF NOT EXISTS p95_ms          REAL,
    ADD COLUMN IF NOT EXISTS p99_ms          REAL,
    ADD COLUMN IF NOT EXISTS error_rate_pct  REAL,
    ADD COLUMN IF NOT EXISTS peak_rps        REAL,
    ADD COLUMN IF NOT EXISTS avg_rps         REAL,
    ADD COLUMN IF NOT EXISTS total_requests  BIGINT,
    ADD COLUMN IF NOT EXISTS total_errors    BIGINT,
    ADD COLUMN IF NOT EXISTS grafana_url     TEXT,
    ADD COLUMN IF NOT EXISTS dashboard_uid   TEXT,
    ADD COLUMN IF NOT EXISTS passed_slos     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_slos     INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_te_p95      ON test_executions(p95_ms) WHERE p95_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tp_team     ON test_plans(team);
CREATE INDEX IF NOT EXISTS idx_tp_service  ON test_plans(service);
CREATE INDEX IF NOT EXISTS idx_tp_team_svc ON test_plans(team, service);

-- ─────────────────────────────────────────────────────────────
-- 2. CONVENIENCE VIEW: test_runs
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW test_runs AS
SELECT
    te.id                                                    AS execution_id,
    te.id::TEXT                                              AS run_id,
    tp.name                                                  AS test_name,
    tp.team,
    tp.service,
    tp.scenario,
    COALESCE(e.name, 'unknown')                              AS environment,
    te.status,
    te.triggered_by,
    te.worker_count,
    te.started_at,
    te.finished_at,
    EXTRACT(EPOCH FROM (te.finished_at - te.started_at))::INT AS duration_s,
    te.p50_ms,
    te.p95_ms,
    te.p99_ms,
    te.error_rate_pct,
    te.peak_rps,
    te.avg_rps,
    te.total_requests,
    te.total_errors,
    te.passed_slos,
    te.failed_slos,
    te.grafana_url,
    te.dashboard_uid,
    te.summary,
    te.created_at
FROM  test_executions te
JOIN  test_plans      tp ON tp.id = te.test_plan_id
LEFT JOIN environments e ON e.id  = te.environment_id;

-- ─────────────────────────────────────────────────────────────
-- 3. SLO DEFINITIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slo_definitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team        TEXT NOT NULL DEFAULT 'default',
    service     TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'staging',
    metric_name TEXT NOT NULL
        CHECK (metric_name IN ('p50_ms','p95_ms','p99_ms','error_rate_pct','peak_rps','avg_rps')),
    operator    TEXT NOT NULL DEFAULT 'lt'
        CHECK (operator IN ('lt','lte','gt','gte')),
    threshold   REAL NOT NULL,
    unit        TEXT DEFAULT 'ms',
    severity    TEXT NOT NULL DEFAULT 'critical'
        CHECK (severity IN ('info','warning','critical')),
    description TEXT,
    active      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (team, service, environment, metric_name)
);

INSERT INTO slo_definitions (team, service, environment, metric_name, operator, threshold, unit, severity, description)
VALUES
    ('default','sample-app','staging',    'p95_ms',        'lt', 200,  'ms',  'critical', 'P95 latency < 200ms'),
    ('default','sample-app','staging',    'p99_ms',        'lt', 500,  'ms',  'warning',  'P99 latency < 500ms'),
    ('default','sample-app','staging',    'error_rate_pct','lt', 1.0,  '%',   'critical', 'Error rate < 1%'),
    ('default','sample-app','staging',    'peak_rps',      'gt', 100,  'rps', 'warning',  'Peak throughput > 100 rps'),
    ('default','sample-app','production', 'p95_ms',        'lt', 150,  'ms',  'critical', 'P95 latency < 150ms in prod'),
    ('default','sample-app','production', 'error_rate_pct','lt', 0.5,  '%',   'critical', 'Error rate < 0.5% in prod')
ON CONFLICT (team, service, environment, metric_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. SLO RESULTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slo_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id  INTEGER REFERENCES test_executions(id) ON DELETE CASCADE,
    slo_id        UUID REFERENCES slo_definitions(id) ON DELETE CASCADE,
    actual_value  REAL NOT NULL,
    threshold     REAL NOT NULL,
    passed        BOOLEAN NOT NULL,
    evaluated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (execution_id, slo_id)
);

CREATE INDEX IF NOT EXISTS idx_slo_results_exec ON slo_results(execution_id);
CREATE INDEX IF NOT EXISTS idx_slo_results_slo  ON slo_results(slo_id);

-- ─────────────────────────────────────────────────────────────
-- 5. BASELINES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS baselines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team            TEXT NOT NULL DEFAULT 'default',
    service         TEXT NOT NULL,
    environment     TEXT NOT NULL,
    scenario        TEXT NOT NULL,
    execution_id    INTEGER REFERENCES test_executions(id),
    promoted_by     TEXT DEFAULT 'system',
    promoted_at     TIMESTAMPTZ DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT TRUE,
    p50_ms          REAL,
    p95_ms          REAL,
    p99_ms          REAL,
    error_rate_pct  REAL,
    avg_rps         REAL,
    peak_rps        REAL
);

CREATE INDEX IF NOT EXISTS idx_baselines_lookup
    ON baselines(team, service, environment, scenario, is_active);

-- ─────────────────────────────────────────────────────────────
-- 6. REGRESSION EVENTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regression_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id     INTEGER REFERENCES test_executions(id) ON DELETE CASCADE,
    baseline_exec_id INTEGER REFERENCES test_executions(id),
    metric_name      TEXT NOT NULL,
    baseline_value   REAL NOT NULL,
    current_value    REAL NOT NULL,
    delta_pct        REAL NOT NULL,
    severity         TEXT NOT NULL CHECK (severity IN ('warning','critical')),
    auto_detected    BOOLEAN DEFAULT TRUE,
    acknowledged     BOOLEAN DEFAULT FALSE,
    ack_by           TEXT,
    ack_at           TIMESTAMPTZ,
    false_positive   BOOLEAN DEFAULT FALSE,
    detected_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regression_exec ON regression_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_regression_time ON regression_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_regression_open
    ON regression_events(severity) WHERE acknowledged = FALSE AND false_positive = FALSE;

-- ─────────────────────────────────────────────────────────────
-- 7. MATERIALIZED VIEW: perf_trends
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS perf_trends AS
SELECT
    tp.team,
    tp.service,
    COALESCE(e.name, 'unknown')                AS environment,
    tp.scenario,
    DATE_TRUNC('day', te.started_at)           AS day,
    COUNT(*)                                   AS run_count,
    AVG(te.p95_ms)                             AS avg_p95_ms,
    MIN(te.p95_ms)                             AS min_p95_ms,
    MAX(te.p95_ms)                             AS max_p95_ms,
    PERCENTILE_CONT(0.5)
        WITHIN GROUP (ORDER BY te.p95_ms)      AS median_p95_ms,
    AVG(te.p99_ms)                             AS avg_p99_ms,
    AVG(te.error_rate_pct)                     AS avg_error_rate,
    AVG(te.peak_rps)                           AS avg_peak_rps,
    MAX(te.peak_rps)                           AS max_peak_rps,
    SUM(CASE WHEN te.status='COMPLETED' THEN 1 ELSE 0 END) AS passed_count,
    SUM(CASE WHEN te.status='FAILED'    THEN 1 ELSE 0 END) AS failed_count,
    SUM(COALESCE(te.total_requests, 0))        AS total_requests
FROM  test_executions te
JOIN  test_plans      tp ON tp.id = te.test_plan_id
LEFT JOIN environments e  ON e.id  = te.environment_id
WHERE te.status IN ('COMPLETED','FAILED')
  AND te.p95_ms IS NOT NULL
GROUP BY tp.team, tp.service, COALESCE(e.name,'unknown'), tp.scenario,
         DATE_TRUNC('day', te.started_at)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_trends_pk
    ON perf_trends (team, service, environment, scenario, day);
CREATE INDEX IF NOT EXISTS idx_perf_trends_day ON perf_trends(day DESC);

CREATE OR REPLACE FUNCTION refresh_perf_trends() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY perf_trends;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. SAMPLE DATA (30 historical runs for dashboards)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_env_id  INTEGER;
    v_plan_id INTEGER;
    v_exec_id INTEGER;
    i         INT;
    v_p95     REAL;
    v_err     REAL;
    v_rps     REAL;
    v_status  TEXT;
    v_start   TIMESTAMPTZ;
BEGIN
    INSERT INTO environments(name, description, base_url, namespace)
    VALUES ('staging','Staging environment','http://sample-app:3002','perf-testing')
    ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_env_id;

    IF v_env_id IS NULL THEN
        SELECT id INTO v_env_id FROM environments WHERE name = 'staging';
    END IF;

    INSERT INTO test_plans(name, description, jmx_file_name, jmx_content,
                           created_by, environment_id, team, service, scenario)
    VALUES (
        'sample-app-stress',
        'Stress test for sample-app endpoints',
        'sample.jmx',
        '<?xml version="1.0"?><jmeterTestPlan version="1.2"><hashTree/></jmeterTestPlan>',
        'system', v_env_id, 'default', 'sample-app', 'stress'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_plan_id;

    IF v_plan_id IS NULL THEN
        SELECT id INTO v_plan_id FROM test_plans
        WHERE name = 'sample-app-stress' LIMIT 1;
    END IF;

    FOR i IN 1..30 LOOP
        v_start  := NOW() - (i * INTERVAL '6 hours');
        v_p95    := 120 + (random() * 60)
                  + CASE WHEN i IN (7,17) THEN 130 ELSE 0 END;
        v_err    := CASE WHEN i IN (7,17)
                         THEN 2.0 + random()
                         ELSE random() * 0.7 END;
        v_rps    := 700 + (random() * 400);
        v_status := CASE WHEN v_p95 > 280 OR v_err > 1.5
                         THEN 'FAILED' ELSE 'COMPLETED' END;

        INSERT INTO test_executions(
            test_plan_id, status, triggered_by, worker_count, environment_id,
            started_at, finished_at,
            p50_ms, p95_ms, p99_ms, error_rate_pct, peak_rps, avg_rps,
            total_requests, total_errors, passed_slos, failed_slos,
            summary, created_at
        ) VALUES (
            v_plan_id, v_status, 'ci-pipeline', 3, v_env_id,
            v_start, v_start + INTERVAL '10 minutes',
            ROUND((v_p95 * 0.45)::NUMERIC,1),
            ROUND(v_p95::NUMERIC,1),
            ROUND((v_p95 * 1.9)::NUMERIC,1),
            ROUND(v_err::NUMERIC,3),
            ROUND(v_rps::NUMERIC,1),
            ROUND((v_rps * 0.82)::NUMERIC,1),
            (v_rps * 600)::BIGINT,
            ((v_rps * 600 * v_err / 100))::BIGINT,
            CASE WHEN v_status='COMPLETED' THEN 3 ELSE 1 END,
            CASE WHEN v_status='COMPLETED' THEN 0 ELSE 2 END,
            jsonb_build_object(
                'totalRequests',(v_rps*600)::INT,
                'errorRate', v_err,
                'p95', v_p95
            ),
            v_start
        ) RETURNING id INTO v_exec_id;

        -- Inject regression events for "bad" runs
        IF i IN (7, 17) THEN
            INSERT INTO regression_events(
                execution_id, metric_name,
                baseline_value, current_value, delta_pct, severity, detected_at
            ) VALUES (
                v_exec_id, 'p95_ms',
                145.0, v_p95,
                ROUND(((v_p95 - 145.0) / 145.0 * 100)::NUMERIC, 1),
                'critical',
                v_start + INTERVAL '11 minutes'
            );
        END IF;

        -- Inject SLO results for completed runs
        IF v_status = 'COMPLETED' THEN
            INSERT INTO slo_results(execution_id, slo_id, actual_value, threshold, passed)
            SELECT v_exec_id, sd.id, v_p95, sd.threshold, v_p95 < sd.threshold
            FROM slo_definitions sd
            WHERE sd.service = 'sample-app' AND sd.environment = 'staging'
              AND sd.metric_name = 'p95_ms'
            ON CONFLICT (execution_id, slo_id) DO NOTHING;

            INSERT INTO slo_results(execution_id, slo_id, actual_value, threshold, passed)
            SELECT v_exec_id, sd.id, v_err, sd.threshold, v_err < sd.threshold
            FROM slo_definitions sd
            WHERE sd.service = 'sample-app' AND sd.environment = 'staging'
              AND sd.metric_name = 'error_rate_pct'
            ON CONFLICT (execution_id, slo_id) DO NOTHING;
        END IF;
    END LOOP;

    -- Promote the most recent passing run as baseline
    SELECT te.id INTO v_exec_id
    FROM test_executions te
    JOIN test_plans tp ON tp.id = te.test_plan_id
    WHERE tp.service='sample-app' AND te.status='COMPLETED'
    ORDER BY te.started_at DESC LIMIT 1;

    IF v_exec_id IS NOT NULL THEN
        INSERT INTO baselines(team, service, environment, scenario,
                              execution_id, promoted_by, is_active,
                              p95_ms, error_rate_pct, avg_rps, peak_rps)
        SELECT 'default','sample-app','staging','stress',
               te.id, 'system', TRUE,
               te.p95_ms, te.error_rate_pct, te.avg_rps, te.peak_rps
        FROM test_executions te WHERE te.id = v_exec_id
        ON CONFLICT DO NOTHING;
    END IF;

    -- Refresh view
    REFRESH MATERIALIZED VIEW perf_trends;
    RAISE NOTICE 'Migration 002 sample data inserted OK';
END;
$$;
