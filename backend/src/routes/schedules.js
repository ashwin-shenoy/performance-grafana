/**
 * Schedule API Routes
 *
 * POST   /api/v1/schedules          — Create a scheduled test
 * GET    /api/v1/schedules          — List all schedules
 * GET    /api/v1/schedules/:id      — Get schedule details
 * PUT    /api/v1/schedules/:id      — Full update of a schedule
 * PATCH  /api/v1/schedules/:id      — Partial update (e.g. toggle enabled)
 * DELETE /api/v1/schedules/:id      — Delete schedule
 * POST   /api/v1/schedules/:id/run  — Manually trigger a scheduled test now
 */
'use strict';

const express          = require('express');
const Schedule         = require('../models/Schedule');
const ExecutionService = require('../services/ExecutionService');
const validate         = require('../middleware/validate');
const { reloadSchedule, unloadSchedule } = require('../jobs/scheduler');

const router = express.Router();

// ── POST /api/v1/schedules ────────────────────────────────────────────────────
router.post(
  '/',
  validate({
    body: {
      testPlanId:      { type: 'integer', min: 1 },
      cronExpression:  { type: 'cron' },
      '?workerCount':  { type: 'integer', min: 1, max: 50 },
    },
  }),
  async (req, res, next) => {
    try {
      const { testPlanId, cronExpression, workerCount, parameters, environmentId } = req.body;
      const schedule = await Schedule.create({
        testPlanId,
        cronExpression,
        workerCount,
        parameters,
        createdBy:     req.headers['x-user'] || 'api',
        environmentId,
      });

      // Dynamically register the new schedule so it fires without a restart
      reloadSchedule(schedule);

      res.status(201).json({ data: schedule });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/schedules ─────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const schedules = await Schedule.findAll();
    res.json({ data: schedules });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/schedules/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ error: { message: 'Schedule not found' } });
    res.json({ data: schedule });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/schedules/:id — Full update ───────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const schedule = await Schedule.update(req.params.id, req.body);
    if (!schedule) return res.status(404).json({ error: { message: 'Schedule not found' } });

    // Reload with updated cron expression / enabled state
    reloadSchedule(schedule);

    res.json({ data: schedule });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/schedules/:id — Partial update (enable/disable toggle) ──────
router.patch('/:id', async (req, res, next) => {
  try {
    // Only allow safe partial fields — no cron or testPlanId changes via PATCH
    const allowed = ['enabled', 'worker_count', 'workerCount', 'parameters', 'environment_id', 'environmentId'];
    const patch   = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        // Normalise camelCase → snake_case for the model
        const modelKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        patch[modelKey] = req.body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: { message: 'No patchable fields provided. Allowed: enabled, workerCount, parameters, environmentId' } });
    }

    const schedule = await Schedule.update(req.params.id, patch);
    if (!schedule) return res.status(404).json({ error: { message: 'Schedule not found' } });

    // Enable or disable the live cron task
    if (schedule.enabled) {
      reloadSchedule(schedule);
    } else {
      unloadSchedule(schedule.id);
    }

    res.json({ data: schedule });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/schedules/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ error: { message: 'Schedule not found' } });

    unloadSchedule(schedule.id);
    await Schedule.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/schedules/:id/run — Manual trigger ──────────────────────────
router.post('/:id/run', async (req, res, next) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ error: { message: 'Schedule not found' } });

    const params = typeof schedule.parameters === 'string'
      ? JSON.parse(schedule.parameters) : schedule.parameters || {};

    const execution = await ExecutionService.startTest({
      testPlanId:   schedule.test_plan_id,
      triggeredBy:  `manual:schedule:${schedule.id}`,
      workerCount:  schedule.worker_count,
      parameters:   params,
      environmentId: schedule.environment_id,
    });

    await Schedule.updateLastRun(schedule.id);

    res.status(202).json({
      data:    execution,
      message: `Schedule ${schedule.id} triggered manually. Poll GET /api/v1/executions/${execution.id} for status.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
