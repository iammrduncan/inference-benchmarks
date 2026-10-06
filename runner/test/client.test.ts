import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, parseProm, postJson, redactHeaders } from '../src/client.ts';
import { fakeServer, json } from './helpers.ts';

test('chat streams content, reasoning and tool-call deltas, with TTFT', async () => {
  const s = await fakeServer((_p, _b, _req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    ev({ model: 'm', choices: [{ delta: { reasoning_content: 'think ' } }] });
    ev({ choices: [{ delta: { content: 'Hello ' } }] });
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'set_', arguments: '{"sec' } }] } }] });
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'timer', arguments: 'onds": 60}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
    res.end('data: [DONE]\n\n');
  });
  try {
    const r = await chat(s.url, { stream: true, messages: [] });
    assert.equal(r.ok, true);
    assert.equal(r.content, 'Hello ');
    assert.equal(r.reasoning, 'think ');
    assert.deepEqual(r.tool_calls, [{ name: 'set_timer', arguments: { seconds: 60 } }]);
    assert.equal(r.finish_reason, 'tool_calls');
    assert.deepEqual(r.usage, { prompt_tokens: 5, completion_tokens: 7 });
    assert.equal(r.model, 'm');
    assert.ok(typeof r.ttft_ms === 'number' && r.ttft_ms <= r.latency_ms);
  } finally { await s.close(); }
});

test('chat falls back to a single JSON response and reports HTTP errors', async () => {
  let fail = false;
  const s = await fakeServer((_p, _b, _req, res) => fail
    ? json(res, 500, { error: { message: 'boom' } })
    : json(res, 200, { model: 'm', system_fingerprint: 'fp1', choices: [{ message: { content: 'hi', tool_calls: [{ function: { name: 'f', arguments: '{"a":1}' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
  try {
    const r = await chat(s.url, { stream: true, messages: [] });
    assert.equal(r.content, 'hi');
    assert.equal(r.system_fingerprint, 'fp1');
    assert.deepEqual(r.tool_calls, [{ name: 'f', arguments: { a: 1 } }]);
    fail = true;
    const e = await chat(s.url, { messages: [] });
    assert.equal(e.ok, false);
    assert.equal(e.status, 500);
    assert.match(e.error ?? '', /boom/);
  } finally { await s.close(); }
});

test('postJson captures the exchange without credentials and never retries', async () => {
  const s = await fakeServer((_p, _b, _req, res) => json(res, 503, { error: 'busy' }));
  try {
    const c = await postJson(`${s.url}/v1/systemone`, { a: 1 }, { authorization: 'Bearer SECRET-KEY' });
    assert.equal(c.ok, false);
    assert.equal(c.status, 503);
    assert.equal(s.requests.length, 1, 'no retry');
    assert.equal(s.requests[0]?.headers.authorization, 'Bearer SECRET-KEY', 'the key reaches the server');
    assert.ok(!JSON.stringify(c).includes('SECRET-KEY'), 'the key is not captured');
  } finally { await s.close(); }
  assert.deepEqual(redactHeaders({ Authorization: 'x', 'X-Api-Key': 'y', accept: 'z' }), { accept: 'z' });
});

test('parseProm reads counters with labels', () => {
  assert.deepEqual(parseProm('# HELP x\nx_total 3\ny{a="b"} 2.5\n'), { x_total: 3, 'y{a="b"}': 2.5 });
});
