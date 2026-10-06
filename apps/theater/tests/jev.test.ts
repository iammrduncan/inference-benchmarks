import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { jevPlan, decodeJev, requestJev } from '../lib/jev';
import { createDemoRuntime } from '../lib/runtime';
import { workItem, type SceneId } from '../lib/theater/data';
import { DrivingEngine } from '../lib/theater/driving';
import { requestTotals } from '../lib/theater/workload';
import { contractSnapshot, readNativeContract } from '../lib/theater/contract-view';
import { z } from 'zod';

function input(scene: SceneId) {
  const context = scene === 'navigate' ? { position: 20, target: 4, visited: [20] }
    : scene === 'drive' ? new DrivingEngine().state : workItem(scene, 0).context;
  return { id: scene, model: 'jev-latest' as const, text: JSON.stringify(context) };
}
const requestSchema = z.object({ model: z.literal('jev-latest'), state: z.unknown(),
  questions: z.record(z.string(), z.object({ type: z.enum(['choice', 'noul']), instructions: z.string(),
    criteria: z.record(z.string(), z.string().nullable()).optional() })) });
function responseFor(body: unknown) {
  const { questions } = requestSchema.parse(body);
  return { model: 'jev-1.13.0', usage: { input_tokens: 120, output_tokens: 40 },
    answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      const choices = Object.keys(q.criteria ?? {});
      return [id, q.type === 'noul' ? { type: 'noul', noul: 0.8 } : { type: 'choice', choice: choices[0], confidence: 1,
        probabilities: Object.fromEntries(choices.map((key, i) => [key, i === 0 ? 1 : 0])) }];
    })) };
}

test('all seven scenes use one native Jev call and preserve native answers, usage, revision and contract', async () => {
  const upstream = Fastify({ forceCloseConnections: true }); let calls = 0;
  upstream.post('/v1/systemone', request => {
    calls++; assert.equal(request.headers.authorization, 'Bearer synthetic-jev-secret');
    const body = requestSchema.parse(request.body);
    assert.equal(Object.hasOwn(body, 'messages'), false);
    assert.ok(Object.values(body.questions).every(q => q.instructions.length > 0));
    return responseFor(body);
  });
  const origin = await upstream.listen({ host: '127.0.0.1', port: 0 });
  const runtime = await createDemoRuntime({ jevApiKey: 'synthetic-jev-secret', jevEndpoint: `${origin}/v1/systemone` });
  try {
    assert.equal(runtime.config().model, 'jev-latest');
    assert.deepEqual(runtime.config().availableModels, ['jev-latest']);
    assert.ok(!JSON.stringify(runtime.config()).includes('synthetic-jev-secret'));
    for (const scene of ['dispatch', 'navigate', 'drive', 'screen', 'approve', 'judge', 'home'] satisfies SceneId[]) {
      const result = await runtime.run(input(scene), new AbortController().signal);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const body = z.object({ model: z.literal('jev-latest'), providerModel: z.literal('jev-1.13.0'),
        providerCalls: z.literal(1), estimatedCostUsd: z.literal(0.0000048), usage: z.object({ input_tokens: z.literal(120) }),
        nativeAnswers: z.record(z.string(), z.unknown()), contract: requestSchema, decision: z.record(z.string(), z.unknown()) }).parse(result.body);
      assert.deepEqual(body.contract, jevPlan(input(scene)).payload);
      assert.equal(Object.keys(body.nativeAnswers).length, Object.keys(body.contract.questions).length);
      if (scene === 'judge') { assert.equal(body.decision.accuracy, 100); assert.equal(Object.keys(body.nativeAnswers).length, 5); }
      assert.ok(!JSON.stringify(result).includes('synthetic-jev-secret'));
    }
    assert.equal(calls, 7);
    assert.equal((await runtime.run({ ...input('screen'), model: 'qwen-3.8-27b' }, new AbortController().signal)).status, 503);
    assert.equal(calls, 7);
  } finally { await runtime.close(); await upstream.close(); }
});

