/* global AbortSignal, fetch, performance */
// Local, synthetic-only diagnostic. Compare cold CLI calls and isolated warm workers
// on the same historical input order; do not mistake native rates for TTFT.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { installedNeedle } from '../apps/theater/scripts/needle-paths.mjs';
import { needlePlan } from '../apps/theater/lib/needle-plan.ts';
import { decodeNeedle } from '../apps/theater/lib/needle.ts';

const [scene = 'screen', countText = '20'] = process.argv.slice(2);
assert.ok(['dispatch', 'screen', 'approve', 'judge'].includes(scene));
const count = Number(countText);
assert.ok(Number.isInteger(count) && count > 0 && count <= 100);
const needle = installedNeedle();
assert.ok(needle, 'Run npm run setup:needle first');
const historical = JSON.parse(await readFile(`docs/benchmarks/comparison/${scene}-qwen.json`, 'utf8')).runs[0].events;
const inputs = historical.slice(0, count).map(e => ({ id: scene, model: 'needle-3', text: JSON.stringify(e.item.context) }));
const directory = await mkdtemp(path.join(tmpdir(), 'needle-speed-'));
const toolsPath = path.join(directory, 'tools.json');
const plan = needlePlan(inputs[0]);
await writeFile(toolsPath, JSON.stringify(plan.tools));
const environment = { PATH: process.env.PATH ?? '', NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' };
const execute = promisify(execFile);
const results = [];
const common = ['--model', needle.weights, '--tools', toolsPath, '--depth', '20', '--max', String(plan.max_new_tokens), '--forced', '--fail-input-overflow'];

async function availablePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

async function startWorker(threads) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const args = [...common, '--threads', String(threads), '--serve', '--port', String(port)];
  const child = spawn(needle.executable, args, { env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 1024); });
  const closed = new Promise(resolve => child.once('close', resolve));
  const started = performance.now();
  for (let attempt = 0; attempt < 250 && performance.now() - started < 5000; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${origin}/reset`, { method: 'POST', signal: AbortSignal.timeout(200) });
      if (response.ok) return { origin, child, closed, startupMs: performance.now() - started };
    } catch { /* Wait for local server startup. */ }
    await delay(10);
  }
  child.kill('SIGKILL');
  await closed;
  throw new Error(`Native worker did not start: ${stderr.slice(0, 200)}`);
}

async function measure(mode, concurrency, threads) {
  let next = 0;
  const events = [];
  const workers = [];
  try {
    if (mode === 'warm') {
      for (let n = 0; n < concurrency; n++) workers.push(await startWorker(threads));
    }
    const begin = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async (_, workerIndex) => {
      while (next < inputs.length) {
        const index = next++;
        const input = inputs[index];
        const localPlan = needlePlan(input);
        const start = performance.now();
        let raw;
        try {
          if (mode === 'cold') {
            const { stdout } = await execute(needle.executable, [...common, '--threads', String(threads), '--prompt', localPlan.input],
              { env: environment, timeout: 16000, maxBuffer: 262144 });
            raw = JSON.parse(stdout);
          } else {
            const worker = workers[workerIndex];
            const reset = await fetch(`${worker.origin}/reset`, { method: 'POST', signal: AbortSignal.timeout(16000) });
            if (!reset.ok) throw new Error(`Reset ${reset.status}`);
            const response = await fetch(`${worker.origin}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ input: localPlan.input }), signal: AbortSignal.timeout(16000) });
            if (!response.ok) throw new Error(`Complete ${response.status}`);
            raw = await response.json();
          }
          const { decision } = decodeNeedle(input, localPlan, raw);
          events.push({ index, elapsedMs: performance.now() - start, valid: true, decision });
        } catch (error) {
          events.push({ index, elapsedMs: performance.now() - start, valid: false, error: error?.code ?? 'invalid_provider_output' });
        }
      }
    }));
    const totalMs = performance.now() - begin;
    const times = events.map(e => e.elapsedMs).sort((a, b) => a - b);
    const p = fraction => times[Math.ceil(fraction * times.length) - 1];
    const result = { scene, count, mode, concurrency, threads, totalMs, valid: events.filter(e => e.valid).length,
      p50Ms: p(0.5), p95Ms: p(0.95), startupMs: workers.map(w => w.startupMs),
      outcomes: events.sort((a, b) => a.index - b.index).map(e => e.valid ? e.decision : e.error) };
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    for (const worker of workers) worker.child.kill('SIGKILL');
    await Promise.all(workers.map(worker => worker.closed));
  }
}

try {
  for (const [mode, concurrency, threads] of [
    ['cold', 2, 4], ['cold', 1, 4], ['cold', 4, 4], ['cold', 4, 1],
    ['warm', 2, 4], ['warm', 4, 1],
  ]) await measure(mode, concurrency, threads);
} finally { await rm(directory, { recursive: true, force: true }); }
