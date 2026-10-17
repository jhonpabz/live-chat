const test = require('node:test');
const assert = require('node:assert/strict');
const { Presence } = require('../src/presence');

test('availability tracks multiple agents, shared tab status, and last disconnect', () => {
  const presence = new Presence();
  const first = { role: 'agent', id: 'a' };
  const second = { role: 'agent', id: 'b' };
  assert.equal(presence.availability().online, false);
  presence.connect('a1', first);
  presence.connect('a2', first);
  assert.equal(presence.availability().online, true);
  assert.deepEqual(presence.setStatus('a', 'offline'), ['a1', 'a2']);
  assert.equal(presence.connect('a3', first), 'offline');
  assert.equal(presence.availability().online, false);
  presence.connect('b1', second);
  presence.disconnect('a1');
  assert.equal(presence.availability().online, true);
  presence.disconnect('b1');
  assert.equal(presence.availability().online, false);
  presence.setStatus('a', 'online');
  presence.disconnect('a2');
  assert.equal(presence.availability().online, true);
  assert.equal(presence.disconnect('a3').id, 'a');
  assert.equal(presence.availability().online, false);
});

test('one visitor tab disconnect does not mark another connected tab offline', () => {
  const presence = new Presence();
  const visitor = { role: 'visitor', id: 'visitor' };
  presence.connect('tab1', visitor);
  presence.connect('tab2', visitor);
  assert.equal(presence.disconnect('tab1'), null);
  assert.equal(presence.disconnect('tab2').id, 'visitor');
});
