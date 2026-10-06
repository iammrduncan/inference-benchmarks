import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, headers, proxyKey, noulRequest, completion, chatBody } from './test-support.js';
import { parseSystemOne, questionJob } from './contracts.js';
import { providerBody } from './cerebras.js';
import { estimatedCost, percentiles } from './metrics.js';
import type { ProviderMetric } from './metrics.js';

test('provider request has one leading system message and numeric-only strict schema', () => {
  const input = parseSystemOne(noulRequest, 'qwen-3.8-27b');
  const first = input.questions[0]; assert.ok(first);
  const body = providerBody(input.model, input.messages, questionJob(first.question));
  assert.equal(body.messages.filter(m => m.role === 'system').length, 1);
  assert.equal(body.messages[0]?.role, 'system');
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.properties.p.prefixItems, [{ type: 'number', minimum: 0, maximum: 1 }]);
});
test('null tool metadata is accepted, timing is numeric-only, and cannot escape publicly', async () => {
  const metrics: ProviderMetric[] = [];
  const h = await harness(() => ({ ...completion(),
    choices: [{ finish_reason: 'stop', message: { content: '{"p":[0.9]}', tool_calls: null, reasoning: 'SECRET_REASONING' } }],
    time_info: { queue_time: 0.001, prompt_time: 0.002, completion_time: 0.005, total_time: 0.008, secret: 'SECRET_TIMING' } }), { onMetric: m => metrics.push(m) });
  try {
    const response = await h.app.inject({ method: 'POST', url: '/v1/systemone', headers, payload: noulRequest });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(!response.body.includes('SECRET'));
    assert.ok(!JSON.stringify(metrics).includes('SECRET'));
    assert.equal(metrics[0]?.timing?.completion_time, 0.005);
    assert.equal(metrics[0]?.usage?.output_tokens, 10);
  } finally { await h.close(); }
});
test('queued deadline cancels pending jobs without sending them upstream', async () => {
  const h = await harness(async () => { await new Promise(resolve => setTimeout(resolve, 120)); return completion(); },
    { deadlineMs: 50, concurrency: 1, queueLimit: 4 });
  try {
    const request = h.app.inject({ method: 'POST', url: '/v1/systemone', headers, payload: { ...noulRequest,
      questions: { a: noulRequest.questions.refund, b: noulRequest.questions.refund, c: noulRequest.questions.refund } } });
    assert.equal((await request).statusCode, 504);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(h.received.length, 1);
  } finally { await h.close(); }
});
test('a fatal result cancels queued siblings and yields no partial success', async () => {
  const h = await harness(() => completion('{"p":[0.9],"reasoning":"SECRET"}'), { concurrency: 1 });
  try {
    const response = await h.app.inject({ method: 'POST', url: '/v1/systemone', headers, payload: { ...noulRequest,
      questions: { a: noulRequest.questions.refund, b: noulRequest.questions.refund } } });
    assert.equal(response.statusCode, 502);
    assert.ok(!response.body.includes('answers'));
    assert.equal(h.received.length, 1);
  } finally { await h.close(); }
});
test('disconnect aborts upstream work and frees its concurrency permit', async () => {
  let slow = true;
  const h = await harness(async () => { if (slow) await new Promise(resolve => setTimeout(resolve, 150)); return completion(); }, { concurrency: 1, queueLimit: 0 });
  try {
    const origin = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const pending = fetch(`${origin}/v1/systemone`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${proxyKey}` }, body: JSON.stringify(noulRequest), signal: abort.signal });
    const rejected = assert.rejects(pending);
    while (!h.received.length) await new Promise(resolve => setTimeout(resolve, 2));
    abort.abort(); await rejected;
    await new Promise(resolve => setTimeout(resolve, 15));
    slow = false;
    const next = await h.app.inject({ method: 'POST', url: '/v1/systemone', headers, payload: noulRequest });
    assert.equal(next.statusCode, 200, next.body);
  } finally { await h.close(); }
});
test('oversized upstream content and preflight prompt rejection never leak', async () => {
  const h = await harness(() => completion('SECRET'.repeat(50000)));
  try {
    const response = await h.app.inject({ method: 'POST', url: '/v1/systemone', headers, payload: noulRequest });
    assert.equal(response.statusCode, 502);
    assert.ok(!response.body.includes('SECRET'));
    const large = await h.app.inject({ method: 'POST', url: '/v1/chat/completions', headers,
      payload: { ...chatBody(), messages: [{ role: 'user', content: 'x'.repeat(50000) }] } });
    assert.equal(large.statusCode, 413);
    assert.equal(h.received.length, 1);
  } finally { await h.close(); }
});
test('cost and percentile math has known fixtures and handles empty results', () => {
  assert.equal(estimatedCost('qwen-3.8-27b', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 2.48);
  assert.deepEqual(percentiles([4, 1, 3, 2]), { p50: 2, p95: 4, p99: 4 });
  assert.deepEqual(percentiles([]), { p50: null, p95: null, p99: null });
});
