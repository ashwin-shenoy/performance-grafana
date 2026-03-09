/**
 * Dashboard API Routes
 *
 * GET /api/v1/dashboard/stats   — Aggregate KPIs (live tests, scheduled, pass/fail counts)
 * GET /api/v1/dashboard/trends  — Daily execution counts for the last N days (for charts)
 * GET /api/v1/dashboard/recent  — Recent executions with full metric columns
 */
'use strict';

const express = require('express');
const { getDb } = require('../config/database');

const router = express.Router();

// ── GET /api/v1/dashboard/stats ──────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const db = getDb();

    // Run all aggregation queries in parallel
    const [
      liveRow,
      todayRows,
      workloadRow,
      scheduledRow,
      latestCompletedRows,
    ] = await Promise.all([
      // Count running executions
      db('test_executions')
        .whereIn('status', ['RUNNING', 'PROVISIONING', 'PENDING'])
        .count('id as count')
        .first(),

      // Completed + failed counts for today
      db('test_executions')
        .select('status')
        .count('id as count')
        .whereIn('status', ['COMPLETED', 'FAILED'])
        .where('started_at', '>=', db.raw("NOW() - INTERVAL '24 hours'"))
        .groupBy('status'),

      // Total workloads (test plans)
      db('test_plans').count('id as count').first(),

      // Enabled scheduled tests
      db('test_schedules').where('enabled', true).count('id as count').first(),

      // Last 5 completed executions with metrics for quick summary
      db('test_executions')
        .select(
          'test_executions.id',
          'test_executions.status',
          'test_executions.started_at',
          'test_executions.finished_at',
          'test_executions.p95_ms',
          'test_executions.error_rate_pct',
          'test_plans.name as test_plan_name',
        )
        .leftJoin('test_plans', 'test_executions.test_plan_id', 'test_plans.id')
        .whereIn('test_executions.status', ['COMPLETED', 'FAILED'])
        .orderBy('test_executions.created_at', 'desc')
        .limit(5),
    ]);

    // Pivot today's counts
    let completedToday = 0;
    let failedToday    = 0;
    for (const r of todayRows) {
      if (r.status === 'COMPLETED') completedToday = parseInt(r.count, 10);
      if (r.status === 'FAILED')    failedToday    = parseInt(r.count, 10);
    }

    res.json({
      data: {
        liveTests:       parseInt(liveRow.count, 10),
        scheduledTests:  parseInt(scheduledRow.count, 10),
        completedToday,
        failedToday,
        totalWorkloads:  parseInt(workloadRow.count, 10),
        latestCompleted: latestCompletedRows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/dashboard/trends ─────────────────────────────────────────────
router.get('/trends', async (req, res, next) => {
  try {
    const db   = getDb();
    const days = Math.min(parseInt(req.query.days || '7', 10), 90);

    // Daily counts per status for the last N days
    const rows = await db('test_executions')
      .select(
        db.raw("DATE_TRUNC('day', started_at)::date AS date"),
        'status',
        db.raw('COUNT(*) AS count'),
      )
      .where('started_at', '>=', db.raw(`NOW() - INTERVAL '${days} days'`))
      .whereIn('status', ['RUNNING', 'COMPLETED', 'FAILED', 'STOPPED'])
      .groupByRaw("DATE_TRUNC('day', started_at), status")
      .orderByRaw("DATE_TRUNC('day', started_at)");

    // Build a dense date → status map
    const byDate = {};
    for (const r of rows) {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      if (!byDate[d]) byDate[d] = { date: d, running: 0, completed: 0, failed: 0, stopped: 0 };
      byDate[d][r.status.toLowerCase()] = parseInt(r.count, 10);
    }

    // Fill missing days with zeros so the chart has a continuous axis
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push(byDate[key] || { date: key, running: 0, completed: 0, failed: 0, stopped: 0 });
    }

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/dashboard/recent ─────────────────────────────────────────────
router.get('/recent', async (req, res, next) => {
  try {
    const db    = getDb();
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
    const rows  = await db('test_executions')
      .select(
        'test_executions.*',
        'test_plans.name as test_plan_name',
        'test_plans.jmx_file_name',
      )
      .leftJoin('test_plans', 'test_executions.test_plan_id', 'test_plans.id')
      .orderBy('test_executions.created_at', 'desc')
      .limit(limit);

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
