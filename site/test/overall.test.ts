import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardPerSuite, headline, overall } from '../scripts/overall.ts';
import type { Board, Run } from '../lib/types.ts';

const iv = (value: number) => ({ value, low: value - 0.02, high: value + 0.02, n: 100 });

function decisions(subject: string, accuracy: number, tier = 'quick', mode = 'native'): Run {
  return {
    kind: 'decisions', id: `${subject}/typed-decisions/${tier}-${mode}`, run_id: 'r', subject, suite: 'typed-decisions', tier, profile: 'p', mode,
    status: 'complete', label: null, started_at: '2026-10-06T00:00:00Z', finished_at: '2026-10-06T00:01:00Z',
    items: { planned: 1, attempted: 1, succeeded: 1, failed: 0 }, harness: { commit: 'c', dirty: false, scorer: 's', suite_hash: 'h' },
    latency_ms: { p50: 150, p95: 200, p99: 250 }, usage: null, hardware: null, recipe: null, endpoint: null, files: [], notes: [], reproduce: '',
    metrics: { decisions: 1, valid: 1, accuracy: iv(accuracy), kl_from_gold: iv(1), brier: iv(0.1), ece: 0.01, accuracy_by_type: {}, accuracy_by_workflow: {} },
    invalid_reasons: {},
  };
}
const board = (id: string, suite: string, tier: string, runs: Run[]): Board =>
  ({ id, suite, tier, profile: 'p', metric: 'accuracy', rows: runs.map((r, i) => ({ run: r.id, rank: { low: i + 1, high: i + 1 } })) });

test('the index is a share of the best score in each category; missing categories are absent, not zero', () => {
  const a = decisions('a', 0.8);
  const b = decisions('b', 0.6);
  const decision = overall([a, b], [board('typed-decisions/quick/p', 'typed-decisions', 'quick', [a, b])], () => 'decisions').find((g) => g.id === 'decision');
  const { buckets, rows } = decision ?? { buckets: [], rows: [] };
  assert.deepEqual(buckets.find((x) => x.id === 'typed')?.suites, ['typed-decisions']);
  const ra = rows.find((r) => r.subject === 'a');
  const rb = rows.find((r) => r.subject === 'b');
  assert.equal(ra?.buckets.typed?.score, 80);
  assert.equal(Math.round((ra?.buckets.calibration?.score ?? 0) * 100) / 100, 90, 'calibration is (1 - Brier) x 100');
  assert.equal(ra?.index, 100);
  // b: typed 60/80 = 75, calibration 90/90 = 100 -> 87.5
  assert.equal(Math.round((rb?.index ?? 0) * 100) / 100, 87.5);
  assert.equal(rb?.coverage, 2);
  assert.equal(ra?.buckets.scenes, undefined, 'no scenes run means no scenes score');
  assert.equal(ra?.speed.latency?.value, 150);
  assert.equal(ra?.speed.decode, null, 'decode is not measured by decision suites');
  assert.equal(ra?.speed.ttft, null);
});

test('each suite is compared on one board: the tier most subjects ran', () => {
  const quick = board('typed-decisions/quick/p', 'typed-decisions', 'quick', [decisions('a', 0.7), decisions('b', 0.6)]);
  const core = board('typed-decisions/core/p', 'typed-decisions', 'core', [decisions('a', 0.74, 'core')]);
  assert.equal(boardPerSuite([core, quick]).get('typed-decisions')?.tier, 'quick');
  const unranked = { ...quick, id: 'decision-conformance/quick/p', suite: 'decision-conformance', rows: quick.rows.map((r) => ({ ...r, rank: { low: 0, high: 0 } })) };
  assert.equal(boardPerSuite([unranked]).size, 0, 'pass/fail suites are not scored');
});

test('a subject with two modes on one suite keeps its better one', () => {
  const json = decisions('q', 0.6, 'quick', 'gateway:json-schema');
  const logprob = decisions('q', 0.7, 'quick', 'gateway:logprob');
  const rows = overall([json, logprob], [board('typed-decisions/quick/p', 'typed-decisions', 'quick', [logprob, json])], () => 'decisions').find((g) => g.id === 'decision')?.rows ?? [];
  assert.equal(Math.round((rows[0]?.buckets.typed?.score ?? 0) * 10) / 10, 70);
  assert.equal(headline(json), 60);
});

test('decision, embedding and language results never share a table or an Index', () => {
  const dec = decisions('jev', 0.75);
  const emb = { ...decisions('gemma', 0.5), kind: 'embeddings', suite: 'embeddings', id: 'gemma/embeddings/r', reference: null, is_reference: true,
    dims: [{ dim: 768, score: iv(0.669), tasks: {}, fidelity: null, delta: null }],
    throughput: { texts_per_s: 40, tokens_per_s: 7000, engine_tokens_per_s: 11000, tokens: 1, texts: 1 }, engine_info: null } as unknown as Run;
  const groups = overall([dec, emb], [
    board('typed-decisions/quick/p', 'typed-decisions', 'quick', [dec]),
    board('embeddings/quick/p', 'embeddings', 'quick', [emb]),
  ], (s) => (s === 'embeddings' ? 'embeddings' : 'decisions'));
  const decision = groups.find((g) => g.id === 'decision');
  const embedding = groups.find((g) => g.id === 'embedding');
  assert.deepEqual(groups.map((g) => g.id), ['language', 'decision', 'embedding', 'image']);
  assert.deepEqual(decision?.rows.map((r) => r.subject), ['jev']);
  assert.deepEqual(groups.find((g) => g.id === 'language')?.rows, [], 'a decision run is not a language result');
  assert.deepEqual(embedding?.rows.map((r) => r.subject), ['gemma']);
  assert.equal(embedding?.rows[0]?.speed.prefill?.value, 11000, 'embedding throughput is prefill');
  assert.ok(!embedding?.speed.some((s) => s.id === 'decode'), 'embedding tables have no decode column');
});
