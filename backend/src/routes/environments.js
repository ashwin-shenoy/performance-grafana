/**
 * Environments API Routes
 *
 * Manage target environments (dev, staging, prod, etc.)
 * Each test plan and execution can be scoped to an environment.
 */
'use strict';

const express = require('express');
const { getDb } = require('../config/database');

const router = express.Router();
const TABLE = 'environments';

router.post('/', async (req, res, next) => {
  try {
    const { name, description, baseUrl, namespace } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const db = getDb();
    const [row] = await db(TABLE).insert({ name, description, base_url: baseUrl, namespace }).returning('*');
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db(TABLE).orderBy('name');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db(TABLE).where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ error: { message: 'Environment not found' } });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const { name, description, baseUrl, namespace } = req.body;
    const [row] = await db(TABLE).where({ id: req.params.id })
      .update({ name, description, base_url: baseUrl, namespace, updated_at: db.fn.now() })
      .returning('*');
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    await db(TABLE).where({ id: req.params.id }).del();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
