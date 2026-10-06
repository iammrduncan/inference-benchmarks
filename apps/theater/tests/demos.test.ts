import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createDemoRuntime } from '../lib/runtime';
import { applyDecision, prepare } from '../lib/contracts';
import { homeWorkItem } from '../lib/theater/home';
import { localRequest, readInput } from '../lib/request';
test('Next request boundary rejects foreign origins, rebinding, duplicate JSON and oversized bodies', async () => {
  const make = (body = '{}', headers: Record<string, string> = {}) => new Request('http://127.0.0.1:3001/api/decide', { method: 'POST', body,
    headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001', 'content-type': 'application/json', ...headers } });
  assert.equal(localRequest(make(), true), true);
  assert.equal(localRequest(make('{}', { origin: 'https://evil.test' }), true), false);
  assert.equal(localRequest(make('{}', { host: 'evil.test' })), false);
  const tailnetHost = '100.127.125.114';
  const tailnet = make('{}', { host: `${tailnetHost}:3001`, origin: `http://${tailnetHost}:3001` });
  assert.equal(localRequest(tailnet, true, tailnetHost), true);
  assert.equal(localRequest(tailnet, true), false);
  const hostname = 'josephs-macbook-pro.taila9c138.ts.net';
  const dnsRequest = make('{}', { host: `${hostname}:3001`, origin: `http://${hostname}:3001` });
  assert.equal(localRequest(dnsRequest, true, tailnetHost, hostname), true);
  assert.equal(localRequest(dnsRequest, true, tailnetHost, ''), false);
  assert.equal(localRequest(make('{}', { host: `${hostname}:3001`, origin: 'https://evil.test' }), true, tailnetHost, hostname), false);
  assert.equal(localRequest(make('{}', { host: `evil.${hostname}:3001`, origin: `http://evil.${hostname}:3001` }), true, tailnetHost, hostname), false);
  assert.equal(localRequest(make('{}', { host: `${tailnetHost}:3001`, origin: 'https://evil.test' }), true, tailnetHost), false);
  assert.equal(localRequest(make('{}', { host: '100.64.0.2:3001', origin: 'http://100.64.0.2:3001' }), true, tailnetHost), false);
  assert.equal(localRequest(make('{}', { 'content-type': 'text/plain' }), true), false);
  assert.deepEqual(await readInput(make('{"id":"home"}')), { id: 'home' });
  await assert.rejects(readInput(make('{"a":1,"a":2}')));
  await assert.rejects(readInput(make(' '.repeat(16385))));
});
test('demo sessions continue past the former 80-call cutoff; aborted requests return no action', async () => {
  const demo = await createDemoRuntime({ stub: true });
  try {
    for (let i = 0; i < 110; i++) {
      assert.equal((await demo.run({ id: 'home', text: JSON.stringify(homeWorkItem(0).context) }, new AbortController().signal)).status, 200);
    }
    assert.equal(demo.config().calls, 110);
  } finally { await demo.close(); }
  const second = await createDemoRuntime({ stub: true });
  try {
    const response = await second.run({ id: 'home', text: JSON.stringify(homeWorkItem(0).context) }, AbortSignal.abort());
    assert.equal(response.status, 504);
    assert.equal(z.object({ error: z.string() }).parse(response.body).error, 'Request canceled. No action applied.');
    assert.equal(second.config().calls, 0);
  } finally { await second.close(); }
});

test('dispatch feed uses rich context and a single validated request per ticket', async () => {
  const { trafficTicket, fixtureDispatch, dispatchDecision, teams, priorities, actions } = await import('../lib/traffic');
  const demo = await createDemoRuntime({ stub: true });
  try {
    for (let offset = 0; offset < 24; offset += 3) {
      await Promise.all(Array.from({ length: 3 }, async (_, n) => {
        const ticket = trafficTicket(offset + n);
        const text = JSON.stringify(ticket);
        const request = prepare({ id: 'dispatch', text });
        assert.equal(request.route, '/v1/chat/completions');
        const messages = z.object({ messages: z.array(z.object({ content: z.string() })) }).parse(request.payload).messages;
        assert.deepEqual(JSON.parse(messages[0]?.content ?? '{}'), ticket);
        assert.equal(Object.hasOwn(ticket, 'expected'), false);
        const result = await demo.run({ id: 'dispatch', text }, new AbortController().signal);
        assert.equal(result.status, 200);
        const body = z.object({ decision: dispatchDecision, providerCalls: z.number() }).parse(result.body);
        const expected = fixtureDispatch(text);
        assert.ok(expected);
        assert.deepEqual(body.decision, { team: teams[expected[0]], priority: priorities[expected[1]], action: actions[expected[2]], escalate: expected[3] === 1 });
        assert.equal(body.providerCalls, 1);
      }));
    }
    assert.equal(demo.config().calls, 24);
    assert.equal((await demo.run({ id: 'dispatch', text: '{"message":"custom fixture"}' }, new AbortController().signal)).status, 400);
    assert.equal(demo.config().calls, 24);
    assert.throws(() => prepare({ id: 'dispatch', text: '{"message":"missing context"}' }));
    assert.throws(() => applyDecision({ id: 'dispatch', text: '' }, { team: 'billing', priority: 'critical', action: 'transfer_money', escalate: true }));
  } finally { await demo.close(); }
});
