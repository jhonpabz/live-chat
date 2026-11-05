import express, { type Request, type Response, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';
import type { Auth } from './auth';
import type { ChatService } from './chat.service';
import type { AccountsService } from './accounts.service';
import type { ChatEvents } from './chat.events';
import type { StaffIdentity } from './types';
type HttpRequest = Request<Record<string, string>, unknown, unknown>;
type Handler = (req: HttpRequest, res: Response) => unknown;
type ProtectedHandler = (req: HttpRequest, res: Response, identity: StaffIdentity) => unknown;
import cors from 'cors';
import { AppError, publicError, logError } from './errors';
import { page } from './validation';
import { createRateLimit } from './rate-limit';

function createApp({ pool, redisClient, auth, chat, accounts, events, origins }: { pool: Pool; redisClient: { isReady: boolean }; auth: Auth; chat: ChatService; accounts: AccountsService; events: ChatEvents; origins: string[] }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '16kb' }));
  const requestLimit = createRateLimit({ limit: 300, windowMs: 60000 });
  const loginLimit = createRateLimit({ limit: 20, windowMs: 15 * 60000 });
  const route = (handler: Handler): RequestHandler<Record<string, string>, unknown, unknown> => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
  app.use('/api', (req, _res, next) => {
    _res.set('Cache-Control', 'no-store');
    try { requestLimit(req.ip); next(); } catch (error) { next(error); }
  });
  const protectedRoute = (handler: ProtectedHandler) => route(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHORIZED', 'Agent authentication required.');
    const identity = await auth.agent(header.slice(7));
    return handler(req, res, identity);
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
  app.get('/api/auth/me', protectedRoute(async (req, res, identity) => res.json(await accounts.me(identity))));
  app.get('/api/agents', protectedRoute(async (req, res, identity) => res.json(await accounts.list(identity, req.query))));
  app.post('/api/agents', protectedRoute(async (req, res, identity) => {
    res.status(201).set('Cache-Control', 'no-store').json(await accounts.create(identity, req.body));
  }));
  app.patch('/api/agents/:id', protectedRoute(async (req, res, identity) => res.json(await accounts.edit(identity, req.params.id, req.body))));
  app.post('/api/agents/:id/status', protectedRoute(async (req, res, identity) => {
    const agent = await accounts.setActive(identity, req.params.id, req.body);
    events.revoke(agent.id);
    events.changed();
    res.json(agent);
  }));
  app.post('/api/agents/:id/reset-password', protectedRoute(async (req, res, identity) => {
    const result = await accounts.reset(identity, req.params.id);
    events.revoke(req.params.id);
    res.set('Cache-Control', 'no-store').json(result);
  }));

  app.get('/api/conversations', protectedRoute(async (req, res, identity) => res.json(await chat.list(identity, req.query))));
  app.post('/api/conversations/:id/accept', protectedRoute(async (req, res, identity) => {
    const result = await chat.accept(identity, req.params.id);
    events.changed();
    res.json(result);
  }));
  app.get('/api/conversations/:id/messages', protectedRoute(async (req, res, identity) => res.json(await chat.history(identity, req.params.id, req.query))));
  app.post('/api/conversations/:id/resolve', protectedRoute(async (req, res, identity) => {
    await chat.resolve(identity, req.params.id);
    await events.publish(req.params.id, 'conversation_resolved', { id: req.params.id });
    events.changed();
    res.json({ success: true });
  }));
  app.get('/api/quick-replies', protectedRoute(async (req, res, identity) => {
    const { limit } = page(req.query);
    const result = await pool.query('SELECT id, title, content FROM quick_replies ORDER BY title, id LIMIT $1', [limit]);
    res.json(result.rows);
  }));
  app.get('/api/settings', route(async (_req, res) => {
    const result = await pool.query<{ key: string; value: string }>("SELECT key, COALESCE(value, '') AS value FROM settings WHERE key = ANY($1)", [['welcome_message', 'announcement', 'announcement_enabled']]);
    res.json(Object.fromEntries(result.rows.map(row => [row.key, row.value])));
  }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', route(async (_req, res) => {
    await pool.query('SELECT 1');
    const redisReady = redisClient.isReady;
    res.status(redisReady ? 200 : 503).json({ status: redisReady ? 'ready' : 'degraded', database: true, redis: redisReady });
  }));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));
  const errorHandler: ErrorRequestHandler = (caught: unknown, _req, res, _next) => {
    let error = caught;
    const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
    if (type === 'entity.parse.failed') error = new AppError(400, 'INVALID_JSON', 'Invalid JSON body.');
    if (type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    if (!(error instanceof AppError)) logError(error);
    res.status(error instanceof AppError ? error.status : 500).json({ error: publicError(error) });
  };
  app.use(errorHandler);
  return app;
}

export { createApp };
