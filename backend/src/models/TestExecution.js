/**
 * TestExecution Model — Tracks each test run with its lifecycle
 *
 * States: PENDING -> PROVISIONING -> RUNNING -> COMPLETED | FAILED | STOPPED
 */
'use strict';

const { getDb } = require('../config/database');

const TABLE = 'test_executions';

const STATUS = {
  PENDING: 'PENDING',
  PROVISIONING: 'PROVISIONING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED',
};

const TestExecution = {
  STATUS,

  async create({ testPlanId, triggeredBy, workerCount, parameters, environmentId, grafanaUrl }) {
    const db = getDb();
    const insertData = {
      test_plan_id: testPlanId,
      triggered_by: triggeredBy,
      worker_count: workerCount || 1,
      parameters:   JSON.stringify(parameters || {}),
      environment_id: environmentId,
      status: STATUS.PENDING,
    };
    if (grafanaUrl) insertData.grafana_url = grafanaUrl;
    const [row] = await db(TABLE).insert(insertData).returning('*');
    return row;
  },

  async findById(id) {
    const db = getDb();
    return db(TABLE)
      .select('test_executions.*', 'test_plans.name as test_plan_name', 'test_plans.jmx_file_name')
      .leftJoin('test_plans', 'test_executions.test_plan_id', 'test_plans.id')
      .where('test_executions.id', id)
      .first();
  },

  /**
   * List executions with pagination and filtering.
   * FIX: count query now applies ALL filters (was missing environmentId + date range).
   */
  async findAll({ page = 1, limit = 20, status, testPlanId, environmentId, from, to }) {
    const db = getDb();

    const applyFilters = (q) => {
      if (status)        q = q.where('test_executions.status', status);
      if (testPlanId)    q = q.where('test_executions.test_plan_id', testPlanId);
      if (environmentId) q = q.where('test_executions.environment_id', environmentId);
      if (from)          q = q.where('test_executions.started_at', '>=', new Date(from));
      if (to)            q = q.where('test_executions.started_at', '<=', new Date(to));
      return q;
    };

    const offset = (page - 1) * limit;

    const [{ count }] = await applyFilters(
      db(TABLE)
        .leftJoin('test_plans', 'test_executions.test_plan_id', 'test_plans.id')
        .count('test_executions.id as count'),
    );

    const rows = await applyFilters(
      db(TABLE)
        .select(
          'test_executions.*',
          'test_plans.name as test_plan_name',
          'test_plans.jmx_file_name',
        )
        .leftJoin('test_plans', 'test_executions.test_plan_id', 'test_plans.id')
        .orderBy('test_executions.created_at', 'desc'),
    )
      .offset(offset)
      .limit(limit);

    return { data: rows, total: parseInt(count, 10), page, limit };
  },

  async updateStatus(id, status, extra = {}) {
    const db = getDb();
    const updateData = { status, updated_at: db.fn.now(), ...extra };
    if (status === STATUS.RUNNING) updateData.started_at = db.fn.now();
    if ([STATUS.COMPLETED, STATUS.FAILED, STATUS.STOPPED].includes(status)) {
      updateData.finished_at = db.fn.now();
    }
    const [row] = await db(TABLE).where({ id }).update(updateData).returning('*');
    return row;
  },

  async setKubeResources(id, { controllerJobName, workerJobName, namespace }) {
    const db = getDb();
    const [row] = await db(TABLE)
      .where({ id })
      .update({
        controller_job_name: controllerJobName,
        worker_job_name: workerJobName,
        kube_namespace: namespace,
        updated_at: db.fn.now(),
      })
      .returning('*');
    return row;
  },

  async getRunning() {
    const db = getDb();
    return db(TABLE).whereIn('status', [STATUS.PENDING, STATUS.PROVISIONING, STATUS.RUNNING]);
  },

  async updateGrafanaUrl(id, grafanaUrl) {
    const db = getDb();
    const [row] = await db(TABLE)
      .where({ id })
      .update({ grafana_url: grafanaUrl, updated_at: db.fn.now() })
      .returning('*');
    return row;
  },

  async storeResults(id, { jtlPath, reportPath, summary }) {
    const db = getDb();
    const [row] = await db(TABLE)
      .where({ id })
      .update({
        jtl_path:    jtlPath,
        report_path: reportPath,
        summary:     JSON.stringify(summary || {}),
        updated_at:  db.fn.now(),
      })
      .returning('*');
    return row;
  },

  /**
   * NEW: Store parsed JTL performance metrics into dedicated metric columns.
   * Also merges the rich metrics object into the summary JSONB column so the
   * existing UI which reads summary.avgResponseTime / summary.errorRate still works.
   */
  async storeMetrics(id, {
    p50Ms, p95Ms, p99Ms, errorRatePct,
    peakRps, avgRps, totalRequests, totalErrors,
  }) {
    const db = getDb();

    // Build the enriched summary sub-object (compatible with existing UI consumers)
    const summaryPatch = {
      avgResponseTime: p50Ms        ?? null,
      p50ResponseTime: p50Ms        ?? null,
      p95ResponseTime: p95Ms        ?? null,
      p99ResponseTime: p99Ms        ?? null,
      errorRate:       errorRatePct ?? null,
      throughput:      avgRps       ?? null,
      peakRps:         peakRps      ?? null,
      totalRequests:   totalRequests ?? null,
    };

    const [row] = await db(TABLE)
      .where({ id })
      .update({
        p50_ms:         p50Ms        ?? null,
        p95_ms:         p95Ms        ?? null,
        p99_ms:         p99Ms        ?? null,
        error_rate_pct: errorRatePct ?? null,
        peak_rps:       peakRps      ?? null,
        avg_rps:        avgRps       ?? null,
        total_requests: totalRequests ?? null,
        total_errors:   totalErrors   ?? null,
        // Merge into existing JSONB summary
        summary:    db.raw(`summary || ?::jsonb`, [JSON.stringify(summaryPatch)]),
        updated_at: db.fn.now(),
      })
      .returning('*');
    return row;
  },
};

module.exports = TestExecution;
