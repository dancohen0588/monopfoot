require('dotenv').config();

const express = require('express');
const cors = require('cors');

const playersRouter = require('./routes/players');
const matchesRouter = require('./routes/matches');
const kpisRouter = require('./routes/kpis');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 60 * 1000;

function cleanupIdempotencyStore() {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
}

function idempotencyMiddleware(req, res, next) {
  if (req.method !== 'POST') {
    return next();
  }

  if (req.baseUrl === '/api/players' && req.path !== '/') {
    return next();
  }

  if (req.baseUrl === '/api/matches' && req.path !== '/') {
    return next();
  }

  const idempotencyKey = req.header('X-Idempotency-Key');
  if (!idempotencyKey) {
    return next();
  }

  cleanupIdempotencyStore();
  const existing = idempotencyStore.get(idempotencyKey);
  if (existing) {
    res.status(existing.statusCode).set(existing.headers).send(existing.body);
    return undefined;
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    idempotencyStore.set(idempotencyKey, {
      timestamp: Date.now(),
      statusCode: res.statusCode,
      headers: { 'Content-Type': 'application/json' },
      body
    });
    return originalJson(body);
  };
  return next();
}

app.use('/api/players', idempotencyMiddleware, playersRouter);
app.use('/api/matches', idempotencyMiddleware, matchesRouter);
app.use('/api/kpis', kpisRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { message: 'Route introuvable.' }
  });
});

app.use((err, req, res, next) => {
  res.status(500).json({
    success: false,
    error: { message: 'Erreur serveur.', details: err.message }
  });
});

app.listen(PORT, () => {
  console.log(`API Monop'Foot démarrée sur http://localhost:${PORT}`);
});
