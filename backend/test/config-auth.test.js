const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createAuth } = require('../src/auth');
const { loadConfig } = require('../src/config');
const { createRateLimit } = require('../src/rate-limit');

const secret = 'test-only-secret-that-is-at-least-32-characters';
test('configuration errors name fields without disclosing secrets', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  const env = { DATABASE_URL: 'postgresql://localhost/test', REDIS_URL: 'redis://localhost', JWT_SECRET: secret };
  assert.equal(loadConfig(env).port, 3001);
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production' }), /ALLOWED_ORIGINS/);
  assert.throws(() => loadConfig({ ...env, ALLOWED_ORIGINS: '*' }), /ALLOWED_ORIGINS/);
  assert.throws(() => loadConfig({ ...env, PORT: 'no' }), /PORT/);
});

test('invalid, expired, visitor, and removed-agent credentials cannot authenticate as agents', async () => {
  const auth = createAuth({ query: async () => ({ rows: [] }) }, secret);
  await assert.rejects(auth.agent('invalid'), { code: 'UNAUTHORIZED' });
  await assert.rejects(auth.agent(auth.visitorToken(randomUUID())), { code: 'UNAUTHORIZED' });
  await assert.rejects(auth.agent(jwt.sign({ id: randomUUID() }, secret, { expiresIn: -1 })), { code: 'UNAUTHORIZED' });
  await assert.rejects(auth.agent(auth.agentToken({ id: randomUUID() })), { code: 'UNAUTHORIZED' });
});

test('rate limits recover after the window and cap the number of tracked identities', () => {
  let time = 0;
  const check = createRateLimit({ limit: 2, windowMs: 100, maxKeys: 2, now: () => time });
  check('a'); check('a');
  assert.throws(() => check('a'), { code: 'RATE_LIMITED' });
  check('b');
  assert.throws(() => check('c'), { code: 'RATE_LIMITED' });
  time = 101;
  check('c'); check('a');
});
