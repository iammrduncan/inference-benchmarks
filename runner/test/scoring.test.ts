import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapMean, percentile, wilson } from '../src/stats.ts';
import { argmax, ece, predict, scoreDecisions, type Decision, type GoldAnswer } from '../src/suites/typed-decisions.ts';
import { invariantFailures, summarizeConformance } from '../src/suites/decision-conformance.ts';
import type { RawRow } from '../src/suite.ts';

test('Wilson interval matches a known value and handles the edges', () => {
  const w = wilson(50, 100);
  assert.ok(Math.abs(w.low - 0.4038) < 1e-4 && Math.abs(w.high - 0.5962) < 1e-4);
  assert.equal(wilson(0, 0).n, 0);
  assert.ok(wilson(0, 10).low === 0 && wilson(10, 10).high === 1);
});

test('bootstrap is seeded, so summaries are reproducible', () => {
  const xs = Array.from({ length: 50 }, (_, i) => (i * 7) % 13);
  assert.deepEqual(bootstrapMean(xs), bootstrapMean(xs));
  assert.equal(percentile([5, 1, 3], 50), 3);
});

const choice: GoldAnswer = { type: 'choice', label: 'b', probabilities: { a: 0.2, b: 0.8 } };
const noul: GoldAnswer = { type: 'noul', label: 'true', probabilities: { false: 0.3, true: 0.7 } };

test('answers become distributions over the gold options, or are rejected with a reason', () => {
  assert.deepEqual(predict({ type: 'noul', noul: 0.6 }, noul), { ok: true, dist: { false: 0.4, true: 0.6 } });
  assert.equal(predict({ type: 'noul', noul: 1.2 }, noul).ok, false);
  assert.equal(predict({ probabilities: { a: 0.5, c: 0.5 } }, choice).ok, false, 'unknown option');
  assert.equal(predict({ probabilities: { a: 0.5, b: 0.6 } }, choice).ok, false, 'sums to 1.1');
  const drift = predict({ probabilities: { a: 0.5, b: 0.505 } }, choice);
  assert.ok(drift.ok && Math.abs((drift.dist.a ?? 0) + (drift.dist.b ?? 0) - 1) < 1e-12, 'small drift is renormalized');
});

test('ties go to the first option in the gold order', () => {
  assert.equal(argmax({ a: 0.5, b: 0.5 }, ['a', 'b']), 'a');
  assert.equal(argmax({ a: 0.5, b: 0.5 }, ['b', 'a']), 'b');
});

test('accuracy, KL from gold, Brier and ECE use the suite definitions', () => {
  const d = (gold: GoldAnswer, dist: Record<string, number>): Decision => ({ workflow: 'w', question: 'q', type: gold.type, gold, pred: { ok: true, dist } });
  const m = scoreDecisions([
    d(choice, { a: 0.2, b: 0.8 }),                     // perfect: KL 0, Brier 0, correct
    d(choice, { a: 0.6, b: 0.4 }),                     // wrong
    { workflow: 'w', question: 'q', type: 'choice', gold: choice, pred: { ok: false, reason: 'x' } }, // invalid: wrong, excluded from KL/Brier
  ]);
  assert.equal(m.decisions, 3);
  assert.equal(m.valid, 2);
  assert.ok(Math.abs(m.accuracy.value - 1 / 3) < 1e-6);
  const kl2 = 0.2 * Math.log(0.2 / 0.6) + 0.8 * Math.log(0.8 / 0.4);
  assert.ok(Math.abs((m.kl_from_gold?.value ?? 0) - kl2 / 2) < 1e-6);
  assert.ok(Math.abs((m.brier?.value ?? 0) - (0.4 ** 2 + 0.4 ** 2) / 2) < 1e-6);
  assert.ok(Math.abs(ece([[0.9, 1], [0.9, 0]]) - 0.4) < 1e-12);
});

test('conformance invariants catch shape errors', () => {
  const q = { type: 'choice' as const, instructions: 'x', criteria: { a: 'A', b: 'B' } };
  assert.deepEqual(invariantFailures(q, { type: 'choice', choice: 'b', probabilities: { a: 0.3, b: 0.7 }, confidence: 0.4 }), []);
  assert.match(invariantFailures(q, { type: 'choice', choice: 'a', probabilities: { a: 0.3, b: 0.7 }, confidence: 0.4 }).join(), /argmax/);
  const s = { type: 'score' as const, instructions: 'x', criteria: ['lo', 'mid', 'hi'] };
  assert.match(invariantFailures(s, { type: 'score', score: 0.2, probabilities: { 0: 0, 1: 0, 2: 1 } }).join(), /weighted mean/);
  assert.match(invariantFailures({ type: 'noul', instructions: 'x', criteria: {} }, { type: 'noul', noul: 2 }).join(), /noul/);
});

test('a failed request fails its invariants instead of being skipped', () => {
  const q = { type: 'noul' as const, instructions: 'x', criteria: {} };
  const row: RawRow = { index: 0, item_id: 'monotonic:x:0', ok: false, status: 500, latency_ms: 1, request: { url: '', body: {} }, cost_usd: 0, expected: { kind: 'monotonic', probe: 'x', index: 0, questions: { q } } };
  const m = summarizeConformance([row]).metrics as { checks: { invariants: { passed: number; total: number } } };
  assert.deepEqual([m.checks.invariants.passed, m.checks.invariants.total], [0, 1]);
});

test('tolerances are inclusive at the boundary (regression: Jev rounds to 2 decimals)', () => {
  // Observed from jev-1.13.0 on 2026-10-06: probabilities summing to 0.99, and score 0.07 where the mean is 0.06.
  const g: GoldAnswer = { type: 'choice', label: 'success', probabilities: { partial: 0.1, success: 0.8, harmful: 0.05, failure: 0.05 } };
  assert.equal(predict({ probabilities: { partial: 0.16, success: 0.81, harmful: 0, failure: 0.02 } }, g).ok, true);
  const s = { type: 'score' as const, instructions: 'x', criteria: ['a', 'b', 'c', 'd'] };
  assert.deepEqual(invariantFailures(s, { type: 'score', score: 0.07, confidence: 0.93, probabilities: { 0: 0.98, 1: 0, 2: 0, 3: 0.02 } }), []);
  assert.match(invariantFailures(s, { type: 'score', score: 0.08, confidence: 0.93, probabilities: { 0: 0.98, 1: 0, 2: 0, 3: 0.02 } }).join(), /weighted mean/);
});
