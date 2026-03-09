/**
 * Reports API Routes
 *
 * GET  /api/v1/reports/:executionId          — Get report metadata + parsed summary
 * GET  /api/v1/reports/:executionId/html     — Redirect to static JMeter HTML dashboard
 * GET  /api/v1/reports/:executionId/summary  — Parsed JSON performance summary
 * GET  /api/v1/reports/:executionId/jtl      — Download raw JTL CSV file
 * POST /api/v1/reports/:executionId/generate — Generate HTML dashboard from JTL
 */
'use strict';

const express       = require('express');
const path          = require('path');
const fs            = require('fs');
const { execFile }  = require('child_process');
const TestExecution = require('../models/TestExecution');
const { parseJtl }  = require('../utils/jtlParser');
const logger        = require('../utils/logger');

const router = express.Router();
const REPORT_BASE = process.env.REPORT_BASE_PATH || '/report';

// ── GET /api/v1/reports/:executionId ─────────────────────────────────────────
router.get('/:executionId', async (req, res, next) => {
  try {
    const execution = await TestExecution.findById(req.params.executionId);
    if (!execution) return res.status(404).json({ error: { message: 'Execution not found' } });

    const summary = typeof execution.summary === 'string'
      ? JSON.parse(execution.summary) : execution.summary || {};

    // Check whether the HTML report has been generated
    const htmlReportDir  = `${REPORT_BASE}/exec-${execution.id}/html-report`;
    const htmlReportReady = fs.existsSync(path.join(htmlReportDir, 'index.html'));

    res.json({
      data: {
        executionId:    execution.id,
        testPlanName:   execution.test_plan_name,
        status:         execution.status,
        jtlPath:        execution.jtl_path,
        reportPath:     execution.report_path,
        htmlReportReady,
        htmlReportUrl:  htmlReportReady ? `/report/exec-${execution.id}/html-report/index.html` : null,
        // Dedicated metric columns
        p50Ms:          execution.p50_ms,
        p95Ms:          execution.p95_ms,
        p99Ms:          execution.p99_ms,
        errorRatePct:   execution.error_rate_pct,
        avgRps:         execution.avg_rps,
        peakRps:        execution.peak_rps,
        totalRequests:  execution.total_requests,
        totalErrors:    execution.total_errors,
        passedSlos:     execution.passed_slos,
        failedSlos:     execution.failed_slos,
        summary,
        startedAt:      execution.started_at,
        finishedAt:     execution.finished_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/reports/:executionId/html ────────────────────────────────────
router.get('/:executionId/html', async (req, res, next) => {
  try {
    const execution = await TestExecution.findById(req.params.executionId);
    if (!execution || !execution.report_path) {
      return res.status(404).json({ error: { message: 'Report not available' } });
    }
    const reportUrl = `/report/exec-${execution.id}/html-report/index.html`;
    res.redirect(reportUrl);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/reports/:executionId/summary ─────────────────────────────────
router.get('/:executionId/summary', async (req, res, next) => {
  try {
    const execution = await TestExecution.findById(req.params.executionId);
    if (!execution) return res.status(404).json({ error: { message: 'Execution not found' } });

    const summary = typeof execution.summary === 'string'
      ? JSON.parse(execution.summary) : execution.summary || {};

    // If dedicated metric columns are populated, include them (they're more accurate)
    const metrics = {
      p50Ms:         execution.p50_ms         ?? summary.p50ResponseTime  ?? null,
      p95Ms:         execution.p95_ms         ?? summary.p95ResponseTime  ?? null,
      p99Ms:         execution.p99_ms         ?? summary.p99ResponseTime  ?? null,
      avgMs:         summary.avgResponseTime                              ?? null,
      errorRatePct:  execution.error_rate_pct ?? summary.errorRate        ?? null,
      avgRps:        execution.avg_rps        ?? summary.throughput       ?? null,
      peakRps:       execution.peak_rps       ?? summary.peakRps          ?? null,
      totalRequests: execution.total_requests  ?? summary.totalRequests   ?? null,
      totalErrors:   execution.total_errors    ?? null,
      passedSlos:    execution.passed_slos    ?? 0,
      failedSlos:    execution.failed_slos    ?? 0,
      samplers:      summary.samplers         || [],
      ...summary,
    };

    res.json({ data: metrics });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/reports/:executionId/jtl ─────────────────────────────────────
// Download the raw JTL results file.
router.get('/:executionId/jtl', async (req, res, next) => {
  try {
    const execution = await TestExecution.findById(req.params.executionId);
    if (!execution) {
      return res.status(404).json({ error: { message: 'Execution not found' } });
    }
    if (!execution.jtl_path) {
      return res.status(404).json({ error: { message: 'JTL file not available for this execution' } });
    }

    // Resolve actual path on the filesystem
    // jtl_path is stored as the container-internal path (/report/34/results.jtl).
    // In local Docker mode the volume is also mounted at REPORT_BASE on the API container.
    const absJtlPath = execution.jtl_path.startsWith('/')
      ? execution.jtl_path
      : path.join(REPORT_BASE, execution.jtl_path);

    if (!fs.existsSync(absJtlPath)) {
      return res.status(404).json({ error: { message: `JTL file not found on disk: ${absJtlPath}` } });
    }

    const fileName = `execution-${execution.id}-results.jtl`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'text/csv');
    const stream = fs.createReadStream(absJtlPath);
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/reports/:executionId/generate ───────────────────────────────
// Re-parse JTL and generate/regenerate the JMeter HTML dashboard.
router.post('/:executionId/generate', async (req, res, next) => {
  try {
    const execution = await TestExecution.findById(req.params.executionId);
    if (!execution) {
      return res.status(404).json({ error: { message: 'Execution not found' } });
    }
    if (!execution.jtl_path) {
      return res.status(404).json({ error: { message: 'JTL file not available — cannot generate report' } });
    }

    const absJtlPath = execution.jtl_path.startsWith('/')
      ? execution.jtl_path
      : path.join(REPORT_BASE, execution.jtl_path);

    if (!fs.existsSync(absJtlPath)) {
      return res.status(404).json({ error: { message: `JTL file not found: ${absJtlPath}` } });
    }

    const htmlReportDir = path.join(REPORT_BASE, `exec-${execution.id}`, 'html-report');

    // Clear old report if it exists (JMeter fails if the directory is non-empty)
    if (fs.existsSync(htmlReportDir)) {
      fs.rmSync(htmlReportDir, { recursive: true, force: true });
    }
    fs.mkdirSync(htmlReportDir, { recursive: true });

    // Re-parse JTL and update metric columns
    try {
      const metrics = parseJtl(absJtlPath);
      await TestExecution.storeMetrics(execution.id, {
        p50Ms:         metrics.p50Ms,
        p95Ms:         metrics.p95Ms,
        p99Ms:         metrics.p99Ms,
        errorRatePct:  metrics.errorRatePct,
        peakRps:       metrics.peakRps,
        avgRps:        metrics.avgRps,
        totalRequests: metrics.totalRequests,
        totalErrors:   metrics.totalErrors,
      });
    } catch (parseErr) {
      logger.warn(`[report:${execution.id}] JTL re-parse failed: ${parseErr.message}`);
    }

    // Spawn JMeter in report-generation mode (-g -o)
    const JMETER_CMD = process.env.JMETER_CMD || 'jmeter';
    execFile(
      JMETER_CMD,
      ['-g', absJtlPath, '-o', htmlReportDir],
      { timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          logger.error(`[report:${execution.id}] JMeter report gen failed: ${err.message}`);
          return next(Object.assign(new Error(`JMeter report generation failed: ${err.message}`), { status: 500 }));
        }
        logger.info(`[report:${execution.id}] HTML report generated at ${htmlReportDir}`);
        res.json({
          data: {
            htmlReportUrl: `/report/exec-${execution.id}/html-report/index.html`,
            generatedAt:   new Date().toISOString(),
          },
          message: 'HTML report generated successfully',
        });
      },
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
