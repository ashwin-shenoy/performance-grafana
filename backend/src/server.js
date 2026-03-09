/**
 * Performance Testing Platform — API Server
 *
 * Express-based REST API that orchestrates distributed JMeter tests
 * on OpenShift/Kubernetes. Provides endpoints for test management,
 * execution, scheduling, and result retrieval.
 */
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { collectDefaultMetrics, register } = require('prom-client');

const testRoutes        = require('./routes/tests');
const executionRoutes   = require('./routes/executions');
const scheduleRoutes    = require('./routes/schedules');
const reportRoutes      = require('./routes/reports');
const environmentRoutes = require('./routes/environments');
const healthRoutes      = require('./routes/health');
const dashboardRoutes   = require('./routes/dashboard');
const logger            = require('./utils/logger');
const { initDatabase }  = require('./config/database');
const { initKubeClient } = require('./config/kubernetes');
const { startScheduler, stopAll: stopScheduler } = require('./jobs/scheduler');

const app = express();
const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // JMeter HTML reports use inline scripts + CDN resources (Bootstrap, etc.)
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'cdn.jsdelivr.net'],
      'style-src':  ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
      'img-src':    ["'self'", 'data:', '*'],
      'font-src':   ["'self'", 'data:', 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
    },
  },
  // Allow reports to be embedded (e.g. in iframes from the UI)
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Prometheus metrics
collectDefaultMetrics();
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ---------------------------------------------------------------------------
// Static — serve JMeter HTML report dashboards from the shared /report volume
// ---------------------------------------------------------------------------
const REPORT_BASE_PATH = process.env.REPORT_BASE_PATH || '/report';
app.use('/report', express.static(REPORT_BASE_PATH, {
  index: 'index.html',
  dotfiles: 'deny',
}));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/v1/health',        healthRoutes);
app.use('/api/v1/dashboard',     dashboardRoutes);
app.use('/api/v1/tests',         testRoutes);
app.use('/api/v1/executions',    executionRoutes);
app.use('/api/v1/schedules',     scheduleRoutes);
app.use('/api/v1/reports',       reportRoutes);
app.use('/api/v1/environments',  environmentRoutes);

// ---------------------------------------------------------------------------
// 404 — catch unknown API routes before the generic error handler
// ---------------------------------------------------------------------------
app.use('/api/', (req, res) => {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}`, code: 'NOT_FOUND' } });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  logger.error(`[${req.method} ${req.path}] ${status} — ${err.message}`, { stack: err.stack });
  res.status(status).json({
    error: {
      message: err.message || 'Internal server error',
      code:    err.code    || 'INTERNAL_ERROR',
    },
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
let server;

async function start() {
  try {
    await initDatabase();
    logger.info('Database connected');

    await initKubeClient();
    logger.info('Kubernetes client initialized');

    startScheduler();
    logger.info('Test scheduler started');

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Performance Platform API listening on port ${PORT}`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown — handles SIGTERM (Kubernetes pod eviction) and SIGINT
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully…`);
  stopScheduler();
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force-exit after 15 s if connections are still open
    setTimeout(() => process.exit(0), 15_000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();

module.exports = app;
