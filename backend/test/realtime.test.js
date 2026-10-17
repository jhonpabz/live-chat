const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { Server } = require('socket.io');
// Exercise the actual client version shipped by the frontend; install both packages.
const { io: client } = createRequire(require.resolve('../../frontend/package.json'))('socket.io-client');
const { createAuth } = require('../src/auth');
const { createChatService } = require('../src/chat.service');
const { createApp } = require('../src/app');
const { registerRealtime } = require('../src/realtime');
const { memoryRepository } = require('./helpers/memory-repository');

test('real HTTP/socket flow: authentication, own echoes, retries, reconnect history, and safe failures', { timeout: 20000 }, async t => {
  const repository = memoryRepository();
  const chat = createChatService(repository);
  const agentId = randomUUID();
  const pool = { query: async (_sql, values) => ({ rows: values?.[0] === agentId ? [{ id: agentId }] : [] }) };
  const auth = createAuth(pool, 'test-only-secret-with-at-least-32-characters');
  const redisClient = { isReady: false };
  let app;
  const server = http.createServer((req, res) => app(req, res));
  const io = new Server(server);
  app = createApp({ pool, redisClient, auth, chat, io, origins: ['http://localhost:5173'] });
  const stop = registerRealtime({ io, auth, chat, redisClient });
  const clients = [];
  t.after(async () => {
    for (const socket of clients) socket.disconnect();
    stop();
    await new Promise(resolve => io.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const connect = async credentials => {
    const socket = client(url, { transports: ['websocket'], auth: credentials, reconnection: false });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  };
  const acknowledge = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
  const event = (socket, name) => new Promise(resolve => socket.once(name, resolve));

  const denied = await fetch(`${url}/api/conversations`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'UNAUTHORIZED');
  const invalid = client(url, { transports: ['websocket'], auth: { token: 'bad' }, reconnection: false });
  clients.push(invalid);
  const rejected = await event(invalid, 'connect_error');
  assert.equal(rejected.data.code, 'UNAUTHORIZED');

  const visitor = await connect({});
  const ready = await acknowledge(visitor, 'visitor_join', { visitorId: 'spoofed', conversationId: randomUUID() });
  assert.equal(ready.ok, true);
  const conversationId = ready.data.conversationId;
  const supportOnline = event(visitor, 'support_availability');
  const agent = await connect({ token: auth.agentToken({ id: agentId }) });
  assert.equal((await supportOnline).online, true);

  const ownEcho = event(agent, 'new_message');
  const visitorEcho = event(visitor, 'new_message');
  const payload = { conversationId, clientMessageId: randomUUID(), content: 'agent reply', senderType: 'visitor' };
  const saved = await acknowledge(agent, 'send_message', payload);
  assert.equal(saved.ok, true);
  assert.equal(saved.data.sender_type, 'agent');
  assert.equal((await ownEcho).id, saved.data.id);
  assert.equal((await visitorEcho).id, saved.data.id);
  const retry = await acknowledge(agent, 'send_message', payload);
  assert.equal(retry.data.id, saved.data.id);
  assert.equal(repository.messages.length, 1);

  const stranger = await connect({});
  await acknowledge(stranger, 'visitor_join', {});
  const crossRead = await acknowledge(stranger, 'message_history', { conversationId });
  const crossSend = await acknowledge(stranger, 'send_message', { ...payload, clientMessageId: randomUUID() });
  assert.equal(crossRead.error.code, 'NOT_FOUND');
  assert.equal(crossSend.error.code, 'NOT_FOUND');

  visitor.disconnect();
  const secondMessage = await acknowledge(agent, 'send_message', { ...payload, clientMessageId: randomUUID(), content: 'sent while disconnected' });
  const returning = await connect({ visitorToken: ready.data.visitorToken });
  const joined = await acknowledge(returning, 'visitor_join', {});
  assert.equal(joined.data.conversationId, conversationId);
  const recovered = await acknowledge(returning, 'message_history', { conversationId, after: saved.data.id });
  assert.equal(recovered.data.messages[0].id, secondMessage.data.id);

  const originalError = console.error;
  console.error = () => {};
  try {
    repository.failWrites = true;
    const failed = await acknowledge(agent, 'send_message', { ...payload, clientMessageId: randomUUID() });
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, 'INTERNAL_ERROR');
    assert.equal(repository.messages.length, 2);
    assert.ok(!failed.error.message.includes('storage'));
  } finally { console.error = originalError; repository.failWrites = false; }

  const offline = event(returning, 'support_availability');
  await acknowledge(agent, 'agent_status', 'offline');
  assert.equal((await offline).online, false);
  const resolvedEvent = event(returning, 'conversation_resolved');
  const resolved = await fetch(`${url}/api/conversations/${conversationId}/resolve`, { method: 'POST', headers: { Authorization: `Bearer ${auth.agentToken({ id: agentId })}` } });
  assert.equal(resolved.status, 200);
  assert.equal((await resolvedEvent).id, conversationId);
});
