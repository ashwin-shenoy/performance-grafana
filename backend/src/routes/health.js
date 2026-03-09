/**
 * Health Check Routes
 */
'use strict';

const express = require('express');
const { getDb } = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/ready', async (req, res) => {
  try {
    const db = getDb();
    await db.raw('SELECT 1');
    res.json({ status: 'ready', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', database: 'disconnected', error: err.message });
  }
});

module.exports = router;
