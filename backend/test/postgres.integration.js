const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createChatRepository } = require('../src/chat.repository');
const { createChatService } = require('../src/chat.service');

test('isolated PostgreSQL: migration, concurrent retries, transaction rollback, ownership, and history cursors', { timeout: 20000 }, async t => {
  const connectionString = process.env.LIVECHAT_ISOLATED_DATABASE_URL;
  assert.ok(connectionString && /^\/livechat_test_[0-9a-f]{16}$/.test(new URL(connectionString).pathname), 'Run through npm run test:postgres to create a disposable test database.');
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, options: '-c timezone=UTC' });
  t.after(() => pool.end());
  await pool.query(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8'));
  const migration = readFileSync(join(__dirname, '..', 'migrations', '001_message_idempotency.sql'), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  const repository = createChatRepository(pool);
  const chat = createChatService(repository);
  const joined = await chat.joinVisitor(null, '127.0.0.1');
  const visitor = { role: 'visitor', id: joined.visitorId };
  const payload = { conversationId: joined.conversationId, clientMessageId: randomUUID(), content: 'help' };
  await pool.query("INSERT INTO knowledge_base (keyword, response) VALUES ('help', 'Reply')");
  const [first, retry] = await Promise.all([chat.send(visitor, payload), chat.send(visitor, payload)]);
  assert.equal(first.message.id, retry.message.id);
  assert.equal((await pool.query('SELECT COUNT(*) FROM messages')).rows[0].count, '2');
  const stranger = { role: 'visitor', id: randomUUID() };
  await assert.rejects(chat.history(stranger, payload.conversationId, {}), { code: 'NOT_FOUND' });
  await assert.rejects(chat.send(stranger, payload), { code: 'NOT_FOUND' });

  const history = await chat.history(visitor, payload.conversationId, { limit: 1 });
  assert.equal(history.hasMore, true);
  const older = await chat.history(visitor, payload.conversationId, { before: history.messages[0].id });
  assert.equal(older.messages[0].id, first.message.id);
  const missed = await chat.history(visitor, payload.conversationId, { after: first.message.id });
  assert.equal(missed.messages[0].sender_type, 'system');

  // Inject a failure after message insertion, using the real transaction path.
  const failing = createChatService({ ...repository, touch: async () => { throw new Error('simulated failure'); } });
  await assert.rejects(failing.send(visitor, { ...payload, clientMessageId: randomUUID(), content: 'rollback' }), /simulated failure/);
  assert.equal((await pool.query('SELECT COUNT(*) FROM messages')).rows[0].count, '2');

  // Equal timestamps still paginate deterministically by UUID.
  await pool.query("UPDATE messages SET created_at = '2026-01-01 00:00:00.123456'");
  const tied = await chat.history(visitor, payload.conversationId, { limit: 1 });
  const tiedOlder = await chat.history(visitor, payload.conversationId, { before: tied.messages[0].id, limit: 1 });
  assert.notEqual(tied.messages[0].id, tiedOlder.messages[0].id);
  assert.equal(tiedOlder.hasMore, false);
  const agent = await pool.query("INSERT INTO agents (name, email, password_hash) VALUES ('Test', 'test@example.com', 'unused') RETURNING id");
  await chat.resolve({ role: 'agent', id: agent.rows[0].id }, payload.conversationId);
  assert.equal((await chat.send(visitor, payload)).message.id, first.message.id);
  await assert.rejects(chat.send(visitor, { ...payload, clientMessageId: randomUUID() }), { code: 'CONVERSATION_RESOLVED' });
});
