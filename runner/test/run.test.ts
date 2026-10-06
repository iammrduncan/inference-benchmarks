// End to end against a local fake decision endpoint: identity, records, summary
// reproducibility, credential redaction, budget refusal and the raw-data pointer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { runAll } from '../src/run.ts';
import { buildSummary, readRaw, REPO_ROOT, writeRaw, type RunJson } from '../src/record.ts';
import { decisionConformance } from '../src/suites/decision-conformance.ts';
import type { RawRow } from '../src/suite.ts';
import { answerAll, fakeServer, json } from './helpers.ts';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'bench-test-'));
  cpSync(join(REPO_ROOT, 'suites', 'decision-conformance'), join(root, 'suites', 'decision-conformance'), { recursive: true });
  const identity = join(root, 'identity.yaml');
  writeFileSync(identity, YAML.stringify({ model: 'fake-decider', checkpoint: { hf: 'example/fake-decider', revision: 'a'.repeat(40) }, quant: { format: 'bf16' }, engine: { name: 'fake', version: '1.0.0' } }));
  return { root, identity };
}

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

test('a conformance run writes a complete, reproducible record and never stores the key', async () => {
  const { root, identity } = sandbox();
  process.env.BENCH_TEST_KEY = 'TEST-SECRET-VALUE';
  const s = await fakeServer((path, body, req, res) => req.headers.authorization === 'Bearer TEST-SECRET-VALUE' && path === '/v1/systemone'
    ? json(res, 200, answerAll(body)) : json(res, 401, { error: 'no' }));
  try {
    const [dir] = await runAll({ kind: 'endpoint', url: s.url, identity, model: 'fake-decider-1', keyEnv: 'BENCH_TEST_KEY' },
      { suites: ['decision-conformance'], tier: 'quick', profile: 'greedy-nothink', budgetUsd: null, concurrency: 3, rpm: 6000, root, log: () => {} });
    assert.ok(dir);
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunJson;
    assert.equal(run.status, 'complete');
    assert.equal(run.subject.key, 'fake-decider/hf-aaaaaaa/bf16/fake-1.0.0');
    assert.equal(run.subject.verified_identity, false);
    assert.equal(run.subject.label, 'unverified identity');
    assert.equal(run.harness.name, 'bench');
    assert.match(run.harness.suite_hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(run.observed_models, { 'fake-decider-1': 17 });
    assert.deepEqual(run.dispatch, { concurrency: 3, requests_per_minute: 6000, retries: 0 });
    const rows = readRaw(dir, root);
    assert.equal(rows.length, 17);
    assert.deepEqual(rows.map((r) => r.index), [...rows.keys()], 'raw rows are in item order');
    assert.equal(readFileSync(join(dir, 'summary.json'), 'utf8'), buildSummary(run, rows, decisionConformance), 'summary recomputes byte for byte');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { metrics: { passed: number; total: number } };
    assert.ok(summary.metrics.total > 0 && summary.metrics.passed === summary.metrics.total);
    for (const f of files(root)) assert.ok(!readFileSync(f, 'utf8').includes('TEST-SECRET-VALUE'), `key leaked into ${f}`);
    assert.ok(existsSync(join(root, 'subjects', run.subject.key, 'subject.yaml')));
  } finally { await s.close(); delete process.env.BENCH_TEST_KEY; }
});

test('a budget needs a known price, and failures are recorded rather than retried', async () => {
  const { root, identity } = sandbox();
  const s = await fakeServer((_p, _b, _req, res) => json(res, 500, { error: 'down' }));
  try {
    await assert.rejects(runAll({ kind: 'endpoint', url: s.url, identity, model: 'm' },
      { suites: ['decision-conformance'], tier: 'quick', profile: 'greedy-nothink', budgetUsd: 1, concurrency: 1, root, log: () => {} }), /needs a known price/);
    const [dir] = await runAll({ kind: 'endpoint', url: s.url, identity, model: 'm' },
      { suites: ['decision-conformance'], tier: 'quick', profile: 'greedy-nothink', budgetUsd: null, concurrency: 1, root, log: () => {} });
    assert.ok(dir);
    assert.equal(s.requests.length, 17, 'one request per item, no retries');
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunJson;
    assert.equal(run.completed, 0);
    assert.equal(run.status, 'complete', 'every item was attempted; the failures are in the scores');
    const sum = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { items: { failed_by_status: Record<string, number> } };
    assert.deepEqual(sum.items.failed_by_status, { 500: 17 });
  } finally { await s.close(); }
});

test('raw data over 5 MB moves behind a hash-checked pointer', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-raw-'));
  const dir = join(root, 'results', 's', 'suite', 'run');
  cpSync(join(REPO_ROOT, 'suites', 'decision-conformance'), join(dir), { recursive: true });
  const big = 'x'.repeat(200_000);
  const rows: RawRow[] = Array.from({ length: 30 }, (_, i) => ({ index: i, item_id: `i${i}`, ok: true, status: 200, latency_ms: 1, request: { url: 'u', body: { big } }, cost_usd: 0 }));
  writeRaw(dir, rows, root);
  assert.ok(!existsSync(join(dir, 'raw.jsonl')) && existsSync(join(dir, 'raw.pointer.json')));
  assert.equal(readRaw(dir, root).length, 30);
});
