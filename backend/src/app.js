const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { AppError, publicError, logError } = require('./errors');
const { object, text, page } = require('./validation');
const { createRateLimit } = require('./rate-limit');

function createApp({ pool, redisClient, auth, chat, io, origins }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '16kb' }));
  const requestLimit = createRateLimit({ limit: 300, windowMs: 60000 });
  const loginLimit = createRateLimit({ limit: 20, windowMs: 15 * 60000 });
  const route = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
  app.use('/api', (req, _res, next) => {
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
    const input = object(req.body);
    const email = text(input.email, 'email', 255).trim();
    const password = text(input.password, 'password', 200);
    const result = await pool.query('SELECT id, name, email, password_hash FROM agents WHERE email = $1', [email]);
    const agent = result.rows[0];
    const valid = await bcrypt.compare(password, agent?.password_hash || '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    if (!agent || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    res.json({ token: auth.agentToken(agent), agent: { id: agent.id, name: agent.name, email: agent.email } });
  }));

  app.get('/api/conversations', protectedRoute(async (req, res) => res.json(await chat.list(req.query))));
  app.get('/api/conversations/:id/messages', protectedRoute(async (req, res) => res.json(await chat.history(req.identity, req.params.id, req.query))));
  app.post('/api/conversations/:id/resolve', protectedRoute(async (req, res) => {
    await chat.resolve(req.identity, req.params.id);
    io.to(`conversation:${req.params.id}`).to('agents').emit('conversation_resolved', { id: req.params.id });
    io.to('agents').emit('conversation_update', { conversationId: req.params.id });
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
