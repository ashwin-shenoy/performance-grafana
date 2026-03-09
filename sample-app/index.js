/**
 * Sample E-Commerce API — Load Test Target
 *
 * Endpoints:
 *   GET  /health              — health check (~5ms,    0% error)
 *   GET  /api/products        — list products (~150ms, ~5% error)
 *   GET  /api/products/:id    — product detail (~50ms, ~5% error)
 *   POST /api/orders          — place order (~320ms,   ~5% error)
 *   GET  /api/users/:id       — user profile (~70ms,   ~5% error)
 *
 * The ~5% error rate on non-health endpoints is intentional — it generates
 * realistic countError spikes in InfluxDB so the Grafana error panels
 * always have data to display during load tests.
 */
'use strict';

const express = require('express');

const app = express();
app.use(express.json());

// ── Structured console logger ─────────────────────────────────────────────────

function log(level, message, extra = {}) {
  console.log(JSON.stringify({
    level,
    message,
    service:   'sample-app',
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}

// ── Request logging middleware ────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';
    log(level, `${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method, path: req.path, status: res.statusCode, duration,
    });
  });
  next();
});

// ── Seed data ─────────────────────────────────────────────────────────────────

const products = [
  { id: 1, name: 'Widget Pro',  price: 29.99,  category: 'tools',       stock: 150 },
  { id: 2, name: 'Gadget Plus', price: 49.99,  category: 'electronics', stock: 75  },
  { id: 3, name: 'Super Tool',  price: 89.99,  category: 'tools',       stock: 30  },
  { id: 4, name: 'Mega Device', price: 199.99, category: 'electronics', stock: 10  },
  { id: 5, name: 'Ultra Pack',  price: 9.99,   category: 'accessories', stock: 500 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay  = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
const fail5  = () => Math.random() < 0.05;
const randId = () => Math.floor(Math.random() * 1_000_000);

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

app.get('/api/products', async (_req, res) => {
  await delay(80, 200);
  if (fail5()) return res.status(503).json({ error: 'Product catalog unavailable. Try again.' });
  res.json({ data: products, total: products.length });
});

app.get('/api/products/:id', async (req, res) => {
  await delay(20, 80);
  const product = products.find(p => p.id === parseInt(req.params.id, 10));
  if (!product) return res.status(404).json({ error: `Product ${req.params.id} not found` });
  if (fail5()) return res.status(503).json({ error: 'Product service temporarily unavailable.' });
  res.json({ data: product });
});

app.post('/api/orders', async (req, res) => {
  await delay(150, 500);
  if (fail5()) return res.status(500).json({ error: 'Payment gateway timeout. Order not placed.' });
  const order = {
    id:        randId(),
    productId: req.body.productId || 1,
    quantity:  req.body.quantity  || 1,
    total:     ((req.body.quantity || 1) * 29.99).toFixed(2),
    status:    'confirmed',
    createdAt: new Date().toISOString(),
  };
  res.status(201).json({ data: order });
});

app.get('/api/users/:id', async (req, res) => {
  await delay(30, 100);
  if (fail5()) return res.status(503).json({ error: 'User service degraded' });
  res.json({
    data: {
      id:        parseInt(req.params.id, 10),
      name:      `User #${req.params.id}`,
      email:     `user${req.params.id}@example.com`,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  log('info', `sample-app listening on port ${PORT}`);
});
