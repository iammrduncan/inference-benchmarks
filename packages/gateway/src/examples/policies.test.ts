import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './policies.js';
const c = (choice: string, confidence = 1) => ({ type: 'choice', choice, confidence });
const n = (noul: number) => ({ type: 'noul', noul });
const s = (score: number) => ({ type: 'score', score });
test('smart home never acts on irrelevant speculative fields', () => {
  const base = { compound: n(0), intent: c('command'), scope: c('all'), device: c('lights'), action: c('off') };
  assert.deepEqual(decide('E2', { answers: base }), { action: 'simulated_lights', kitchen: 'off', hall: 'off' });
  assert.deepEqual(decide('E2', { answers: { ...base, intent: c('conversation') } }), { action: 'conversation_stub' });
  assert.deepEqual(decide('E2', { answers: { ...base, compound: n(1) } }), { action: 'decomposition_stub' });
  assert.deepEqual(decide('E2', { answers: { ...base, device: c('heating') } }), { action: 'clarify' });
  assert.deepEqual(decide('E2', { answers: { ...base, action: c('off', 0.2) } }), { action: 'clarify' });
});
test('guardrail thresholds and malformed judgments fail safely', () => {
  const judgments = { override: n(0), secret_request: n(0), format_attack: n(0), forced_values: n(0), severity: s(0) };
  assert.deepEqual(decide('E5', { answers: judgments }), { action: 'pass' });
  assert.deepEqual(decide('E5', { answers: { ...judgments, override: n(0.4) } }), { action: 'review' });
  assert.deepEqual(decide('E5', { answers: { ...judgments, override: n(0.8) } }), { action: 'block' });
  assert.throws(() => decide('E5', { answers: {} }));
});
test('function dispatcher cannot execute an unknown generated function', () => {
  assert.throws(() => decide('E4', { action: 'eval', series: 'A', window: 'day', volume: false }));
  assert.deepEqual(decide('E4', { action: 'chart', series: 'B', window: 'week', volume: true }),
    { action: 'chart_preview', series: 'B', window: 'week', volume: true, samples: [20, 18, 21, 22] });
});
