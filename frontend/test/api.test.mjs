import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Use the existing TypeScript compiler and Node runner, without another test framework.
function moduleUrl(file, replacements = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  for (const [from, to] of Object.entries(replacements)) outputText = outputText.replace(from, to);
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const contracts = moduleUrl('../src/lib/contracts.ts');
const { api } = await import(moduleUrl('../src/lib/api.ts', { "'./contracts'": JSON.stringify(contracts) }));
const isSuccess = value => value?.success === true;

test('API returns valid data and preserves request headers', async t => {
  t.mock.method(globalThis, 'fetch', async (_path, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer test-token');
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    return Response.json({ success: true });
  });
  assert.deepEqual(await api('/api/example', isSuccess, 'test-token', { method: 'POST', body: '{}' }), { success: true });
});

test('API preserves structured server errors for invalid setup links', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'INVALID_SETUP_TOKEN', message: 'This setup link is invalid or expired.' } }, { status: 400 }));
  await assert.rejects(api('/api/auth/set-password', isSuccess), { code: 'INVALID_SETUP_TOKEN', message: 'This setup link is invalid or expired.' });
});

for (const [label, body, status, code] of [
  ['empty proxy response', '', 500, 'SERVER_UNAVAILABLE'],
  ['HTML gateway error', '<html>Bad gateway</html>', 502, 'SERVER_UNAVAILABLE'],
  ['plain-text rate limit', 'Too many requests', 429, 'RATE_LIMITED'],
  ['malformed successful response', '{', 200, 'INVALID_RESPONSE'],
  ['wrong response shape', '{}', 200, 'INVALID_RESPONSE']
]) {
  test(`API handles ${label} without exposing a JSON parsing error`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
    await assert.rejects(api('/api/auth/set-password', isSuccess), error => {
      assert.equal(error.code, code);
      assert.ok(!/JSON|Unexpected|<html>/i.test(error.message));
      return true;
    });
  });
}

test('API reports network failures clearly', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api('/api/example', isSuccess), { code: 'SERVER_UNAVAILABLE' });
});

test('API preserves caller cancellation', async t => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async () => { throw controller.signal.reason; });
  await assert.rejects(api('/api/example', isSuccess, undefined, { signal: controller.signal }), { name: 'AbortError' });
});
