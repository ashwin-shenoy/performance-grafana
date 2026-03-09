/**
 * Test Scheduler — Runs scheduled tests via cron expressions
 *
 * • Loads all enabled schedules at startup and registers each as its own cron task.
 * • Exports reloadSchedule(schedule) and unloadSchedule(id) so the REST API
 *   can add/update/remove tasks at runtime without a server restart.
 */
'use strict';

const cron             = require('node-cron');
const Schedule         = require('../models/Schedule');
const ExecutionService = require('../services/ExecutionService');
const logger           = require('../utils/logger');

// Map of scheduleId → node-cron ScheduledTask
const activeTasks = new Map();

// ── startScheduler ────────────────────────────────────────────────────────────
function startScheduler() {
  registerAllSchedules();
  logger.info('Test scheduler initialized');
}

// ── registerAllSchedules ──────────────────────────────────────────────────────
async function registerAllSchedules() {
  try {
    const schedules = await Schedule.findEnabled();
    for (const schedule of schedules) {
      reloadSchedule(schedule);
    }
    logger.info(`Scheduler: registered ${schedules.length} enabled schedule(s)`);
  } catch (err) {
    logger.error(`Scheduler: failed to register schedules: ${err.message}`);
  }
}

// ── reloadSchedule ────────────────────────────────────────────────────────────
// Register (or replace) a single schedule.  Called after create / update / patch.
function reloadSchedule(schedule) {
  if (!schedule || !schedule.id) return;

  // Tear down the old task for this schedule if one is running
  unloadSchedule(schedule.id);

  if (!schedule.enabled) {
    logger.info(`Scheduler: schedule ${schedule.id} is disabled — not registered`);
    return;
  }

  if (!cron.validate(schedule.cron_expression)) {
    logger.warn(`Scheduler: invalid cron expression for schedule ${schedule.id}: "${schedule.cron_expression}"`);
    return;
  }

  const task = cron.schedule(schedule.cron_expression, async () => {
    logger.info(`Scheduler: triggering schedule ${schedule.id} ("${schedule.test_plan_name || schedule.test_plan_id}")`);
    try {
      const params = typeof schedule.parameters === 'string'
        ? JSON.parse(schedule.parameters) : schedule.parameters || {};

      await ExecutionService.startTest({
        testPlanId:   schedule.test_plan_id,
        triggeredBy:  `schedule:${schedule.id}`,
        workerCount:  schedule.worker_count,
        parameters:   params,
        environmentId: schedule.environment_id,
      });

      await Schedule.updateLastRun(schedule.id);
      logger.info(`Scheduler: schedule ${schedule.id} triggered successfully`);
    } catch (err) {
      logger.error(`Scheduler: schedule ${schedule.id} failed — ${err.message}`);
    }
  });

  activeTasks.set(schedule.id, task);
  logger.info(`Scheduler: registered schedule ${schedule.id} (cron="${schedule.cron_expression}")`);
}

// ── unloadSchedule ────────────────────────────────────────────────────────────
// Stop and remove a registered cron task by schedule ID.
function unloadSchedule(scheduleId) {
  const existing = activeTasks.get(scheduleId);
  if (existing) {
    existing.stop();
    activeTasks.delete(scheduleId);
    logger.info(`Scheduler: unloaded schedule ${scheduleId}`);
  }
}

// ── stopAll (for graceful shutdown) ──────────────────────────────────────────
function stopAll() {
  for (const [id, task] of activeTasks.entries()) {
    task.stop();
    logger.info(`Scheduler: stopped task for schedule ${id}`);
  }
  activeTasks.clear();
}

module.exports = { startScheduler, reloadSchedule, unloadSchedule, stopAll };
