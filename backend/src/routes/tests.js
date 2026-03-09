/**
 * Test Plans (Workloads) API Routes
 *
 * POST   /api/v1/tests                    — Upload a new test plan (.jmx)
 * GET    /api/v1/tests                    — List all test plans (paginated, searchable)
 * GET    /api/v1/tests/:id                — Get test plan details (including JMX content)
 * GET    /api/v1/tests/:id/executions     — List executions for this test plan
 * PUT    /api/v1/tests/:id                — Update test plan metadata
 * DELETE /api/v1/tests/:id                — Delete a test plan
 */
'use strict';

const express  = require('express');
const multer   = require('multer');
const TestPlan = require('../models/TestPlan');
const validate = require('../middleware/validate');
const logger   = require('../utils/logger');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },   // 50 MB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.jmx')) {
      return cb(new Error('Only .jmx files are allowed'));
    }
    cb(null, true);
  },
});

const VALID_SCENARIOS = ['smoke', 'load', 'stress', 'soak', 'spike', 'custom'];

// ── POST /api/v1/tests ────────────────────────────────────────────────────────
router.post('/', upload.single('jmxFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No .jmx file uploaded', code: 'MISSING_FILE' } });
    }

    // Validate optional scenario value if provided
    const scenario = req.body.scenario || 'stress';
    if (!VALID_SCENARIOS.includes(scenario)) {
      return res.status(400).json({
        error: { message: `Invalid scenario. Must be one of: ${VALID_SCENARIOS.join(', ')}` },
      });
    }

    // Parse config if it arrives as a JSON string from multipart form
    let config = {};
    if (req.body.config) {
      try { config = JSON.parse(req.body.config); } catch (_) {}
    }

    const testPlan = await TestPlan.create({
      name:          req.body.name        || req.file.originalname.replace(/\.jmx$/i, ''),
      description:   req.body.description || '',
      jmxFileName:   req.file.originalname,
      jmxContent:    req.file.buffer.toString('utf-8'),
      createdBy:     req.body.createdBy   || req.headers['x-user'] || 'anonymous',
      environmentId: req.body.environmentId || null,
      config,
      team:          req.body.team     || 'default',
      service:       req.body.service  || 'unknown',
      scenario,
    });

    logger.info(`Test plan created: ${testPlan.id} (${testPlan.name})`);
    res.status(201).json({ data: testPlan });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tests ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, search, environmentId, team, service, scenario } = req.query;
    const result = await TestPlan.findAll({
      page:          parseInt(page  || '1',  10),
      limit:         Math.min(parseInt(limit || '20', 10), 100),
      search,
      environmentId,
      team,
      service,
      scenario,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tests/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const testPlan = await TestPlan.findById(req.params.id);
    if (!testPlan) return res.status(404).json({ error: { message: 'Test plan not found' } });
    res.json({ data: testPlan });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tests/:id/executions ─────────────────────────────────────────
router.get('/:id/executions', async (req, res, next) => {
  try {
    const testPlan = await TestPlan.findById(req.params.id);
    if (!testPlan) return res.status(404).json({ error: { message: 'Test plan not found' } });

    const { page, limit } = req.query;
    const result = await TestPlan.findExecutions(req.params.id, {
      page:  parseInt(page  || '1',  10),
      limit: Math.min(parseInt(limit || '20', 10), 100),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/tests/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    // Validate scenario if changing it
    if (req.body.scenario && !VALID_SCENARIOS.includes(req.body.scenario)) {
      return res.status(400).json({
        error: { message: `Invalid scenario. Must be one of: ${VALID_SCENARIOS.join(', ')}` },
      });
    }

    const testPlan = await TestPlan.update(req.params.id, req.body);
    if (!testPlan) return res.status(404).json({ error: { message: 'Test plan not found' } });
    res.json({ data: testPlan });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/tests/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const testPlan = await TestPlan.findById(req.params.id);
    if (!testPlan) return res.status(404).json({ error: { message: 'Test plan not found' } });
    await TestPlan.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
