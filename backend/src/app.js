const express = require('express');
const cors = require('cors');
const { AppError, publicError, logError } = require('./errors');
const { page } = require('./validation');
const { createRateLimit } = require('./rate-limit');

function createApp({ pool, redisClient, auth, chat, accounts, events, origins }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '16kb' }));
  const requestLimit = createRateLimit({ limit: 300, windowMs: 60000 });
  const loginLimit = createRateLimit({ limit: 20, windowMs: 15 * 60000 });
  const route = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
  app.use('/api', (req, _res, next) => {
    _res.set('Cache-Control', 'no-store');
    try { requestLimit(req.ip); next(); } catch (error) { next(error); }
  });
  const protectedRoute = handler => route(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHORIZED', 'Agent authentication required.');
    req.identity = await auth.agent(header.slice(7));
    return handler(req, res);
  });

  app.post('/api/auth/login', route(async (req, res) => {
    loginLimit(req.ip);
    res.set('Cache-Control', 'no-store').json(await accounts.login(req.body));
  }));
  app.post('/api/auth/set-password', route(async (req, res) => {
    loginLimit(req.ip);
    const id = await accounts.completeSetup(req.body);
    events.revoke(id);
    res.set('Cache-Control', 'no-store').json({ success: true });
  }));
  app.get('/api/auth/me', protectedRoute(async (req, res) => res.json(await accounts.me(req.identity))));
  app.get('/api/agents', protectedRoute(async (req, res) => res.json(await accounts.list(req.identity, req.query))));
  app.post('/api/agents', protectedRoute(async (req, res) => {
    res.status(201).set('Cache-Control', 'no-store').json(await accounts.create(req.identity, req.body));
  }));
  app.patch('/api/agents/:id', protectedRoute(async (req, res) => res.json(await accounts.edit(req.identity, req.params.id, req.body))));
  app.post('/api/agents/:id/status', protectedRoute(async (req, res) => {
    const agent = await accounts.setActive(req.identity, req.params.id, req.body);
    events.revoke(agent.id);
    events.changed();
    res.json(agent);
  }));
  app.post('/api/agents/:id/reset-password', protectedRoute(async (req, res) => {
    const result = await accounts.reset(req.identity, req.params.id);
    events.revoke(req.params.id);
    res.set('Cache-Control', 'no-store').json(result);
  }));

  app.get('/api/conversations', protectedRoute(async (req, res) => res.json(await chat.list(req.identity, req.query))));
  app.post('/api/conversations/:id/accept', protectedRoute(async (req, res) => {
    const result = await chat.accept(req.identity, req.params.id);
    events.changed();
    res.json(result);
  }));
  app.get('/api/conversations/:id/messages', protectedRoute(async (req, res) => res.json(await chat.history(req.identity, req.params.id, req.query))));
  app.post('/api/conversations/:id/resolve', protectedRoute(async (req, res) => {
    await chat.resolve(req.identity, req.params.id);
    await events.publish(req.params.id, 'conversation_resolved', { id: req.params.id });
    events.changed();
    res.json({ success: true });
  }));
  app.get('/api/quick-replies', protectedRoute(async (req, res) => {
    const { limit } = page(req.query);
    const result = await pool.query('SELECT id, title, content FROM quick_replies ORDER BY title, id LIMIT $1', [limit]);
    res.json(result.rows);
  }));
  app.get('/api/settings', route(async (_req, res) => {
    const result = await pool.query("SELECT key, COALESCE(value, '') AS value FROM settings WHERE key = ANY($1)", [['welcome_message', 'announcement', 'announcement_enabled']]);
    res.json(Object.fromEntries(result.rows.map(row => [row.key, row.value])));
  }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', route(async (_req, res) => {
    await pool.query('SELECT 1');
    const redisReady = redisClient.isReady;
    res.status(redisReady ? 200 : 503).json({ status: redisReady ? 'ready' : 'degraded', database: true, redis: redisReady });
  }));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') error = new AppError(400, 'INVALID_JSON', 'Invalid JSON body.');
    if (error.type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    if (!(error instanceof AppError)) logError(error);
    res.status(error.status || 500).json({ error: publicError(error) });
  });
  return app;
}

module.exports = { createApp };