test('Jev rejects malformed answer sets and distributions rather than repairing them', () => {
  const plan = jevPlan(input('screen'));
  const good = responseFor(plan.payload);
  assert.equal(decodeJev(plan, good).result.decision, 'allow');
  for (const answers of [
    {}, { ...good.answers, extra: { type: 'noul', noul: 1 } },
    { decision: { type: 'noul', noul: 1 } },
    ...[
      { allow: 1 }, { allow: 1, block: 0, extra: 0 }, { allow: -1, block: 2 },
      { allow: 0.1, block: 0.9 }, { allow: 0.2, block: 0.2 }, { allow: NaN, block: 0 },
    ].map(probabilities => ({ decision: { type: 'choice', choice: 'allow', confidence: 1, probabilities } })),
    { decision: { type: 'choice', choice: 'execute', confidence: 1, probabilities: { allow: 1, block: 0 } } },
  ]) assert.throws(() => decodeJev(plan, { ...good, answers }));
  assert.throws(() => decodeJev(plan, { ...good, usage: { input_tokens: -1, output_tokens: 4 } }));
});

test('Noul ties are false and rubric scoring sums thresholded weights, preserving probabilities', () => {
  const plan = jevPlan(input('judge')); const good = responseFor(plan.payload);
  const answers = { accuracy_0: { type: 'noul', noul: 0.51 }, accuracy_1: { type: 'noul', noul: 0.5 },
    accuracy_2: { type: 'noul', noul: 0.9 }, accuracy_3: { type: 'noul', noul: 0.1 }, valid: { type: 'noul', noul: 0.5 } };
  const decoded = decodeJev(plan, { ...good, answers });
  assert.deepEqual(decoded.result, { accuracy: 40, valid: false });
  assert.deepEqual(decoded.native.answers, answers);
  assert.throws(() => decodeJev(plan, { ...good, answers: { ...answers, valid: { type: 'noul', noul: 1.1 } } }));
});

test('Jev HTTP errors are sanitized, no retries occur, and deadlines release runtime admission', async () => {
  const upstream = Fastify({ forceCloseConnections: true }); let calls = 0; let status = 429;
  upstream.post('/', async (_request, reply) => {
    calls++;
    if (status === 200) { await new Promise(resolve => setTimeout(resolve, 40)); return 'not-json SECRET'; }
    return reply.code(status).send({ error: 'SECRET' });
  });
  const endpoint = await upstream.listen({ host: '127.0.0.1', port: 0 });
  const runtime = await createDemoRuntime({ jevApiKey: 'SECRET', jevEndpoint: endpoint });
  try {
    for (const [up, expected] of [[429, 429], [529, 529], [503, 529], [401, 502], [422, 502], [200, 502]]) {
      assert.ok(up && expected); status = up;
      const result = await runtime.run(input('screen'), new AbortController().signal);
      assert.equal(result.status, expected); assert.ok(!JSON.stringify(result).includes('SECRET'));
      if (up === 401) {
        const body = z.object({ code: z.string(), error: z.string() }).parse(result.body);
        assert.equal(body.code, 'provider_authentication_failed');
        assert.match(body.error, /Jev rejected its API key/);
        assert.match(body.error, /restart the demo server/);
        assert.ok(!JSON.stringify(result.body).includes('"decision"'));
      }
    }
    assert.equal(calls, 6);
    await assert.rejects(requestJev(jevPlan(input('screen')), 'SECRET', AbortSignal.timeout(5), endpoint), { code: 'deadline_exceeded' });
    const before = calls;
    assert.equal((await runtime.run(input('screen'), AbortSignal.abort())).status, 504);
    assert.equal(calls, before);
    const requests = Array.from({ length: 5 }, () => runtime.run(input('screen'), AbortSignal.timeout(5)));
    assert.equal((await runtime.run(input('screen'), new AbortController().signal)).status, 429);
    assert.ok((await Promise.all(requests)).every(r => r.status === 504));
    status = 429;
    const next = await runtime.run(input('screen'), new AbortController().signal);
    assert.equal(next.status, 429);
    assert.ok(JSON.stringify(next.body).includes('rate_limited'));
  } finally { await runtime.close(); await upstream.close(); }
});

test('native contract previews use real question payloads and unknown pricing is not free', () => {
  const i = input('home');
  const snapshot = contractSnapshot({ scene: 'home', model: 'jev-latest', context: JSON.parse(i.text) });
  assert.deepEqual(snapshot.request, jevPlan(i).payload);
  assert.equal(Object.keys(readNativeContract(snapshot.request)?.questions ?? {}).length, 7);
  const totals = requestTotals([{ data: { usage: { input_tokens: 10, output_tokens: 2 }, estimatedCostUsd: null } }]);
  assert.equal(totals.measuredRequests, 1); assert.equal(totals.unpricedRequests, 1);
  assert.equal(totals.pricedRequests, 0); assert.equal(totals.averageCostUsd, null);
});
