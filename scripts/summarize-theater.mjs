import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { z } from 'zod';
import { percentiles, estimatedCost } from '../packages/gateway/src/metrics.ts';
import { demoModel } from '../apps/theater/lib/models.ts';
import { scenes, fixtureValues } from '../apps/theater/lib/theater/data.ts';
import { fixtureDispatch, teams, priorities, actions } from '../apps/theater/lib/traffic.ts';
import { homeCases, homeDecision, applyHome, initialHome } from '../apps/theater/lib/theater/home.ts';

// Offline only: recompute the published summary from untouched browser exports.
const number = z.number().finite().nonnegative();
const eventSchema = z.object({
  id: z.number().int(), status: z.enum(['validated', 'failed', 'canceled']),
  sentAt: z.iso.datetime(), elapsedMs: number, httpStatus: z.number().optional(),
  item: z.object({ id: z.string(), context: z.record(z.string(), z.unknown()) }),
  data: z.object({ model: demoModel, elapsedMs: number,
    decision: z.record(z.string(), z.unknown()),
    usage: z.object({ input_tokens: number.int(), output_tokens: number.int() }),
    estimatedCostUsd: number }).optional(),
});
const runSchema = z.object({ scene: z.enum(scenes.map(s => s.id)), model: demoModel,
  elapsedMs: number.positive(), concurrency: z.number().int().min(1).max(5),
  events: z.array(eventSchema).min(1), car: z.record(z.string(), z.unknown()).optional(),
  totals: z.object({ input: number, output: number, cost: number, measuredRequests: number.int() }),
});
const exportSchema = z.object({ mode: z.literal('live'), datasetVersion: z.literal(3),
  generatedAt: z.iso.datetime(), model: demoModel, runs: z.array(runSchema).min(1) });
const base = new URL('../docs/benchmarks/theater/', import.meta.url);
const files = ['initial.json', 'scoring.json', 'home.json'];
const exports = files.map(file => {
  const bytes = readFileSync(new URL(file, base));
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'),
    data: exportSchema.parse(JSON.parse(bytes.toString())) };
});
function quality(run) {
  const accepted = run.events.filter(e => e.data);
  const mismatches = [];
  let state = { ...initialHome };
  for (const event of accepted) {
    const decision = event.data.decision;
    const index = Number(event.item.id.split('-').at(-1)) - 1;
    let expected;
    if (run.scene === 'dispatch') {
      const values = fixtureDispatch(JSON.stringify(event.item.context));
      assert.ok(values, 'Unknown ticket fixture');
      expected = { team: teams[values[0]], priority: priorities[values[1]], action: actions[values[2]], escalate: Boolean(values[3]) };
    } else if (run.scene === 'screen' || run.scene === 'approve') {
      expected = { decision: fixtureValues(run.scene, index)[0] ? 'block' : 'allow' };
    } else if (run.scene === 'judge') {
      const values = fixtureValues('judge', index);
      expected = { accuracy: values[0], valid: Boolean(values[1]) };
    } else if (run.scene === 'home') {
      assert.deepEqual(event.item.context.state, state, 'Home state continuity');
      expected = homeCases.find(c => c.command === event.item.context.command)?.expected;
      assert.ok(expected, 'Unknown home command');
      state = applyHome(state, homeDecision.parse(decision));
    }
    if (expected && Object.entries(expected).some(([key, value]) => decision[key] !== value)) {
      mismatches.push({ id: event.item.id, expected, actual: decision });
    }
  }
  if (run.scene === 'drive') return { car: run.car };
  if (run.scene === 'navigate') {
    const last = accepted.at(-1);
    return { reachedTarget: last?.data.decision.next === last?.item.context.target,
      hops: accepted.length, path: [run.events[0].item.context.position, ...accepted.map(e => e.data.decision.next)] };
  }
  return { exactFixtureMatches: accepted.length - mismatches.length, evaluated: accepted.length,
    mismatches, ...(run.scene === 'judge' ? { displayThreshold: 90,
      aboveThreshold: accepted.filter(e => e.data.decision.accuracy > 90).length } : {}) };
}
const runs = exports.flatMap(({ file, data }) => data.runs.map(run => {
  assert.equal(run.model, data.model);
  assert.equal(new Set(run.events.map(e => e.id)).size, run.events.length);
  let input = 0, output = 0, cost = 0;
  for (const event of run.events) {
    assert.equal(Boolean(event.data), event.status === 'validated');
    if (!event.data) continue;
    assert.equal(event.httpStatus, 200);
    assert.equal(event.data.model, run.model);
    assert.ok(Math.abs(estimatedCost(run.model, event.data.usage) - event.data.estimatedCostUsd) < 1e-10);
    input += event.data.usage.input_tokens;
    output += event.data.usage.output_tokens;
    cost += event.data.estimatedCostUsd;
  }
  const validated = run.events.filter(e => e.status === 'validated');
  assert.equal(input, run.totals.input); assert.equal(output, run.totals.output);
  assert.equal(validated.length, run.totals.measuredRequests);
  assert.ok(Math.abs(cost - run.totals.cost) < 1e-10);
  return { source: file, scene: run.scene, concurrency: run.concurrency,
    requests: run.events.length, validated: validated.length,
    failed: run.events.filter(e => e.status === 'failed').length,
    canceled: run.events.filter(e => e.status === 'canceled').length,
    rateLimited: run.events.filter(e => e.httpStatus === 429).length,
    elapsedMs: run.elapsedMs, successLatencyMs: percentiles(validated.map(e => e.elapsedMs)),
    allSettledLatencyMs: percentiles(run.events.map(e => e.elapsedMs)),
    inputTokens: input, outputTokens: output, knownCostUsd: cost,
    decisionsPerSecond: validated.length / (run.elapsedMs / 1000),
    outputTokensPerSecond: output / (run.elapsedMs / 1000), quality: quality(run) };
}));
const allEvents = exports.flatMap(e => e.data.runs.flatMap(r => r.events));
const sum = key => runs.reduce((n, run) => n + run[key], 0);
const report = {
  sources: exports.map(({ file, sha256, data }) => ({ file, sha256, exportedAt: data.generatedAt })),
  model: exports[0].data.model, datasetVersion: 3, runs,
  totals: { requests: sum('requests'), validated: sum('validated'), failed: sum('failed'),
    canceled: sum('canceled'), rateLimited: sum('rateLimited'), automaticRetries: 0,
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), knownCostUsd: sum('knownCostUsd'),
    measuredSceneMs: sum('elapsedMs'),
    successLatencyMs: percentiles(allEvents.filter(e => e.data).map(e => e.elapsedMs)),
    allSettledLatencyMs: percentiles(allEvents.map(e => e.elapsedMs)) },
  note: 'Includes interrupted scoring and its full manual rerun. Sum of scene times excludes transitions, quota recovery and operator gaps; it is not one continuous slideshow. Unknown failure/cancellation usage is excluded from known cost. No provider decode timing is exported.',
};
writeFileSync(new URL('summary.json', base), JSON.stringify(report, null, 2) + '\n');
