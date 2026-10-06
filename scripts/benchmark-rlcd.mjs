/* global AbortController, structuredClone */
import assert from 'node:assert/strict';
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { createDemoRuntime } from '../apps/theater/lib/runtime.ts';
import { installedRlcd } from '../apps/theater/scripts/rlcd-paths.mjs';
import release from '../apps/theater/rlcd-release.json' with { type: 'json' };
import { scenes } from '../packages/decisions/src/scenes/data.ts';
import { requestTotals } from '../packages/decisions/src/scenes/workload.ts';
import { initialHome, homeDecision, applyHome } from '../packages/decisions/src/scenes/home.ts';
import { DrivingEngine, driveDecision } from '../packages/decisions/src/scenes/driving.ts';

// Live local inference only. Replay the published input order, never expected answers.
// Direct timing includes queueing, cold load where encountered, inference and validation.
const directory = process.argv[2];
assert.ok(directory, 'Usage: npm run benchmark:rlcd -- <new-output-directory>');
mkdirSync(directory, { recursive: false });
const rlcd = installedRlcd();
assert.ok(rlcd, 'Run npm run setup:rlcd first');
const hash = async file => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
const sourceFiles = new Set(execFileSync('git', ['ls-files', 'apps/theater/lib', 'packages/decisions/src',
  'apps/theater/rlcd-release.json', 'apps/theater/rlcd-requirements.lock',
  'apps/theater/python/rlcd_worker.py', 'scripts/benchmark-rlcd.mjs', 'package-lock.json'],
{ encoding: 'utf8' }).trim().split('\n').filter(Boolean));
for (const file of ['apps/theater/lib/rlcd.ts', 'apps/theater/lib/rlcd-plan.ts',
  'apps/theater/python/rlcd_worker.py', 'apps/theater/rlcd-release.json',
  'apps/theater/rlcd-requirements.lock', 'scripts/benchmark-rlcd.mjs']) sourceFiles.add(file);
const sourceSha256 = {};
for (const file of sourceFiles) sourceSha256[file] = await hash(file);
writeFileSync(`${directory}/environment.json`, JSON.stringify({
  measuredAtUtc: new Date().toISOString(),
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim()),
  environment: { os: os.release(), platform: process.platform, architecture: process.arch,
    cpu: os.cpus()[0].model, cores: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  configuration: { model: 'qwen-2.5-1.5b-rlcd', engine: release.engineRepository,
    engineRevision: release.engineRevision, weights: release.weightsRepository,
    weightsRevision: release.weightsRevision, warmupRequests: 0, automaticRetries: 0,
    staticCallerConcurrency: 2, statefulCallerConcurrency: 1, inferenceWorkers: 1,
    workerQueue: 'FIFO', temperature: 1, browser: false, http: false },
  weightsSha256: await hash(path.join(rlcd.weights, 'model.safetensors')),
  engineSha256: await hash(path.join(rlcd.source, 'core', 'engine_mlx.py')),
  workerSha256: await hash(rlcd.worker), sourceSha256,
}, null, 2) + '\n');

const runtime = await createDemoRuntime({ rlcd });
let nextId = 1;
try {
  for (const { id: scene } of scenes) {
    const historical = JSON.parse(readFileSync(`docs/benchmarks/comparison/${scene}-qwen.json`, 'utf8')).runs[0];
    const events = []; const begin = performance.now();
    const request = async (item, signal = new AbortController().signal) => {
      const event = { id: nextId++, scene, item: structuredClone(item), input: structuredClone(item.context),
        status: 'pending', sentAt: new Date().toISOString() };
      events.push(event); const start = performance.now();
      const reply = await runtime.run({ id: scene, model: 'qwen-2.5-1.5b-rlcd',
        text: JSON.stringify(item.context) }, signal);
      event.httpStatus = reply.status;
      if (signal.aborted) { event.status = 'canceled'; event.error = 'Canceled at driving deadline. No action applied.'; }
      else if (reply.status === 200) {
        assert.equal(reply.body.model, 'qwen-2.5-1.5b-rlcd'); event.status = 'validated'; event.data = reply.body;
      } else { event.status = 'failed'; event.error = reply.body.error; event.failure = reply.body; }
      event.elapsedMs = performance.now() - start; event.settledMs = performance.now() - begin;
      return event;
    };
    let car;
    if (scene === 'navigate') {
      let nav = { position: 20, target: 4, visited: [20] }; const visits = new Map();
      for (let step = 0; step < 24 && nav.position !== nav.target; step++) {
        const event = await request({ id: `HOP-${step + 1}`, title: `Junction ${nav.position} → ${nav.target}`, context: nav });
        if (event.status !== 'validated') break;
        const next = event.data.decision.next; nav = { ...nav, position: next, visited: [...nav.visited, next] };
        visits.set(next, (visits.get(next) ?? 0) + 1); if (visits.get(next) >= 3) break;
      }
    } else if (scene === 'home') {
      let state = { ...initialHome };
      for (const old of historical.events) {
        const event = await request({ ...old.item, context: { ...old.item.context, state: { ...state } } });
        if (event.status !== 'validated') break;
        state = applyHome(state, homeDecision.parse(event.data.decision));
      }
    } else if (scene === 'drive') {
      const engine = new DrivingEngine(); engine.start(performance.now());
      const abort = new AbortController(); const deadline = setTimeout(() => abort.abort(), 10_000);
      const tick = setInterval(() => engine.tick(performance.now()), 60);
      try {
        let step = 0;
        while (!abort.signal.aborted && engine.tick(performance.now()).elapsedMs < 10_000) {
          const event = await request({ id: `DRV-${++step}`, title: `Drive tick ${step}`,
            context: { ...engine.state } }, abort.signal);
          if (event.status === 'validated' && !abort.signal.aborted) {
            engine.apply(driveDecision.parse(event.data.decision), performance.now());
          }
        }
      } finally { clearTimeout(deadline); clearInterval(tick); engine.stop(performance.now()); car = { ...engine.state }; }
    } else {
      let next = 0;
      const caller = async () => { while (next < historical.events.length) await request(historical.events[next++].item); };
      await Promise.all([caller(), caller()]);
    }
    const run = { scene, model: 'qwen-2.5-1.5b-rlcd', elapsedMs: performance.now() - begin,
      concurrency: ['navigate', 'drive', 'home'].includes(scene) ? 1 : 2, events, ...(car ? { car } : {}),
      requestOrder: events.map(event => event.item.id), totals: requestTotals(events) };
    writeFileSync(`${directory}/${scene}-rlcd.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
      model: 'qwen-2.5-1.5b-rlcd', mode: 'live', datasetVersion: 3, mappingVersion: 'rlcd-scenes-v2',
      measurement: 'Direct demo runtime; no browser/HTTP. Two concurrent callers feed one persistent, serialized MLX worker. No warmups, retries or fallback.', runs: [run] }, null, 2) + '\n');
    process.stdout.write(`${scene}: ${events.filter(event => event.status === 'validated').length}/${events.length} validated, ${(run.elapsedMs / 1000).toFixed(2)}s\n`);
  }
} finally { await runtime.close(); }
