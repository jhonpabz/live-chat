import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function moduleUrl(file, replacements = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  for (const [from, to] of Object.entries(replacements)) outputText = outputText.replace(from, to);
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const contracts = moduleUrl('../src/lib/contracts.ts');
const { createTypingSession } = await import(moduleUrl('../src/features/chat/typingSession.ts', { "'../../lib/contracts'": JSON.stringify(contracts) }));

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const socket = new EventEmitter();
  socket.connected = true;
  const sent = [];
  socket.volatile = { emit: (event, data) => sent.push({ event, ...data }) };
  let active = false;
  const session = createTypingSession(socket, 'chat-one', false, value => { active = value; });
  t.after(session.dispose);
  return { socket, sent, session, active: () => active };
}

test('typing updates are throttled, stop immediately, and expire after idle', t => {
  const { session, sent } = setup(t);
  session.update(true);
  session.update(true);
  assert.equal(sent.length, 1);
  t.mock.timers.tick(1000);
  session.update(true);
  assert.equal(sent.length, 2);
  session.update(false);
  assert.equal(sent.at(-1).isTyping, false);
  t.mock.timers.tick(1000);
  session.update(true);
  t.mock.timers.tick(1500);
  assert.equal(sent.at(-1).isTyping, false);
});

test('remote typing ignores other conversations and own side, and expires without a stop event', t => {
  const { socket, active } = setup(t);
  socket.emit('typing', { conversationId: 'other', isTyping: true, isAgent: true });
  socket.emit('typing', { conversationId: 'chat-one', isTyping: true, isAgent: false });
  assert.equal(active(), false);
  socket.emit('typing', { conversationId: 'chat-one', isTyping: true, isAgent: true });
  assert.equal(active(), true);
  t.mock.timers.tick(4000);
  assert.equal(active(), false);
});

test('messages and disconnect clear indicators; disconnected typing is never queued', t => {
  const { socket, active, session, sent } = setup(t);
  const incoming = { conversationId: 'chat-one', isTyping: true, isAgent: true };
  socket.emit('typing', incoming);
  socket.emit('new_message', { conversation_id: 'chat-one', sender_type: 'agent' });
  assert.equal(active(), false);
  socket.emit('typing', incoming);
  socket.connected = false;
  socket.emit('disconnect');
  assert.equal(active(), false);
  session.update(true);
  assert.equal(sent.length, 0);
});

test('conversation cleanup stops local typing and removes listeners and timers', t => {
  const { socket, session, sent, active } = setup(t);
  session.update(true);
  session.dispose();
  assert.equal(sent.at(-1).isTyping, false);
  assert.equal(socket.eventNames().length, 0);
  socket.emit('typing', { conversationId: 'chat-one', isTyping: true, isAgent: true });
  t.mock.timers.tick(5000);
  assert.equal(active(), false);
  assert.equal(sent.length, 2);
});
