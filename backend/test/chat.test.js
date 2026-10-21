const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createChatService } = require('../src/chat.service');
const { createChatRepository } = require('../src/chat.repository');
const { memoryRepository } = require('./helpers/memory-repository');

async function fixture() {
  const repository = memoryRepository();
  const chat = createChatService(repository);
  const joined = await chat.joinVisitor(null, '127.0.0.1');
  const visitor = { role: 'visitor', id: joined.visitorId };
  const payload = { conversationId: joined.conversationId, clientMessageId: randomUUID(), content: 'hello' };
  const admin = { id: randomUUID(), role: 'super_admin', version: 0 };
  repository.agents.set(admin.id, { ...admin, is_active: true, session_version: 0 });
  return { repository, chat, visitor, payload, admin };
}

test('visitor ownership is required for history, sends, and room authorization', async () => {
  const { chat, payload } = await fixture();
  const stranger = { role: 'visitor', id: randomUUID() };
  await assert.rejects(chat.history(stranger, payload.conversationId, {}), { code: 'NOT_FOUND' });
  await assert.rejects(chat.send(stranger, payload), { code: 'NOT_FOUND' });
  await assert.rejects(chat.authorize(stranger, payload.conversationId), { code: 'NOT_FOUND' });
  await assert.rejects(chat.send(null, payload), { code: 'UNAUTHORIZED' });
});

test('sender identity and text type come from server context, not payload', async () => {
  const { chat, repository, visitor, payload } = await fixture();
  const result = await chat.send(visitor, { ...payload, senderType: 'agent', senderId: 'someone-else', messageType: 'image' });
  assert.equal(result.message.sender_type, 'visitor');
  assert.equal(repository.messages[0].sender_id, visitor.id);
});

test('concurrent retries save one message and one knowledge reply', async () => {
  const { chat, repository, visitor, payload } = await fixture();
  payload.content = 'help';
  const [first, retry] = await Promise.all([chat.send(visitor, payload), chat.send(visitor, payload)]);
  assert.equal(first.message.id, retry.message.id);
  assert.equal(repository.messages.length, 2);
  await assert.rejects(chat.send(visitor, { ...payload, content: 'changed' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('failed transaction does not report saved messages', async () => {
  const { chat, repository, visitor, payload } = await fixture();
  repository.failWrites = true;
  await assert.rejects(chat.send(visitor, payload), /storage failure/);
  assert.equal(repository.messages.length, 0);
  repository.failWrites = false;
  assert.equal((await chat.send(visitor, payload)).message.content, 'hello');
});

test('resolved chats reject new sends but still confirm already saved retries', async () => {
  const { chat, visitor, payload, admin } = await fixture();
  const saved = await chat.send(visitor, payload);
  await assert.rejects(chat.resolve(visitor, payload.conversationId), { code: 'FORBIDDEN' });
  await chat.resolve(admin, payload.conversationId);
  assert.equal((await chat.send(visitor, payload)).message.id, saved.message.id);
  await assert.rejects(chat.send(visitor, { ...payload, clientMessageId: randomUUID() }), { code: 'CONVERSATION_RESOLVED' });
});

test('rejoining reuses an open conversation and creates one after resolution', async () => {
  const { chat, visitor, payload, admin } = await fixture();
  const [first, second] = await Promise.all([chat.joinVisitor(visitor), chat.joinVisitor(visitor)]);
  assert.equal(first.conversationId, payload.conversationId);
  assert.equal(second.conversationId, first.conversationId);
  await chat.resolve(admin, first.conversationId);
  assert.notEqual((await chat.joinVisitor(visitor)).conversationId, first.conversationId);
});

test('history is bounded, supports reconnect cursors, and rejects unrelated cursors', async () => {
  const { chat, visitor, payload } = await fixture();
  const first = await chat.send(visitor, payload);
  const second = await chat.send(visitor, { ...payload, clientMessageId: randomUUID(), content: 'second' });
  const latest = await chat.history(visitor, payload.conversationId, { limit: 1 });
  assert.equal(latest.hasMore, true);
  assert.equal(latest.messages[0].id, second.message.id);
  assert.equal((await chat.history(visitor, payload.conversationId, { after: first.message.id })).messages[0].id, second.message.id);
  await assert.rejects(chat.history(visitor, payload.conversationId, { after: randomUUID() }), { code: 'INVALID_CURSOR' });
  await assert.rejects(chat.history(visitor, payload.conversationId, { limit: 10000 }), { code: 'INVALID_INPUT' });
});

test('repository rolls back and releases its client after persistence failure', async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); }, release: () => calls.push('release') };
  const repository = createChatRepository({ connect: async () => client });
  await assert.rejects(repository.transaction(async () => { throw new Error('failed'); }), /failed/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'release']);
});
