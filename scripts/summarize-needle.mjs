import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { z } from 'zod';
import { scenes } from '../apps/theater/lib/theater/data.ts';
import { percentiles } from '../packages/gateway/src/metrics.ts';
import { quality } from './benchmark-quality.mjs';
const directory=process.argv[2]??'docs/benchmarks/needle';
const metric=z.number().finite().nonnegative();
const eventSchema=z.object({id:metric.int(),status:z.enum(['validated','failed','canceled']),elapsedMs:metric,sentAt:z.iso.datetime(),httpStatus:metric.int(),item:z.object({id:z.string(),context:z.record(z.string(),z.unknown())}),data:z.object({model:z.literal('needle-3'),usage:z.null(),estimatedCostUsd:z.literal(0),decision:z.record(z.string(),z.unknown()),nativeMetrics:z.object({decodeTokensPerSecond:metric,prefillTokensPerSecond:metric,peakRamMb:metric})}).optional()});
const reports=[], sources=[], all=[];
for(const {id:scene} of scenes){
  const file=`${scene}-needle.json`, bytes=readFileSync(`${directory}/${file}`);
  const raw=JSON.parse(bytes.toString());assert.equal(raw.mode,'live');assert.equal(raw.datasetVersion,3);assert.equal(raw.runs.length,1);
  const run=raw.runs[0];assert.equal(run.scene,scene);assert.equal(run.model,'needle-3');
  const events=z.array(eventSchema).min(1).parse(run.events);run.events=events;
  assert.deepEqual(run.requestOrder,events.map(e=>e.item.id));
  for(const e of events){assert.equal(Boolean(e.data),e.status==='validated');if(e.data)assert.equal(e.httpStatus,200);}
  const valid=events.filter(e=>e.data);all.push(...events);
  assert.equal(run.totals.measuredRequests,0);assert.equal(run.totals.unmeasuredRequests,valid.length);assert.equal(run.totals.cost,0);
  if(!['navigate','drive'].includes(scene)){
    const baseline=JSON.parse(readFileSync(`docs/benchmarks/comparison/${scene}-qwen.json`,'utf8')).runs[0].events;
    assert.deepEqual(events.map(e=>e.item.id),baseline.slice(0,events.length).map(e=>e.item.id));
    if(scene!=='home')assert.deepEqual(events.map(e=>e.item.context),baseline.map(e=>e.item.context));
  }
  sources.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  reports.push({scene,requests:events.length,validated:valid.length,failed:events.filter(e=>e.status==='failed').length,canceled:events.filter(e=>e.status==='canceled').length,elapsedMs:run.elapsedMs,concurrency:run.concurrency,successLatencyMs:percentiles(valid.map(e=>e.elapsedMs)),allSettledLatencyMs:percentiles(events.map(e=>e.elapsedMs)),nativeDecodeTokensPerSecond:percentiles(valid.map(e=>e.data.nativeMetrics.decodeTokensPerSecond)),quality:quality(run)});
}
const valid=all.filter(e=>e.data),sum=key=>reports.reduce((n,r)=>n+r[key],0);
const totals={requests:sum('requests'),validated:sum('validated'),failed:sum('failed'),canceled:sum('canceled'),measuredSceneMs:sum('elapsedMs'),successLatencyMs:percentiles(valid.map(e=>e.elapsedMs)),allSettledLatencyMs:percentiles(all.map(e=>e.elapsedMs)),inputTokens:null,outputTokens:null,apiCostUsd:0,averageApiCostUsd:0,nativeDecodeTokensPerSecond:percentiles(valid.map(e=>e.data.nativeMetrics.decodeTokensPerSecond)),nativePrefillTokensPerSecond:percentiles(valid.map(e=>e.data.nativeMetrics.prefillTokensPerSecond)),peakRamMb:Math.max(...valid.map(e=>e.data.nativeMetrics.peakRamMb)),successfulDecisionsPerSecond:valid.length/(sum('elapsedMs')/1000)};
writeFileSync(`${directory}/summary.json`,JSON.stringify({sources,runs:reports,totals,note:'Separate local direct-runtime run; not simultaneous with historical browser runs. Native rates are internal engine measurements for successful requests, not end-to-end throughput. Token counts unavailable. Zero API fees excludes hardware/electricity. Failed results retained; stateful scenes stop on invalid output except driving, which runs for ten seconds.'},null,2)+'\n');
process.stdout.write(JSON.stringify(totals,null,2)+'\n');
