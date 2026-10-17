// Public records name lab machines by alias: the runner records the inventory host name, not
// the address it reached the engine at, and never a local engine-source path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { hostRename, publicSource } from '../src/launcher.ts';
import { resolveTarget, runSuite } from '../src/run.ts';
import { buildSummary, readRaw, REPO_ROOT, type RunJson } from '../src/record.ts';
import { decisionConformance } from '../src/suites/decision-conformance.ts';
import { answerAll, fakeServer, json } from './helpers.ts';

const up = (base_url: string, host?: string) => ({ base_url, ...(host ? { hardware: [{ host, devices: [] }] } : {}) });

test('a lab engine is recorded under its inventory name, without the port', () => {
  assert.deepEqual(hostRename(up('http://labbox07:8000', 'gpu-host-2')), { from: 'labbox07:8000', to: 'gpu-host-2' });
  assert.deepEqual(hostRename(up('http://10.0.0.12:8000', 'gpu-host-2')), { from: '10.0.0.12:8000', to: 'gpu-host-2' });
  assert.equal(hostRename(up('http://127.0.0.1:41234', 'macbook')), undefined, 'engines on this machine are recorded as they are');
  assert.equal(hostRename(up('http://labbox07:8000')), undefined, 'no placement, nothing to rename to');
});

test('local engine-source paths are named, URLs are kept', () => {
  const pin = { commit: 'c'.repeat(40), mirror: 'https://github.com/iammrduncan/inference-engines' };
  assert.deepEqual(publicSource({ ...pin, repo: '/home/someone/.cache/mirror.git', override: false }), { ...pin, repo: 'local mirror', override: false });
  assert.deepEqual(publicSource({ ...pin, repo: '~/src/inference-engines', override: true }), { ...pin, repo: 'local checkout', override: true });
  assert.deepEqual(publicSource({ ...pin, repo: 'https://github.com/iammrduncan/inference-engines' }), { ...pin, repo: 'https://github.com/iammrduncan/inference-engines' });
  assert.equal(publicSource(null), null);
});

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

test('a renamed run never writes the engine address, and its summary still recomputes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-alias-'));
  cpSync(join(REPO_ROOT, 'suites', 'decision-conformance'), join(root, 'suites', 'decision-conformance'), { recursive: true });
  const identity = join(root, 'identity.yaml');
  writeFileSync(identity, YAML.stringify({ model: 'fake-decider', checkpoint: { hf: 'example/fake-decider', revision: 'a'.repeat(40) }, quant: { format: 'bf16' }, engine: { name: 'fake', version: '1.0.0' } }));
  const s = await fakeServer((path, body, _req, res) => (path === '/v1/systemone' ? json(res, 200, answerAll(body)) : json(res, 404, {})));
  try {
    const address = new URL(s.url).host;
    const r = { ...(await resolveTarget({ kind: 'endpoint', url: s.url, identity, model: 'fake-decider-1' })), rename: { from: address, to: 'gpu-host-2' } };
    const { dir } = await runSuite(r, decisionConformance, { suites: ['decision-conformance'], tier: 'quick', profile: 'greedy-nothink', budgetUsd: null, concurrency: 2, root, log: () => {} });
    for (const f of files(dir)) assert.ok(!readFileSync(f, 'utf8').includes(address), `engine address in ${f}`);
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunJson;
    assert.equal(run.endpoint, 'http://gpu-host-2/v1/systemone');
    const rows = readRaw(dir, root);
    assert.ok(rows.length > 0 && rows.every((row) => row.request.url === 'http://gpu-host-2/v1/systemone'));
    assert.equal(readFileSync(join(dir, 'summary.json'), 'utf8'), buildSummary(run, rows, decisionConformance), 'summary recomputes from the renamed records');
  } finally { await s.close(); }
});
