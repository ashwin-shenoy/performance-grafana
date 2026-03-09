/**
 * ExecutionService — Core test execution engine
 *
 * Three execution modes:
 *   STANDALONE_MODE=true → runs JMeter binary directly on the host via child_process.spawn
 *   LOCAL_MODE=true      → runs JMeter via Docker socket (docker-compose dev)
 *   (default)            → dispatches to Kubernetes (production / OpenShift)
 *
 * InfluxDB tagging strategy:
 *   Every JMeter data point carries:
 *     application  = workload_name (slugified test plan name)
 *     transaction  = sampler name | "all" | "internal"
 *     statut       = "ok" | "ko" | "all"
 *   Event annotations carry additional tags:
 *     workload_name = workload_name
 *     test_run_id   = execution.id
 *
 * Grafana URL format:
 *   /d/jmeter-perf/jmeter-perf
 *     ?var-workload_name=<workload>
 *     &var-test_run_id=<runId>
 *     &from=<startMs>
 *     &to=now
 *     &refresh=5s
 *
 * States: PENDING → PROVISIONING → RUNNING → COMPLETED | FAILED | STOPPED
 */
'use strict';

const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');
const TestExecution  = require('../models/TestExecution');
const TestPlan       = require('../models/TestPlan');
const KubernetesService = require('./KubernetesService');
const logger         = require('../utils/logger');
const { parseJtl }   = require('../utils/jtlParser');

const STANDALONE_MODE = process.env.STANDALONE_MODE === 'true';
const LOCAL_MODE      = !STANDALONE_MODE && process.env.LOCAL_MODE === 'true';
const DEFAULT_NS      = process.env.KUBE_NAMESPACE || 'perf-testing';
const JMETER_IMAGE    = process.env.JMETER_IMAGE   || 'perf-platform-jmeter';
const API_CONTAINER   = process.env.API_CONTAINER  || 'perf-platform-api';
const DOCKER_NETWORK  = process.env.DOCKER_NETWORK || 'perf-platform_perf-platform';
const RESULTS_PATH    = process.env.RESULTS_PATH   || '/report';

// Standalone-mode settings
const JMETER_BIN      = process.env.JMETER_BIN     || '/opt/jmeter/bin/jmeter';
const INFLUXDB_URL    = process.env.INFLUXDB_URL    ||
  'http://localhost:8086/api/v2/write?org=perf-testing&bucket=jmeter&precision=ms';
const INFLUXDB_TOKEN  = process.env.INFLUXDB_TOKEN  || 'changeme123';

const GRAFANA_EXTERNAL_URL  = process.env.GRAFANA_EXTERNAL_URL || 'http://localhost:3001';
const GRAFANA_DASHBOARD_UID  = 'jmeter-perf';
const GRAFANA_DASHBOARD_SLUG = 'jmeter-perf';

// ── JMeter flag helpers ───────────────────────────────────────────────────────

// Plan config / execution metadata keys that must NOT be forwarded to JMeter
// as -J properties (they are UI-only or K8s-only values).
const JMETER_PARAM_EXCLUDE = new Set([
  'type', 'capability', 'channel', 'threadGroups',
  'workerCpu', 'workerMemory', 'workerCpuLimit', 'workerMemoryLimit',
]);

/**
 * Build a flat array of -J<key>=<value> strings from the merged parameters
 * object, forwarding every key that is not in JMETER_PARAM_EXCLUDE.
 *
 * This covers all three categories automatically:
 *   • Global load shape:       threads, rampUp, duration, host, port
 *   • Per-thread-group params: {slug}_users, {slug}_rampup,
 *                              {slug}_duration, {slug}_thinktime
 *   • InfluxDB overrides:      influxdbUrl, influxdbToken  (standalone mode)
 *
 * workload_name and test_run_id are always appended last so they can
 * never be accidentally overridden by a plan config value.
 *
 * @param {Record<string,any>} params
 * @param {string} workloadName   - slugified test plan name
 * @param {number|string} runId   - execution ID
 * @returns {string[]}
 */
