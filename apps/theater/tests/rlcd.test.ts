import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { createDemoRuntime } from '../lib/runtime';
import { decodeRlcd } from '../lib/rlcd';
import { rlcdPlan } from '../lib/rlcd-plan';
import { contractSnapshot, readContract, readRlcdContract } from '../lib/theater/contract-view';
import { workItem, type SceneId } from '../lib/theater/data';
import { DrivingEngine } from '../lib/theater/driving';

const input = (id: SceneId) => ({ id, model: 'qwen-2.5-1.5b-rlcd' as const,
  text: JSON.stringify(id === 'navigate' ? { position: 20, target: 4, visited: [20] }
    : id === 'drive' ? new DrivingEngine().state : workItem(id, 0).context) });

function response(plan: ReturnType<typeof rlcdPlan>) {
  const parsed = Object.fromEntries(Object.entries(plan.fields).map(([name, field]) => [name, {
    value: field.choices[0], prob: 0.8,
  }]));
  return { mode: 'parallel_constrained_calibrated', elapsed_ms: 12, prefill_ms: 9,
    suffix_eval_ms: 1, sequential_forward_passes: 1, is_valid_json: true, schema_match: true,
    parsed_json: parsed, field_telemetry: {}, has_calibrated_probabilities: true,
    total_tokens_generated: 0, num_fields: Object.keys(plan.fields).length, collision_fields: [] };
}

test('RLCD plans preserve every strict scene contract and convert bounded integers to choices', async () => {
  const runtime = await createDemoRuntime({ stub: true });
  try {
    assert.ok(runtime.config().availableModels.includes('qwen-2.5-1.5b-rlcd'));
    for (const id of ['dispatch', 'navigate', 'drive', 'screen', 'approve', 'judge', 'home'] satisfies SceneId[]) {
      const i = input(id), plan = rlcdPlan(i);
      if (id === 'judge') assert.equal(plan.mapping.kind, 'judge_criteria');
      else { assert.equal(plan.mapping.kind, 'direct'); assert.deepEqual(Object.keys(plan.fields), plan.schema.required); }
      const snapshot = contractSnapshot({ scene: id, model: i.model, context: JSON.parse(i.text) });
      assert.deepEqual(snapshot.request, plan);
      assert.equal(readRlcdContract(snapshot.request)?.mode, 'parallel_constrained');
      assert.equal(readContract(snapshot.request)?.fields.length, plan.schema.required.length);
      const reply = await runtime.run(i, new AbortController().signal);
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.equal(z.object({ model: z.literal('qwen-2.5-1.5b-rlcd'),
        mode: z.literal('fixture'), mappingVersion: z.literal('rlcd-scenes-v2') }).parse(reply.body).model, i.model);
    }
    const judge = rlcdPlan(input('judge'));
    assert.deepEqual(Object.keys(judge.fields), ['criterion_1', 'criterion_2', 'criterion_3', 'criterion_4']);
    assert.deepEqual(judge.fields.criterion_1?.values, [true, false]);
    assert.deepEqual(judge.mapping.kind === 'judge_criteria' ? judge.mapping.criteria.map(value => value.points) : [], [10, 20, 30, 40]);
    assert.match(judge.input, /CANDIDATE_TO_CHECK/);
  } finally { await runtime.close(); }
});

test('RLCD output gate rejects missing, extra, mistyped and unknown values', () => {
  const i = input('screen'), plan = rlcdPlan(i), good = response(plan);
  const decoded = decodeRlcd(i, plan, good);
  assert.deepEqual(decoded.decision, { decision: 'allow' });
  assert.equal(decoded.reportedFieldScores.decision?.reportedProbability, 0.8);
  for (const raw of [
    { ...good, parsed_json: {} },
    { ...good, parsed_json: { ...good.parsed_json, privateReasoning: { value: 'secret', prob: 1 } } },
    { ...good, parsed_json: { decision: { value: true, prob: 0.8 } } },
    { ...good, parsed_json: { decision: { value: 'execute', prob: 0.8 } } },
    { ...good, parsed_json: { decision: { value: 'BENIGN', prob: 2 } } },
    { ...good, collision_fields: ['unknown'] },
  ]) assert.throws(() => decodeRlcd(i, plan, raw));
});

