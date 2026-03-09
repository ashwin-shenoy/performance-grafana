/**
 * Test Execution API Routes
 *
 * POST   /api/v1/executions                — Start a new test execution
 * GET    /api/v1/executions                — List executions (paginated, filterable)
 * GET    /api/v1/executions/compare        — Compare 2–6 executions side-by-side
 * GET    /api/v1/executions/:id            — Get execution details + live pod info
 * POST   /api/v1/executions/:id/stop       — Stop a running execution
 * GET    /api/v1/executions/:id/logs       — Stream controller logs (Docker or K8s)
 */
'use strict';

const express          = require('express');
const TestExecution    = require('../models/TestExecution');
const ExecutionService = require('../services/ExecutionService');
const validate         = require('../middleware/validate');
const logger           = require('../utils/logger');

const router = express.Router();

// ── POST /api/v1/executions ───────────────────────────────────────────────────
router.post(
  '/',
  validate({
    body: {
      testPlanId:     { type: 'integer', min: 1 },
      '?workerCount': { type: 'integer', min: 1, max: 50 },
    },
  }),
  async (req, res, next) => {
    try {
      const { testPlanId, workerCount, parameters, environmentId, triggeredBy } = req.body;

      const execution = await ExecutionService.startTest({
        testPlanId:   parseInt(testPlanId, 10),
        triggeredBy:  triggeredBy || req.headers['x-user'] || 'api',
        workerCount:  parseInt(workerCount || '1', 10),
        parameters:   parameters || {},
        environmentId,
      });

      res.status(202).json({
        data:    execution,
        message: 'Test execution started. Poll GET /api/v1/executions/:id for status.',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/executions ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, status, testPlanId, environmentId, from, to } = req.query;

    const VALID_STATUSES = ['PENDING', 'PROVISIONING', 'RUNNING', 'COMPLETED', 'FAILED', 'STOPPED'];
    if (status && !VALID_STATUSES.includes(status.toUpperCase())) {
      return res.status(400).json({
        error: { message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      });
    }

    const result = await TestExecution.findAll({
      page:          parseInt(page  || '1',  10),
      limit:         Math.min(parseInt(limit || '20', 10), 100),
      status:        status ? status.toUpperCase() : undefined,
      testPlanId,
      environmentId,
      from,
      to,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/executions/compare ───────────────────────────────────────────
// MUST be defined before /:id so Express doesn't treat "compare" as an id param.
router.get('/compare', async (req, res, next) => {
  try {
    const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length < 2) {
      return res.status(400).json({ error: { message: 'Provide at least 2 execution IDs via ?ids=1,2' } });
    }
    if (ids.length > 6) {
      return res.status(400).json({ error: { message: 'Cannot compare more than 6 executions at once' } });
    }

    const executions = await Promise.all(ids.map(id => TestExecution.findById(id)));
    const valid = executions.filter(Boolean);

    if (valid.length < 2) {
      return res.status(404).json({ error: { message: 'At least 2 of the provided execution IDs must exist' } });
    }

    const comparison = valid.map((exec) => {
      const summary = typeof exec.summary === 'string'
        ? JSON.parse(exec.summary) : exec.summary || {};
      const durationMs = exec.started_at && exec.finished_at
        ? new Date(exec.finished_at) - new Date(exec.started_at) : null;

      return {
        id:           exec.id,
        testPlanName: exec.test_plan_name,
        jmxFileName:  exec.jmx_file_name,
        status:       exec.status,
        workerCount:  exec.worker_count,
        triggeredBy:  exec.triggered_by,
        startedAt:    exec.started_at,
        finishedAt:   exec.finished_at,
        durationMs,
        durationSec:  durationMs ? Math.round(durationMs / 1000) : null,

        // Dedicated metric columns (populated by JTL parser)
        p50Ms:         exec.p50_ms         ?? summary.p50ResponseTime ?? null,
        p95Ms:         exec.p95_ms         ?? summary.p95ResponseTime ?? null,
        p99Ms:         exec.p99_ms         ?? summary.p99ResponseTime ?? null,
        avgMs:         summary.avgResponseTime                        ?? null,
        errorRatePct:  exec.error_rate_pct ?? summary.errorRate       ?? null,
        avgRps:        exec.avg_rps        ?? summary.throughput      ?? null,
        peakRps:       exec.peak_rps       ?? summary.peakRps         ?? null,
        totalRequests: exec.total_requests  ?? summary.totalRequests  ?? null,
        totalErrors:   exec.total_errors    ?? null,

        // SLO outcome
        passedSlos: exec.passed_slos ?? 0,
        failedSlos: exec.failed_slos ?? 0,

        // Per-sampler breakdown
        samplers: summary.samplers || [],

        // JMeter run parameters
        parameters: typeof exec.parameters === 'string'
          ? JSON.parse(exec.parameters) : exec.parameters || {},
      };
    });

    res.json({ data: comparison, count: comparison.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/executions/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const execution = await ExecutionService.getStatus(req.params.id);
    res.json({ data: execution });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/executions/:id/stop ─────────────────────────────────────────
router.post('/:id/stop', async (req, res, next) => {
  try {
    const execution = await ExecutionService.stopTest(req.params.id);
    res.json({ data: execution, message: 'Test execution stopped' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/executions/:id/logs ──────────────────────────────────────────
router.get('/:id/logs', async (req, res, next) => {
  try {
    const execution = await TestExecution.findById(req.params.id);
    if (!execution) {
      return res.status(404).json({ error: { message: 'Execution not found' } });
    }

    const lines = Math.min(parseInt(req.query.lines || '200', 10), 2000);

    // ── Local Docker mode ─────────────────────────────────────────────────────
    if (execution.kube_namespace === 'local') {
      // 1. Try live container logs
      if (execution.controller_job_name) {
        try {
          const Docker    = require('dockerode');
          const docker    = new Docker({ socketPath: '/var/run/docker.sock' });
          const container = docker.getContainer(execution.controller_job_name);
          const logBuffer = await container.logs({ stdout: true, stderr: true, follow: false, tail: lines });
          const cleaned   = logBuffer.toString('utf8').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
          return res.json({ data: { logs: cleaned, source: 'docker', containerName: execution.controller_job_name } });
        } catch (_) { /* container gone — fall through to file */ }
      }

      // 2. Fall back to stored log file
      const fs      = require('fs');
      const logFile = `/report/${execution.id}/jmeter-controller.log`;
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        const tail    = content.split('\n').slice(-lines).join('\n');
        return res.json({ data: { logs: tail, source: 'file', path: logFile } });
      }

      return res.json({ data: { logs: '', source: 'local', message: 'No logs available for this execution' } });
    }

    // ── Kubernetes mode ───────────────────────────────────────────────────────
    const ns = execution.kube_namespace;
    if (!ns || !execution.controller_job_name) {
      return res.json({ data: { logs: '', source: 'kubernetes', message: 'No Kubernetes resources found' } });
    }

    try {
      const KubernetesService = require('../services/KubernetesService');
      const pods = await KubernetesService.getPodsByLabel(ns, `job-name=${execution.controller_job_name}`);
      if (!pods || pods.length === 0) {
        return res.json({ data: { logs: '', source: 'kubernetes', message: 'No pods found for this execution' } });
      }

      const k8s      = require('../config/kubernetes').getKubeConfig();
      const { CoreV1Api } = require('@kubernetes/client-node');
      const coreApi  = k8s.makeApiClient(CoreV1Api);
      const podName  = pods[0].metadata.name;

      const logResp = await coreApi.readNamespacedPodLog(
        podName, ns, 'jmeter-controller',
        undefined, undefined, undefined, undefined, undefined, undefined, lines,
      );
      return res.json({ data: { logs: logResp.body || '', source: 'kubernetes', podName } });
    } catch (err) {
      logger.warn(`[exec:${execution.id}] K8s log fetch failed: ${err.message}`);
      return res.json({ data: { logs: '', source: 'kubernetes', message: err.message } });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
