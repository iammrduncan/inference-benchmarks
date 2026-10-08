import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJsonReachable, type Captured } from '../src/client.ts';

const reply = (over: Partial<Captured>): Captured => ({ ok: false, status: 0, latency_ms: 1, request: { url: 'u', body: {} }, ...over });

test('connection failures are retried and every attempt is recorded', async () => {
  const seq = [reply({ transport: true, error: 'fetch failed (ECONNREFUSED)' }), reply({ transport: true, error: 'fetch failed (ECONNRESET)' }), reply({ ok: true, status: 200, response: {} })];
  let calls = 0;
  const c = await postJsonReachable('u', {}, {}, [0, 0, 0], async () => seq[calls++] ?? reply({}));
  assert.equal(calls, 3);
  assert.equal(c.ok, true);
  assert.deepEqual(c.transport_failures, ['fetch failed (ECONNREFUSED)', 'fetch failed (ECONNRESET)']);
});

test('HTTP errors and timeouts are final: never retried', async () => {
  let calls = 0;
  const http = await postJsonReachable('u', {}, {}, [0, 0], async () => { calls++; return reply({ status: 500, error: 'engine_error' }); });
  assert.equal(calls, 1);
  assert.equal(http.transport_failures, undefined);
  calls = 0;
  await postJsonReachable('u', {}, {}, [0, 0], async () => { calls++; return reply({ error: 'The operation was aborted due to timeout' }); });
  assert.equal(calls, 1, 'a timeout may have reached the model, so it is not retried');
});

test('the retry budget ends: the last failure is returned with the earlier ones', async () => {
  let calls = 0;
  const c = await postJsonReachable('u', {}, {}, [0, 0], async () => { calls++; return reply({ transport: true, error: `down ${calls}` }); });
  assert.equal(calls, 3);
  assert.equal(c.ok, false);
  assert.equal(c.error, 'down 3');
  assert.deepEqual(c.transport_failures, ['down 1', 'down 2']);
});