test('RLCD judge batches criteria and aggregates only validated model decisions', () => {
  const i = input('judge'), plan = rlcdPlan(i), allSatisfied = response(plan);
  assert.deepEqual(decodeRlcd(i, plan, allSatisfied).result, { accuracy: 100, valid: true });
  const first = allSatisfied.parsed_json.criterion_1;
  assert.ok(first);
  const partial = { ...allSatisfied, parsed_json: { ...allSatisfied.parsed_json,
    criterion_1: { ...first, value: 'NO' } } };
  assert.deepEqual(decodeRlcd(i, plan, partial).result, { accuracy: 90, valid: false });
});

test('RLCD worker is persistent, serialized, cancellable and does not inherit provider keys', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlcd-test-'));
  const worker = path.join(directory, 'fake-worker.cjs');
  const served = path.join(directory, 'served');
  await writeFile(worker, `
const fs=require('node:fs'),readline=require('node:readline');
const args=process.argv.slice(2),get=flag=>args[args.indexOf(flag)+1],mode=get('--model');
if(process.env.CEREBRAS_API_KEY||process.env.JEV_KEY||process.env.TYPESAFE_API_KEY)process.exit(4);
console.log(JSON.stringify({type:'ready'}));
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{const request=JSON.parse(line);fs.appendFileSync(${JSON.stringify(served)},String(process.pid)+'\\n');
  const parsed=Object.fromEntries(Object.entries(request.schema).map(([name,field])=>[name,{value:field.type==='boolean'?false:field.choices[0],prob:.8}]));
  const result={mode:'parallel_constrained_calibrated',elapsed_ms:12,prefill_ms:9,suffix_eval_ms:1,sequential_forward_passes:1,is_valid_json:true,schema_match:true,parsed_json:parsed,field_telemetry:{},num_fields:Object.keys(request.schema).length,collision_fields:[]};
  setTimeout(()=>console.log(JSON.stringify({id:request.id,ok:true,result})),mode==='busy'?180:0);
});
`);
  const config = { python: process.execPath, worker, source: directory, weights: 'busy' };
  const runtime = await createDemoRuntime({ rlcd: config });
  const i = input('screen');
  try {
    assert.equal(runtime.config().model, 'qwen-2.5-1.5b-rlcd');
    assert.deepEqual(runtime.config().availableModels, ['qwen-2.5-1.5b-rlcd']);
    const first = runtime.run(i, new AbortController().signal);
    const second = runtime.run(i, new AbortController().signal);
    const queuedAbort = new AbortController();
    const queued = runtime.run(i, queuedAbort.signal); queuedAbort.abort();
    assert.equal((await queued).status, 504);
    assert.deepEqual([(await first).status, (await second).status], [200, 200]);
    const firstPids = (await readFile(served, 'utf8')).trim().split('\n');
    assert.deepEqual(firstPids.length, 2); assert.equal(firstPids[0], firstPids[1]);
    const activeAbort = new AbortController();
    const active = runtime.run(i, activeAbort.signal);
    let activePid = 0;
    for (let n = 0; n < 100 && !activePid; n++) {
      const lines = (await readFile(served, 'utf8')).trim().split('\n');
      if (lines.length === 3) activePid = Number(lines[2]); else await delay(5);
    }
    assert.ok(activePid); activeAbort.abort(); assert.equal((await active).status, 504);
    let alive = true;
    for (let n = 0; n < 100 && alive; n++) { try { process.kill(activePid, 0); await delay(5); } catch { alive = false; } }
    assert.equal(alive, false);
    assert.equal((await runtime.run(i, new AbortController().signal)).status, 200);
    const allPids = (await readFile(served, 'utf8')).trim().split('\n');
    assert.notEqual(allPids.at(-1), firstPids[0], 'Canceled inference replaces the worker');
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