function buildJmeterJFlags(params, workloadName, runId) {
  const flags = [];
  for (const [key, val] of Object.entries(params)) {
    if (JMETER_PARAM_EXCLUDE.has(key)) continue;
    if (val === undefined || val === null)  continue;
    if (typeof val === 'object')            continue; // skip nested objects
    flags.push(`-J${key}=${val}`);
  }
  // Identity flags always override anything in params
  flags.push(`-Jworkload_name=${workloadName}`);
  flags.push(`-Jtest_run_id=${runId}`);
  return flags;
}

// Slugify a workload name for use as an InfluxDB tag value.
// Keeps alphanumeric + dash + underscore; replaces spaces with dashes.
function slugify(name) {
  return (name || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

class ExecutionService {
  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  static async startTest({ testPlanId, triggeredBy, workerCount = 1, parameters = {}, environmentId }) {
    const testPlan = await TestPlan.findById(testPlanId);
    if (!testPlan) throw Object.assign(new Error('Test plan not found'), { status: 404 });

    const planConfig   = typeof testPlan.config === 'string' ? JSON.parse(testPlan.config) : testPlan.config || {};
    const mergedParams = { ...planConfig, ...parameters };

    // ── Workload identity ──────────────────────────────────────────────────
    // workload_name → the "application" tag on every InfluxDB data point.
    // Grafana uses this to filter the jmeter-perf dashboard by workload.
    const workloadName = slugify(testPlan.name);

    // Create the execution record first so we have an ID for the run tag.
    const execution = await TestExecution.create({
      testPlanId,
      triggeredBy:  triggeredBy || 'api',
      workerCount:  LOCAL_MODE ? 1 : workerCount,
      parameters:   mergedParams,
      environmentId: environmentId || testPlan.environment_id,
      grafanaUrl:   null,   // updated below once we have the execution ID
    });

    const runId = execution.id;

    // ── Grafana URL scoped to this run ─────────────────────────────────────
    // from = 1 min before launch (captures ramp-up traffic).
    // var-workload_name + var-test_run_id pre-fill the dashboard variables.
    const fromMs     = Date.now() - 60_000;
    const grafanaUrl =
      `${GRAFANA_EXTERNAL_URL}/d/${GRAFANA_DASHBOARD_UID}/${GRAFANA_DASHBOARD_SLUG}` +
      `?orgId=1` +
      `&var-workload_name=${encodeURIComponent(workloadName)}` +
      `&var-test_run_id=${runId}` +
      `&from=${fromMs}` +
      `&to=now` +
      `&refresh=5s`;

    // Persist the URL so the frontend can surface it immediately.
    await TestExecution.updateGrafanaUrl(runId, grafanaUrl);
    execution.grafana_url = grafanaUrl;

    const execMode = STANDALONE_MODE ? 'standalone' : LOCAL_MODE ? 'local-docker' : 'kubernetes';
    logger.info(`[exec:${runId}] Created for workload="${workloadName}" [mode: ${execMode}]`);

    this._executeAsync(execution, testPlan, mergedParams, workloadName, runId).catch((err) => {
      logger.error(`[exec:${runId}] launch error: ${err.message}`);
      TestExecution.updateStatus(runId, TestExecution.STATUS.FAILED, { error_message: err.message });
    });

    return execution;
  }

  static async stopTest(executionId) {
    const execution = await TestExecution.findById(executionId);
    if (!execution) throw Object.assign(new Error('Execution not found'), { status: 404 });

    const active = [TestExecution.STATUS.PENDING, TestExecution.STATUS.PROVISIONING, TestExecution.STATUS.RUNNING];
    if (!active.includes(execution.status)) {
      throw Object.assign(new Error(`Cannot stop execution in ${execution.status} state`), { status: 400 });
    }

    if (execution.kube_namespace === 'standalone') {
      // STANDALONE_MODE: kill the JMeter process by PID stored in controller_job_name
      const pid = parseInt(execution.controller_job_name, 10);
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          logger.info(`[exec:${executionId}] Sent SIGTERM to standalone JMeter PID ${pid}`);
          // Give it 5s to exit gracefully before forcing
          setTimeout(() => {
            try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
          }, 5000);
        } catch (err) {
          logger.warn(`[exec:${executionId}] Could not signal PID ${pid}: ${err.message}`);
        }
      }
    } else if (execution.kube_namespace === 'local') {
      if (execution.controller_job_name) {
        try {
          const Docker = require('dockerode');
          const docker = new Docker({ socketPath: '/var/run/docker.sock' });
          const container = docker.getContainer(execution.controller_job_name);
          await container.stop({ t: 5 });
          logger.info(`[exec:${executionId}] Stopped local container ${execution.controller_job_name}`);
        } catch (err) {
          logger.warn(`[exec:${executionId}] Could not stop container: ${err.message}`);
        }
      }
    } else {
      const ns = execution.kube_namespace || DEFAULT_NS;
      if (execution.controller_job_name) await KubernetesService.deleteJob(ns, execution.controller_job_name).catch(() => {});
      if (execution.worker_job_name)     await KubernetesService.deleteJob(ns, execution.worker_job_name).catch(() => {});
    }

    const updated = await TestExecution.updateStatus(executionId, TestExecution.STATUS.STOPPED);
    logger.info(`[exec:${executionId}] STOPPED`);
    return updated;
  }

  static async getStatus(executionId) {
    const execution = await TestExecution.findById(executionId);
    if (!execution) throw Object.assign(new Error('Execution not found'), { status: 404 });

    const result  = { ...execution };
    const running = [TestExecution.STATUS.PROVISIONING, TestExecution.STATUS.RUNNING];
    const isK8s   = execution.kube_namespace &&
                    execution.kube_namespace !== 'local' &&
                    execution.kube_namespace !== 'standalone';
    if (running.includes(execution.status) && isK8s) {
      try {
        result.pods = await KubernetesService.getPodsByLabel(execution.kube_namespace, `execution-id=${executionId}`);
      } catch {
        result.pods = [];
      }
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: route to correct executor
  // ─────────────────────────────────────────────────────────────────────────

  static async _executeAsync(execution, testPlan, params, workloadName, runId) {
    if (STANDALONE_MODE) return this._executeStandalone(execution, testPlan, params, workloadName, runId);
    if (LOCAL_MODE)      return this._executeLocal(execution, testPlan, params, workloadName, runId);
    return this._executeKubernetes(execution, testPlan, params, workloadName, runId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Standalone execution (bare-metal / non-Docker)
  //
  // Runs the JMeter binary installed at JMETER_BIN directly on the host via
  // child_process.spawn.  The JMX is written to RESULTS_PATH so it persists
  // alongside the JTL output.
  //
  // Key env vars (set in .env or systemd unit):
  //   STANDALONE_MODE=true
  //   JMETER_BIN=/opt/jmeter/bin/jmeter
  //   INFLUXDB_URL=http://localhost:8086/api/v2/write?org=perf-testing&bucket=jmeter&precision=ms
  //   INFLUXDB_TOKEN=<your-token>
  //   RESULTS_PATH=/opt/perf-platform/report
  //
  // JMeter flags injected (override JMX ${__P(...)} properties):
  //   -JinfluxdbUrl      → points to local InfluxDB (not the Docker hostname)
  //   -JinfluxdbToken    → InfluxDB API token
  //   -Jworkload_name    → InfluxDB "application" tag on all data points
  //   -Jtest_run_id      → embedded in testTitle + eventTags (annotations)
  // ─────────────────────────────────────────────────────────────────────────

  static async _executeStandalone(execution, testPlan, params, workloadName, runId) {
    const executionId = execution.id;
    const resultsDir  = path.join(RESULTS_PATH, String(executionId));
    const jmxPath     = path.join(RESULTS_PATH, `jmx-${executionId}.jmx`);
    const jtlPath     = path.join(resultsDir, 'results.jtl');
    const logPath     = path.join(resultsDir, 'jmeter.log');

    await TestExecution.updateStatus(executionId, TestExecution.STATUS.PROVISIONING);

    // Write JMX to results dir
    try {
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(jmxPath, testPlan.jmx_content || '');
    } catch (err) {
      logger.error(`[exec:${executionId}] Could not write JMX file: ${err.message}`);
      await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, { error_message: err.message });
      return;
    }

    // ── JMeter runtime parameters ──────────────────────────────────────────
    const get = (keys, def) => { for (const k of keys) if (params[k] !== undefined) return params[k]; return def; };
    // Extract globals for execution summary storage
    const host     = get(['host', 'TARGET_HOST'],  'localhost');
    const port     = get(['port', 'TARGET_PORT'],  3002);
    const threads  = get(['threads', 'THREADS'],   10);
    const rampUp   = get(['rampUp', 'RAMP_UP'],    10);
    const duration = get(['duration', 'DURATION'], 180);

    // Build the complete parameter set for flag generation:
    //   1. Standalone defaults (host=localhost, InfluxDB on localhost)
    //   2. Plan config + user overrides (may include per-thread-group params)
    //   3. InfluxDB connection always overridden for standalone (last wins)
    const standaloneParams = {
      host:     'localhost',
      port:     3002,
      threads:  10,
      rampUp:   10,
      duration: 180,
      ...params,
      // Always override InfluxDB so the Docker hostname is never used
      influxdbUrl:   INFLUXDB_URL,
      influxdbToken: INFLUXDB_TOKEN,
    };

    const jmeterArgs = [
      '-n',
      '-t', jmxPath,
      '-l', jtlPath,
      '-j', logPath,
      // Dynamically builds -J flags for global AND per-thread-group params,
      // including the InfluxDB overrides merged into standaloneParams above.
      ...buildJmeterJFlags(standaloneParams, workloadName, runId),
    ];

    logger.info(`[exec:${executionId}] standalone workload="${workloadName}" run_id=${runId}`);
    logger.info(`[exec:${executionId}] ${JMETER_BIN} ${jmeterArgs.join(' ')}`);

    let jmeterProc;
    try {
      jmeterProc = spawn(JMETER_BIN, jmeterArgs, {
        detached: false,
        stdio:    ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      logger.error(`[exec:${executionId}] Failed to spawn JMeter: ${err.message}`);
      await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, { error_message: err.message });
      try { fs.unlinkSync(jmxPath); } catch {}
      return;
    }

    // Store PID so stopTest() can signal the process
    await TestExecution.setKubeResources(executionId, {
      controllerJobName: String(jmeterProc.pid),
      workerJobName:     '',
      namespace:         'standalone',
    });

    await TestExecution.updateStatus(executionId, TestExecution.STATUS.RUNNING);
    logger.info(`[exec:${executionId}] JMeter spawned (PID=${jmeterProc.pid})`);

    // Stream stdout/stderr into API log
    jmeterProc.stdout.on('data', (chunk) => {
      const line = chunk.toString('utf8').trim();
      if (line) logger.info(`[jmeter:${executionId}] ${line}`);
    });
    jmeterProc.stderr.on('data', (chunk) => {
      const line = chunk.toString('utf8').trim();
      if (line) logger.warn(`[jmeter:${executionId}] ${line}`);
    });

    // Wait for JMeter to finish
    const exitCode = await new Promise((resolve) => {
      jmeterProc.once('close', resolve);
      jmeterProc.once('error', (err) => {
        logger.error(`[exec:${executionId}] JMeter process error: ${err.message}`);
        resolve(1);
      });
    });

    logger.info(`[exec:${executionId}] JMeter exited (code=${exitCode})`);

    // Clean up JMX file
    try { fs.unlinkSync(jmxPath); } catch {}

    // Check whether execution was stopped externally
    const current = await TestExecution.findById(executionId);
    if (current && current.status === TestExecution.STATUS.STOPPED) {
      logger.info(`[exec:${executionId}] Already marked STOPPED — skipping final status update`);
      return;
    }

    if (exitCode === 0) {
      let parsedMetrics = null;
      try {
        parsedMetrics = parseJtl(jtlPath);
        logger.info(
          `[exec:${executionId}] JTL parsed: ` +
          `${parsedMetrics.totalRequests} reqs, ` +
          `p95=${parsedMetrics.p95Ms}ms, ` +
          `err=${parsedMetrics.errorRatePct}%`
        );
      } catch (parseErr) {
        logger.warn(`[exec:${executionId}] JTL parse failed (non-fatal): ${parseErr.message}`);
      }

      await TestExecution.storeResults(executionId, {
        jtlPath,
        reportPath: resultsDir,
        summary: {
          exitCode, host, threads, rampUp, duration,
          workloadName, runId,
          ...(parsedMetrics ? {
            totalRequests:   parsedMetrics.totalRequests,
            totalErrors:     parsedMetrics.totalErrors,
            avgResponseTime: parsedMetrics.avgMs,
            p50ResponseTime: parsedMetrics.p50Ms,
            p95ResponseTime: parsedMetrics.p95Ms,
            p99ResponseTime: parsedMetrics.p99Ms,
            errorRate:       parsedMetrics.errorRatePct,
            throughput:      parsedMetrics.avgRps,
            peakRps:         parsedMetrics.peakRps,
            samplers:        parsedMetrics.samplers,
          } : {}),
        },
      });

      if (parsedMetrics) {
        await TestExecution.storeMetrics(executionId, {
          p50Ms:         parsedMetrics.p50Ms,
          p95Ms:         parsedMetrics.p95Ms,
          p99Ms:         parsedMetrics.p99Ms,
          errorRatePct:  parsedMetrics.errorRatePct,
          peakRps:       parsedMetrics.peakRps,
          avgRps:        parsedMetrics.avgRps,
          totalRequests: parsedMetrics.totalRequests,
          totalErrors:   parsedMetrics.totalErrors,
        }).catch(err => logger.warn(`[exec:${executionId}] storeMetrics failed: ${err.message}`));
      }

      await TestExecution.updateStatus(executionId, TestExecution.STATUS.COMPLETED);
      logger.info(`[exec:${executionId}] COMPLETED — grafana: ${execution.grafana_url}`);
    } else {
      await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, {
        error_message: `JMeter exited with code ${exitCode}`,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Local Docker execution (via Docker socket)
  //
  // JMX is written to the shared jmeter-results volume so the JMeter
  // container (which inherits volumes from the API container) can read it.
  //
  // JMeter flags injected:
  //   -Jworkload_name   → InfluxDB "application" tag on all data points
  //   -Jtest_run_id     → embedded in testTitle + eventTags (annotations)
  // ─────────────────────────────────────────────────────────────────────────

  static async _executeLocal(execution, testPlan, params, workloadName, runId) {
    const executionId   = execution.id;
    const containerName = `jmeter-exec-${executionId}`;
    const jmxPath       = `${RESULTS_PATH}/jmx-${executionId}.jmx`;
    const resultsDir    = `${RESULTS_PATH}/${executionId}`;
    const jtlPath       = `${resultsDir}/results.jtl`;

    await TestExecution.updateStatus(executionId, TestExecution.STATUS.PROVISIONING);

    // Write JMX into shared volume so JMeter container can read it
    fs.writeFileSync(jmxPath, testPlan.jmx_content || '');
    fs.mkdirSync(resultsDir, { recursive: true });

    await TestExecution.setKubeResources(executionId, {
      controllerJobName: containerName,
      workerJobName:     '',
      namespace:         'local',
    });

    // ── JMeter runtime parameters ──────────────────────────────────────────
    const get = (keys, def) => { for (const k of keys) if (params[k] !== undefined) return params[k]; return def; };
    // Extract globals for execution summary storage (not used for flag building)
    const host     = get(['host', 'TARGET_HOST'],  'sample-app');
    const port     = get(['port', 'TARGET_PORT'],  3002);
    const threads  = get(['threads', 'THREADS'],   10);
    const rampUp   = get(['rampUp', 'RAMP_UP'],    10);
    const duration = get(['duration', 'DURATION'], 180);

    // Merge Docker-mode defaults so they're always present as -J fallbacks.
    // Per-thread-group params (e.g. browse_users, checkout_rampup) already live
    // in `params` and are forwarded automatically by buildJmeterJFlags().
    const localParams = {
      host, port, threads, rampUp, duration, // global defaults
      ...params,                              // plan config + user overrides
    };

    const jmeterCmd = [
      '-n',
      '-t', `/report/jmx-${executionId}.jmx`,
      '-l', `/report/${executionId}/results.jtl`,
      // Dynamically builds -J flags for global AND per-thread-group params
      ...buildJmeterJFlags(localParams, workloadName, runId),
    ];

    logger.info(`[exec:${executionId}] workload="${workloadName}" run_id=${runId}`);
    logger.info(`[exec:${executionId}] jmeter ${jmeterCmd.join(' ')}`);

    const Docker = require('dockerode');
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });

    let container;
    try {
      container = await docker.createContainer({
        name: containerName,
        Image: JMETER_IMAGE,
        Cmd:   jmeterCmd,
        HostConfig: {
          VolumesFrom: [API_CONTAINER],   // inherit /report volume
          NetworkMode: DOCKER_NETWORK,
          AutoRemove:  false,
        },
      });
    } catch (err) {
      logger.error(`[exec:${executionId}] Container create failed: ${err.message}`);
      try { fs.unlinkSync(jmxPath); } catch {}
      await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, { error_message: err.message });
      return;
    }

    await TestExecution.updateStatus(executionId, TestExecution.STATUS.RUNNING);

    try {
      await container.start();
      logger.info(`[exec:${executionId}] JMeter container started`);

      // Stream JMeter stdout/stderr into the API log
      const logStream = await container.logs({ stdout: true, stderr: true, follow: true });
      logStream.on('data', (chunk) => {
        const line = chunk.toString('utf8').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
        if (line) logger.info(`[jmeter:${executionId}] ${line}`);
      });

      const { StatusCode: exitCode } = await container.wait();
      logger.info(`[exec:${executionId}] Container exited (code=${exitCode})`);

      if (exitCode === 0) {
        // Parse JTL to extract final aggregated performance metrics
        let parsedMetrics = null;
        try {
          parsedMetrics = parseJtl(jtlPath);
          logger.info(
            `[exec:${executionId}] JTL parsed: ` +
            `${parsedMetrics.totalRequests} reqs, ` +
            `p95=${parsedMetrics.p95Ms}ms, ` +
            `err=${parsedMetrics.errorRatePct}%`
          );
        } catch (parseErr) {
          logger.warn(`[exec:${executionId}] JTL parse failed (non-fatal): ${parseErr.message}`);
        }

        await TestExecution.storeResults(executionId, {
          jtlPath,
          reportPath: resultsDir,
          summary: {
            exitCode, host, threads, rampUp, duration,
            workloadName, runId,
            ...(parsedMetrics ? {
              totalRequests:   parsedMetrics.totalRequests,
              totalErrors:     parsedMetrics.totalErrors,
              avgResponseTime: parsedMetrics.avgMs,
              p50ResponseTime: parsedMetrics.p50Ms,
              p95ResponseTime: parsedMetrics.p95Ms,
              p99ResponseTime: parsedMetrics.p99Ms,
              errorRate:       parsedMetrics.errorRatePct,
              throughput:      parsedMetrics.avgRps,
              peakRps:         parsedMetrics.peakRps,
              samplers:        parsedMetrics.samplers,
            } : {}),
          },
        });

        if (parsedMetrics) {
          await TestExecution.storeMetrics(executionId, {
            p50Ms:         parsedMetrics.p50Ms,
            p95Ms:         parsedMetrics.p95Ms,
            p99Ms:         parsedMetrics.p99Ms,
            errorRatePct:  parsedMetrics.errorRatePct,
            peakRps:       parsedMetrics.peakRps,
            avgRps:        parsedMetrics.avgRps,
            totalRequests: parsedMetrics.totalRequests,
            totalErrors:   parsedMetrics.totalErrors,
          }).catch(err => logger.warn(`[exec:${executionId}] storeMetrics failed: ${err.message}`));
        }

        await TestExecution.updateStatus(executionId, TestExecution.STATUS.COMPLETED);
        logger.info(`[exec:${executionId}] COMPLETED — grafana: ${execution.grafana_url}`);
      } else {
        const current = await TestExecution.findById(executionId);
        if (current && current.status !== TestExecution.STATUS.STOPPED) {
          await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, {
            error_message: `JMeter exited with code ${exitCode}`,
          });
        }
      }
    } catch (err) {
      logger.error(`[exec:${executionId}] Runtime error: ${err.message}`);
      const current = await TestExecution.findById(executionId);
      if (current && current.status === TestExecution.STATUS.RUNNING) {
        await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, { error_message: err.message });
      }
    } finally {
      try { fs.unlinkSync(jmxPath); } catch {}
      try { await container.remove({ force: true }); } catch {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Kubernetes execution (production / OpenShift — unchanged)
  // ─────────────────────────────────────────────────────────────────────────

  static async _executeKubernetes(execution, testPlan, params, workloadName, runId) {
    const executionId       = execution.id;
    const ns                = DEFAULT_NS;
    const workerCount       = execution.worker_count;
    const uniqueSuffix      = executionId.toString().slice(-8);
    const controllerJobName = `jmeter-ctrl-${uniqueSuffix}`;
    const workerJobName     = `jmeter-workers-${uniqueSuffix}`;

    await TestExecution.updateStatus(executionId, TestExecution.STATUS.PROVISIONING);
    await TestExecution.setKubeResources(executionId, { controllerJobName, workerJobName, namespace: ns });

    logger.info(`[exec:${executionId}] K8s: creating ${workerCount} worker pods...`);
    await KubernetesService.createWorkerJob({
      name: workerJobName, namespace: ns, parallelism: workerCount,
      image: JMETER_IMAGE, executionId,
      resources: {
        requests: { cpu: params.workerCpu || '2',      memory: params.workerMemory || '2Gi' },
        limits:   { cpu: params.workerCpuLimit || '4', memory: params.workerMemoryLimit || '4Gi' },
      },
    });

    await KubernetesService.waitForPods(ns, `job-name=${workerJobName}`, workerCount, 300);

    await KubernetesService.createControllerJob({
      name: controllerJobName, namespace: ns, image: JMETER_IMAGE, executionId,
      jmxContent: testPlan.jmx_content, jmxFileName: testPlan.jmx_file_name,
      workerJobName,
      params: { ...params, workload_name: workloadName, test_run_id: runId },
    });

    await TestExecution.updateStatus(executionId, TestExecution.STATUS.RUNNING);
    logger.info(`[exec:${executionId}] K8s RUNNING with ${workerCount} workers`);

    const finalStatus = await KubernetesService.waitForJobCompletion(
      ns, controllerJobName,
      params.duration ? parseInt(params.duration, 10) * 2 : 7200
    );

    if (finalStatus === 'Complete') {
      const resultPaths = await KubernetesService.collectResults(ns, controllerJobName, executionId);
      await TestExecution.storeResults(executionId, resultPaths);

      if (resultPaths.jtlPath) {
        try {
          const parsedMetrics = parseJtl(resultPaths.jtlPath);
          await TestExecution.storeMetrics(executionId, {
            p50Ms:         parsedMetrics.p50Ms,
            p95Ms:         parsedMetrics.p95Ms,
            p99Ms:         parsedMetrics.p99Ms,
            errorRatePct:  parsedMetrics.errorRatePct,
            peakRps:       parsedMetrics.peakRps,
            avgRps:        parsedMetrics.avgRps,
            totalRequests: parsedMetrics.totalRequests,
            totalErrors:   parsedMetrics.totalErrors,
          });
          logger.info(`[exec:${executionId}] K8s JTL parsed: p95=${parsedMetrics.p95Ms}ms`);
        } catch (parseErr) {
          logger.warn(`[exec:${executionId}] K8s JTL parse failed: ${parseErr.message}`);
        }
      }

      await TestExecution.updateStatus(executionId, TestExecution.STATUS.COMPLETED);
    } else {
      await TestExecution.updateStatus(executionId, TestExecution.STATUS.FAILED, {
        error_message: `Controller job finished with status: ${finalStatus}`,
      });
    }

    setTimeout(async () => {
      await KubernetesService.deleteJob(ns, workerJobName).catch(() => {});
      await KubernetesService.deleteJob(ns, controllerJobName).catch(() => {});
      logger.info(`[exec:${executionId}] K8s resources cleaned up`);
    }, 300_000);
  }
}

module.exports = ExecutionService;
