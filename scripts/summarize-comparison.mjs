import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { z } from 'zod';
import { percentiles } from '../packages/gateway/src/metrics.ts';
import { demoModel } from '../apps/theater/lib/models.ts';
import { scenes } from '../apps/theater/lib/theater/data.ts';
import { quality } from './benchmark-quality.mjs';

import { models } from '../apps/theater/lib/models.ts';

// Offline only: validate and summarize unchanged paired browser exports.
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
const base = new URL('../docs/benchmarks/comparison/', import.meta.url);
const sources = [];
const reports = [];
const paired = [];
for (const {id:scene} of scenes) {
  const pair = [];
  for (const provider of ['qwen','jev']) {
    const file = `${scene}-${provider}.json`;
    const bytes = readFileSync(new URL(file,base));
    const raw = JSON.parse(bytes.toString());
    const data = exportSchema.parse(raw);
    assert.equal(data.runs.length,1);
    const run = data.runs[0];
    assert.equal(run.scene,scene);
    assert.equal(run.model,provider === 'qwen' ? 'qwen-3.8-27b' : 'jev-latest');
    assert.equal(run.model,data.model);
    assert.deepEqual(raw.runs[0].requestOrder,run.events.map(e=>e.item.id));
    assert.equal(new Set(run.events.map(e=>e.id)).size,run.events.length);
    let input=0,output=0,cost=0;
    for(const event of run.events) {
      assert.equal(Boolean(event.data),event.status==='validated');
      if(!event.data) continue;
      assert.equal(event.httpStatus,200); assert.equal(event.data.model,run.model);
      const price=models[run.model]; const usage=event.data.usage;
      assert.ok(Math.abs((usage.input_tokens*price.input+usage.output_tokens*price.output)/1e6-event.data.estimatedCostUsd)<1e-10);
      input+=usage.input_tokens; output+=usage.output_tokens; cost+=event.data.estimatedCostUsd;
    }
    const valid=run.events.filter(e=>e.data);
    assert.equal(run.totals.input,input); assert.equal(run.totals.output,output);
    assert.equal(run.totals.measuredRequests,valid.length); assert.ok(Math.abs(run.totals.cost-cost)<1e-10);
    sources.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),exportedAt:data.generatedAt});
    reports.push({scene,provider,model:run.model,providerModels:[...new Set(raw.runs[0].events.flatMap(e=>e.data?[e.data.providerModel??e.data.model]:[]))],
      concurrency:run.concurrency,requests:run.events.length,validated:valid.length,
      failed:run.events.filter(e=>e.status==='failed').length,canceled:run.events.filter(e=>e.status==='canceled').length,
      rateLimited:run.events.filter(e=>e.httpStatus===429).length,elapsedMs:run.elapsedMs,
      successLatencyMs:percentiles(valid.map(e=>e.elapsedMs)),allSettledLatencyMs:percentiles(run.events.map(e=>e.elapsedMs)),
      inputTokens:input,outputTokens:output,knownCostUsd:cost,decisionsPerSecond:valid.length/(run.elapsedMs/1000),
      requestBytes:percentiles(raw.runs[0].events.flatMap(e=>e.data?[Buffer.byteLength(JSON.stringify(e.data.contract))]:[])),
      nativeQuestionCounts:[...new Set(raw.runs[0].events.flatMap(e=>e.data?.questionCount?[e.data.questionCount]:[]))],
      quality:quality(run)});
    pair.push(run);
  }
  const [a,b]=pair;
  const starts=pair.map(r=>Date.parse(r.events[0].sentAt));
  const overlapMs=Math.min(...pair.map((r,i)=>starts[i]+r.elapsedMs))-Math.max(...starts);
  assert.ok(overlapMs>0,'Both model runs must overlap');
  if(!['navigate','drive'].includes(scene)) {
    const common=Math.min(a.events.length,b.events.length);
    assert.deepEqual(a.events.slice(0,common).map(e=>e.item.id),b.events.slice(0,common).map(e=>e.item.id));
    if(scene!=='home') assert.deepEqual(a.events.slice(0,common).map(e=>e.item.context),b.events.slice(0,common).map(e=>e.item.context));
  }
  if(['home','navigate'].includes(scene)) assert.deepEqual(a.events[0].item.context,b.events[0].item.context);
  paired.push({scene,startDifferenceMs:Math.abs(starts[0]-starts[1]),overlapMs,wallMs:Math.max(...pair.map((r,i)=>starts[i]+r.elapsedMs))-Math.min(...starts)});
}
const totals=Object.fromEntries(['qwen','jev'].map(provider=>{
  const runs=reports.filter(r=>r.provider===provider);
  const events=sources.filter(s=>s.file.endsWith(`-${provider}.json`)).flatMap(s=>exportSchema.parse(JSON.parse(readFileSync(new URL(s.file,base),'utf8'))).runs[0].events);
  const sum=key=>runs.reduce((n,r)=>n+r[key],0);
  return [provider,{requests:sum('requests'),validated:sum('validated'),failed:sum('failed'),canceled:sum('canceled'),rateLimited:sum('rateLimited'),automaticRetries:0,
    measuredSceneMs:sum('elapsedMs'),inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),knownCostUsd:sum('knownCostUsd'),successLatencyMs:percentiles(events.filter(e=>e.data).map(e=>e.elapsedMs)),
    successfulDecisionsPerSecond:sum('validated')/(sum('elapsedMs')/1000)}];
}));
writeFileSync(new URL('summary.json',base),JSON.stringify({sources,datasetVersion:3,paired,runs:reports,totals,
  note:'One paired run per scene, no warmups or retries. Browser request latency includes local HTTP and validation. Stateful contexts evolve independently. Sum of scene durations excludes operator gaps. Costs exclude unknown failed/canceled usage. Exact fixture agreement is not calibrated quality or API parity.'},null,2)+'\n');
console.log(JSON.stringify(totals,null,2));
