import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createDemoRuntime } from '../lib/runtime';
import { homeCases, homeDecision, homeInput, homeWorkItem, initialHome, applyHome } from '../lib/theater/home';
import { theaterPlan, theaterDecision } from '../lib/theater/contracts';
import { shuffledWorkload } from '../lib/theater/workload';
import { passesThreshold } from '../lib/theater/judge';

test('judge validity threshold uses a strict comparison, independently of model completeness', () => {
  const answers = [{ accuracy: 80, valid: true }, { accuracy: 90, valid: true }, { accuracy: 91, valid: false }, { accuracy: 100, valid: true }];
  assert.deepEqual(answers.filter(a => passesThreshold(a.accuracy, 90)).map(a => a.accuracy), [91, 100]);
  assert.equal(answers.filter(a => passesThreshold(a.accuracy, 80)).length, 3);
  assert.equal(answers.filter(a => passesThreshold(a.accuracy, 100)).length, 0);
  assert.equal(passesThreshold(0, 0), false);
  assert.equal(passesThreshold(1, 0), true);
  assert.equal(passesThreshold(NaN, 90), false);
  assert.equal(passesThreshold(Infinity, 90), false);
  assert.equal(answers[2]?.valid, false);
});

test('home command sequence traverses real proxy and retains each prior device state', async () => {
  const runtime = await createDemoRuntime({ stub: true });
  try {
    let state = { ...initialHome };
    let applied = 0, clarified = 0;
    const workload = shuffledWorkload('home', () => 0.37);
    assert.equal(workload.length, 24);
    assert.equal(new Set(workload.map(item => item.id)).size, 24);
    for (const item of workload) {
      const context = { ...homeInput.parse(item.context), state: { ...state } };
      const expected = homeCases.find(example => example.command === context.command)?.expected;
      assert.ok(expected);
      assert.equal(Object.hasOwn(context, 'expected'), false);
      const before = { ...state };
      const response = await runtime.run({ id: 'home', text: JSON.stringify(context) }, new AbortController().signal);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const body = z.object({ decision: homeDecision, providerCalls: z.number(), contract: z.object({ messages: z.array(z.object({ content: z.string() })) }) }).parse(response.body);
      assert.equal(body.providerCalls, 1);
      assert.deepEqual(body.decision, expected);
      assert.deepEqual(JSON.parse(body.contract.messages[0]?.content ?? '{}').state, before);
      state = applyHome(state, body.decision);
      if (expected.action === 'clarify') { clarified++; assert.deepEqual(state, before); }
      else applied++;
    }
    assert.equal(applied, 20); assert.equal(clarified, 4);
    assert.equal(runtime.config().calls, 24);
    for (const id of ['triage', 'courier', 'guardrail']) {
      assert.equal((await runtime.run({ id, text: 'Retired lab' }, new AbortController().signal)).status, 400);
    }
    assert.equal(runtime.config().calls, 24);
  } finally { await runtime.close(); }
});

test('home boundaries reject unbounded actions and clarification never mutates devices', () => {
  const valid = homeCases[0]?.expected;
  assert.ok(valid);
  for (const invalid of [
    { ...valid, temperature: 99 }, { ...valid, temperature: 20.5 },
    { ...valid, kitchen: 'execute' }, { ...valid, reason: 'prose' },
    { ...valid, action: 'unlock' }, { action: 'apply' },
  ]) {
    assert.throws(() => theaterDecision('home', '{}', invalid));
    assert.throws(() => applyHome(initialHome, invalid));
  }
  assert.deepEqual(applyHome(initialHome, { ...valid, action: 'clarify', temperature: 26, blinds: 'closed' }), initialHome);
  assert.deepEqual(applyHome(initialHome, valid), { ...initialHome, kitchen: 'bright' });
  assert.equal(initialHome.kitchen, 'off');
  assert.throws(() => theaterPlan('home', JSON.stringify({ ...homeWorkItem(0).context, state: { ...initialHome, temperature: 99 } })));
});
