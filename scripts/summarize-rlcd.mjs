import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { z } from 'zod';
import { scenes } from '../apps/theater/lib/theater/data.ts';
import { percentiles } from '../packages/gateway/src/metrics.ts';
import { quality } from './benchmark-quality.mjs';

const directory = process.argv[2] ?? 'docs/benchmarks/rlcd-2026-09-19';
const metric = z.number().finite().nonnegative();
const eventSchema = z.object({ id: metric.int(), status: z.enum(['validated', 'failed', 'canceled']),
  elapsedMs: metric, sentAt: z.iso.datetime(), httpStatus: metric.int(),
  item: z.object({ id: z.string(), context: z.record(z.string(), z.unknown()) }),
  data: z.object({ model: z.literal('qwen-2.5-1.5b-rlcd'), usage: z.null(), estimatedCostUsd: z.literal(0),
    decision: z.record(z.string(), z.unknown()), rlcdMetrics: z.object({ engineElapsedMs: metric,
      prefillMs: metric, suffixEvalMs: metric, sequentialForwardPasses: metric.int(),
      fieldCount: metric.int(), collisionFields: z.array(z.string()) }) }).optional() });
const reports = [], sources = [], all = [];
for (const { id: scene } of scenes) {
  const file = `${scene}-rlcd.json`, bytes = readFileSync(`${directory}/${file}`);
  const raw = JSON.parse(bytes.toString()); assert.equal(raw.mode, 'live'); assert.equal(raw.datasetVersion, 3);
  assert.equal(raw.mappingVersion, 'rlcd-scenes-v2'); assert.equal(raw.runs.length, 1);
  const run = raw.runs[0]; assert.equal(run.scene, scene); assert.equal(run.model, 'qwen-2.5-1.5b-rlcd');
  const events = z.array(eventSchema).min(1).parse(run.events); run.events = events;
  assert.deepEqual(run.requestOrder, events.map(event => event.item.id));
  for (const event of events) { assert.equal(Boolean(event.data), event.status === 'validated');
    if (event.data) assert.equal(event.httpStatus, 200); }
  const valid = events.filter(event => event.data); all.push(...events);
  assert.equal(run.totals.measuredRequests, 0); assert.equal(run.totals.unmeasuredRequests, valid.length);
  assert.equal(run.totals.cost, 0);
  if (!['navigate', 'drive'].includes(scene)) {
    const baseline = JSON.parse(readFileSync(`docs/benchmarks/comparison/${scene}-qwen.json`, 'utf8')).runs[0].events;
    assert.deepEqual(events.map(event => event.item.id), baseline.slice(0, events.length).map(event => event.item.id));
    if (scene !== 'home') assert.deepEqual(events.map(event => event.item.context), baseline.map(event => event.item.context));
  }
  sources.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  reports.push({ scene, requests: events.length, validated: valid.length,
    failed: events.filter(event => event.status === 'failed').length,
    canceled: events.filter(event => event.status === 'canceled').length,
    elapsedMs: run.elapsedMs, concurrency: run.concurrency,
    successLatencyMs: percentiles(valid.map(event => event.elapsedMs)),
    allSettledLatencyMs: percentiles(events.map(event => event.elapsedMs)),
    engineElapsedMs: percentiles(valid.map(event => event.data.rlcdMetrics.engineElapsedMs)),
    prefillMs: percentiles(valid.map(event => event.data.rlcdMetrics.prefillMs)),
    suffixEvalMs: percentiles(valid.map(event => event.data.rlcdMetrics.suffixEvalMs)),
    collisionRequests: valid.filter(event => event.data.rlcdMetrics.collisionFields.length).length,
    collisionFieldDecisions: valid.reduce((sum, event) => sum + event.data.rlcdMetrics.collisionFields.length, 0),
    quality: quality(run) });
}
const valid = all.filter(event => event.data), sum = key => reports.reduce((total, report) => total + report[key], 0);
const totals = { requests: sum('requests'), validated: sum('validated'), failed: sum('failed'),
  canceled: sum('canceled'), measuredSceneMs: sum('elapsedMs'),
  successLatencyMs: percentiles(valid.map(event => event.elapsedMs)),
  allSettledLatencyMs: percentiles(all.map(event => event.elapsedMs)),
  engineElapsedMs: percentiles(valid.map(event => event.data.rlcdMetrics.engineElapsedMs)),
  prefillMs: percentiles(valid.map(event => event.data.rlcdMetrics.prefillMs)),
  suffixEvalMs: percentiles(valid.map(event => event.data.rlcdMetrics.suffixEvalMs)),
  collisionRequests: sum('collisionRequests'), collisionFieldDecisions: sum('collisionFieldDecisions'),
  inputTokens: null, outputTokens: null, apiCostUsd: 0, averageApiCostUsd: 0,
  successfulDecisionsPerSecond: valid.length / (sum('elapsedMs') / 1000) };
writeFileSync(`${directory}/summary.json`, JSON.stringify({ sources, runs: reports, totals,
  note: 'Separate local direct-runtime run; not simultaneous with historical browser runs. Two callers feed one serialized MLX worker, so caller concurrency does not imply parallel inputs. Field batching occurs only within each request. Timings include queueing and cold load where encountered. Token counts unavailable. Scores are vendor-reported candidate scores; collision-path scores are synthetic and must not be interpreted as calibrated probabilities. Zero API fees excludes hardware/electricity. Failed and canceled results are retained.' }, null, 2) + '\n');
process.stdout.write(JSON.stringify(totals, null, 2) + '\n');
