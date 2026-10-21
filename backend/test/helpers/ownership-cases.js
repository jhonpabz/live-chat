const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { Server } = require('socket.io');
const { io: client } = createRequire(require.resolve('../../../frontend/package.json'))('socket.io-client');
const { createAuth } = require('../../src/auth');
const { createAccountsRepository } = require('../../src/accounts.repository');
const { createAccountsService } = require('../../src/accounts.service');
const { createChatRepository } = require('../../src/chat.repository');
const { createChatService } = require('../../src/chat.service');
const { createChatEvents } = require('../../src/chat.events');
const { createApp } = require('../../src/app');
const { registerRealtime } = require('../../src/realtime');
const { Presence } = require('../../src/presence');

async function ownershipCases(t, pool) {
  const auth = createAuth(pool, 'isolated-ownership-test-secret-at-least-32-characters');
  const accounts = createAccountsService(createAccountsRepository(pool), auth);
  const presence = new Presence();
  const chat = createChatService(createChatRepository(pool), presence);
  const password = 'A-test-password-123!';
  let bootstrap, admin, adminToken;

  await t.test('bootstrap is one-time under concurrency, invitation tokens are hashed and single use', async () => {
    const results = await Promise.allSettled([
      accounts.bootstrap({ name: 'Owner', email: ' Owner@Example.com ' }),
      accounts.bootstrap({ name: 'Other owner', email: 'other-owner@example.com' })
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    bootstrap = results.find(r => r.status === 'fulfilled').value;
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ALREADY_PROVISIONED');
    const stored = (await pool.query('SELECT * FROM agents WHERE id = $1', [bootstrap.agent.id])).rows[0];
    assert.notEqual(stored.setup_token_hash, bootstrap.setupToken);
    assert.equal(stored.setup_token_hash.length, 64);
    const reissued = await accounts.reissueBootstrap(bootstrap.agent.email);
    await assert.rejects(accounts.completeSetup({ token: bootstrap.setupToken, password }), { code: 'INVALID_SETUP_TOKEN' });
    bootstrap.setupToken = reissued.setupToken;
    await assert.rejects(accounts.login({ email: bootstrap.agent.email, password }), { code: 'INVALID_CREDENTIALS' });
    await assert.rejects(accounts.completeSetup({ token: bootstrap.setupToken, password: 'short' }), { code: 'INVALID_INPUT' });
    const setups = await Promise.allSettled([accounts.completeSetup({ token: bootstrap.setupToken, password }), accounts.completeSetup({ token: bootstrap.setupToken, password })]);
    assert.equal(setups.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(setups.find(r => r.status === 'rejected').reason.code, 'INVALID_SETUP_TOKEN');
    const login = await accounts.login({ email: bootstrap.agent.email.toUpperCase(), password });
    adminToken = login.token;
    admin = await auth.agent(login.token);
    assert.equal(admin.role, 'super_admin');
    await assert.rejects(accounts.reissueBootstrap(bootstrap.agent.email), { code: 'SETUP_CLOSED' });
  });

  async function agentAccount(email, capacity = 2) {
    const invitation = await accounts.create(admin, { name: email, email, capacity });
    await accounts.completeSetup({ token: invitation.setupToken, password });
    const login = await accounts.login({ email, password });
    return { ...login, identity: await auth.agent(login.token) };
  }
  const first = await agentAccount('first@example.com');
  const second = await agentAccount('second@example.com');
  let app;
  const server = http.createServer((req, res) => app(req, res));
  const io = new Server(server);
  const events = createChatEvents(io, auth, chat);
  const redisClient = { isReady: false };
  app = createApp({ pool, redisClient, auth, chat, accounts, events, origins: ['http://localhost:5173'] });
  const stop = registerRealtime({ io, auth, chat, redisClient, presence, events });
  const clients = [];
  t.after(async () => { for (const socket of clients) socket.disconnect(); stop(); await new Promise(resolve => io.close(resolve)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token, method = 'GET', body) => fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const connect = async (credentials = {}) => {
    const socket = client(base, { transports: ['websocket'], auth: credentials, reconnection: false });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  };
  const ack = (socket, event, payload) => socket.timeout(3000).emitWithAck(event, payload);
  async function visitor() {
    const socket = await connect();
    const ready = await ack(socket, 'visitor_join', {});
    assert.equal(ready.ok, true);
    return { socket, id: ready.data.conversationId, identity: auth.visitor(ready.data.visitorToken) };
  }
  const firstSocket = await connect({ token: first.token });
  const firstTab = await connect({ token: first.token });
  const secondSocket = await connect({ token: second.token });
  const adminSocket = await connect({ token: adminToken });

  await t.test('ordinary agents cannot manage accounts or elevate roles through HTTP', async () => {
    assert.equal((await request('/api/agents')).status, 401);
    for (const [url, method, body] of [
      ['/api/agents', 'GET'], ['/api/agents', 'POST', { name: 'Bad', email: 'bad@example.com' }],
      [`/api/agents/${second.agent.id}`, 'PATCH', { name: 'Bad', email: 'bad@example.com', role: 'super_admin' }],
      [`/api/agents/${second.agent.id}/status`, 'POST', { active: false }],
      [`/api/agents/${second.agent.id}/reset-password`, 'POST']
    ]) assert.equal((await request(url, first.token, method, body)).status, 403);
    assert.equal((await request('/api/agents', adminToken, 'POST', { name: 'Bad', email: 'bad@example.com', role: 'super_admin' })).status, 400);
    assert.equal((await request(`/api/agents/${admin.id}/status`, adminToken, 'POST', { active: false })).status, 404);
    await assert.rejects(accounts.create(admin, { name: 'Duplicate', email: 'FIRST@EXAMPLE.COM' }), { code: 'EMAIL_EXISTS' });
    const page = await (await request('/api/agents?limit=1', adminToken)).json();
    assert.equal(page.agents.length, 1);
    assert.equal(page.hasMore, true);
    assert.ok(!('password_hash' in page.agents[0]));
    assert.ok(!('setup_token_hash' in page.agents[0]));
  });

  const waiting = await visitor();
  await t.test('queue metadata is redacted, history and sending require ownership, supervisors have oversight', async () => {
    await ack(waiting.socket, 'send_message', { conversationId: waiting.id, content: 'Private waiting content', clientMessageId: randomUUID() });
    const queue = await (await request('/api/conversations?view=queue', first.token)).json();
    const row = queue.conversations.find(c => c.id === waiting.id);
    assert.equal(row.last_message, null); assert.equal(row.ip_address, null); assert.equal(row.location, null);
    assert.equal((await request(`/api/conversations/${waiting.id}/messages`, first.token)).status, 404);
    assert.equal((await request('/api/conversations?view=all', first.token)).status, 403);
    assert.equal((await ack(firstSocket, 'message_history', { conversationId: waiting.id })).error.code, 'NOT_FOUND');
    assert.equal((await ack(firstSocket, 'send_message', { conversationId: waiting.id, content: 'unauthorized', clientMessageId: randomUUID() })).error.code, 'NOT_FOUND');
    const oversight = await (await request(`/api/conversations/${waiting.id}/messages`, adminToken)).json();
    assert.equal(oversight.messages[0].content, 'Private waiting content');
  });

  let owner, stranger, ownerSocket, strangerSocket;
  await t.test('simultaneous HTTP claims have exactly one owner', async () => {
    const results = await Promise.all([request(`/api/conversations/${waiting.id}/accept`, first.token, 'POST'), request(`/api/conversations/${waiting.id}/accept`, second.token, 'POST')]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    owner = results[0].status === 200 ? first : second;
    stranger = owner === first ? second : first;
    ownerSocket = owner === first ? firstSocket : secondSocket;
    strangerSocket = owner === first ? secondSocket : firstSocket;
    const row = (await pool.query('SELECT agent_id FROM conversations WHERE id = $1', [waiting.id])).rows[0];
    assert.equal(row.agent_id, owner.agent.id);
    assert.equal((await request(`/api/conversations/${waiting.id}/accept`, owner.token, 'POST')).status, 200);
    assert.equal((await request(`/api/conversations/${waiting.id}/messages`, stranger.token)).status, 404);
    assert.equal((await request(`/api/conversations/${waiting.id}/resolve`, stranger.token, 'POST')).status, 404);
  });

  await t.test('messages and typing events do not leak to another agent, including multiple tabs', async () => {
    const ownerTab = await connect({ token: owner.token });
    const leaked = [];
    for (const tab of clients.filter(s => s.auth.token === stranger.token)) {
      tab.on('new_message', message => leaked.push(message));
      tab.on('typing', payload => leaked.push(payload));
    }
    const ownerMessage = once(ownerSocket, 'new_message');
    const tabMessage = once(ownerTab, 'new_message');
    const oversightMessage = once(adminSocket, 'new_message');
    const saved = await ack(waiting.socket, 'send_message', { conversationId: waiting.id, content: 'Only the owner and supervisor', clientMessageId: randomUUID() });
    assert.equal(saved.ok, true);
    assert.equal((await ownerMessage)[0].id, saved.data.id);
    assert.equal((await tabMessage)[0].id, saved.data.id);
    assert.equal((await oversightMessage)[0].id, saved.data.id);
    assert.equal((await ack(strangerSocket, 'send_message', { conversationId: waiting.id, content: 'blocked', clientMessageId: randomUUID() })).error.code, 'NOT_FOUND');
    assert.equal((await ack(strangerSocket, 'typing', { conversationId: waiting.id, isTyping: true })).error.code, 'NOT_FOUND');
    const ownerTyping = once(ownerSocket, 'typing');
    await ack(waiting.socket, 'typing', { conversationId: waiting.id, isTyping: true });
    await ownerTyping;
    // Round trip after delivery gives this socket a deterministic ordering barrier.
    await ack(strangerSocket, 'visitor_presence', { visitorIds: [waiting.identity.id] });
    assert.equal(leaked.length, 0);
    const presenceSnapshot = await ack(strangerSocket, 'visitor_presence', { visitorIds: [waiting.identity.id] });
    assert.deepEqual(presenceSnapshot.data.onlineVisitorIds, []);
    const history = await ack(ownerSocket, 'message_history', { conversationId: waiting.id });
    assert.equal(history.data.messages.at(-1).id, saved.data.id);
  });

  await t.test('capacity supports multiple chats and serializes competing accepts across tabs', async () => {
    const a = await visitor(); const b = await visitor();
    const results = await Promise.allSettled([chat.accept(owner.identity, a.id), chat.accept(owner.identity, b.id)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'AT_CAPACITY');
    assert.equal((await accounts.me(owner.identity)).active_chats, 2);
    await assert.rejects(accounts.edit(admin, owner.agent.id, { name: 'Owner', email: owner.agent.email, capacity: 1 }), { code: 'CAPACITY_IN_USE' });
    await chat.resolve(owner.identity, waiting.id);
    const remaining = results[0].status === 'rejected' ? a : b;
    await chat.accept(owner.identity, remaining.id);
    assert.equal((await accounts.me(owner.identity)).active_chats, 2);
  });

  await t.test('offline and disconnected agents cannot accept, existing owned work can continue offline', async () => {
    const queued = await visitor();
    await ack(strangerSocket, 'agent_status', 'offline');
    await assert.rejects(chat.accept(stranger.identity, queued.id), { code: 'AGENT_OFFLINE' });
    await ack(strangerSocket, 'agent_status', 'online');
    await chat.accept(stranger.identity, queued.id);
    await ack(strangerSocket, 'agent_status', 'offline');
    assert.equal((await ack(strangerSocket, 'send_message', { conversationId: queued.id, content: 'Finishing assigned work', clientMessageId: randomUUID() })).ok, true);
    await chat.resolve(stranger.identity, queued.id);
    const detached = await agentAccount('detached@example.com');
    await assert.rejects(chat.accept(detached.identity, (await visitor()).id), { code: 'AGENT_OFFLINE' });
  });

  await t.test('deactivation revokes all tabs and HTTP tokens, requeues open chats, and retains historical attribution', async () => {
    const ownTabs = clients.filter(s => s.connected && s.auth.token === owner.token);
    const disconnected = ownTabs.map(s => once(s, 'disconnect'));
    const response = await request(`/api/agents/${owner.agent.id}/status`, adminToken, 'POST', { active: false });
    assert.equal(response.status, 200);
    await Promise.all(disconnected);
    await assert.rejects(auth.agent(owner.token), { code: 'UNAUTHORIZED' });
    assert.equal((await request('/api/conversations', owner.token)).status, 401);
    assert.equal(presence.isOnline(owner.agent.id), false);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM conversations WHERE agent_id = $1 AND status = 'open'", [owner.agent.id])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT agent_id FROM conversations WHERE id = $1', [waiting.id])).rows[0].agent_id, owner.agent.id);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM conversation_assignments WHERE agent_id = $1 AND action = 'deactivated'", [owner.agent.id])).rows[0].count, 2);
    await assert.rejects(chat.accept(owner.identity, (await visitor()).id), { code: 'UNAUTHORIZED' });
    await request(`/api/agents/${owner.agent.id}/status`, adminToken, 'POST', { active: true });
    await assert.rejects(auth.agent(owner.token), { code: 'UNAUTHORIZED' });
    assert.ok((await accounts.login({ email: owner.agent.email, password })).token);
  });

  await t.test('password reset invalidates sessions and older links, expires, and cannot reactivate disabled accounts', async () => {
    const resetResponse = await request(`/api/agents/${stranger.agent.id}/reset-password`, adminToken, 'POST');
    assert.equal(resetResponse.status, 200);
    const reset = await resetResponse.json();
    await assert.rejects(auth.agent(stranger.token), { code: 'UNAUTHORIZED' });
    await assert.rejects(accounts.login({ email: stranger.agent.email, password }), { code: 'INVALID_CREDENTIALS' });
    const replacement = await accounts.reset(admin, stranger.agent.id);
    await assert.rejects(accounts.completeSetup({ token: reset.setupToken, password }), { code: 'INVALID_SETUP_TOKEN' });
    await pool.query("UPDATE agents SET setup_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [stranger.agent.id]);
    await assert.rejects(accounts.completeSetup({ token: replacement.setupToken, password }), { code: 'INVALID_SETUP_TOKEN' });
    const fresh = await accounts.reset(admin, stranger.agent.id);
    await accounts.setActive(admin, stranger.agent.id, { active: false });
    await assert.rejects(accounts.completeSetup({ token: fresh.setupToken, password }), { code: 'INVALID_SETUP_TOKEN' });
    await accounts.setActive(admin, stranger.agent.id, { active: true });
    const response = await request('/api/auth/set-password', null, 'POST', { token: fresh.setupToken, password: 'Different-test-password-123!' });
    assert.equal(response.status, 200);
    await assert.rejects(accounts.login({ email: stranger.agent.email, password }), { code: 'INVALID_CREDENTIALS' });
    assert.ok((await accounts.login({ email: stranger.agent.email, password: 'Different-test-password-123!' })).token);
  });

  await t.test('deactivation racing acceptance never leaves an open chat assigned to a disabled agent', async () => {
    const racing = await agentAccount('racing@example.com');
    await connect({ token: racing.token });
    const queued = await visitor();
    const [claim, disabled] = await Promise.all([
      request(`/api/conversations/${queued.id}/accept`, racing.token, 'POST'),
      request(`/api/agents/${racing.agent.id}/status`, adminToken, 'POST', { active: false })
    ]);
    assert.ok([200, 401].includes(claim.status));
    assert.equal(disabled.status, 200);
    assert.equal((await pool.query('SELECT agent_id FROM conversations WHERE id = $1', [queued.id])).rows[0].agent_id, null);
    assert.equal((await request(`/api/conversations/${queued.id}/messages`, racing.token)).status, 401);
  });
}
module.exports = { ownershipCases };
