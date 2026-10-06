/* global AbortController, structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { createDemoRuntime } from '../apps/theater/lib/runtime.ts';
import { needleMaxNewTokens } from '../apps/theater/lib/needle-plan.ts';
import { installedNeedle } from '../apps/theater/scripts/needle-paths.mjs';
import { scenes } from '../apps/theater/lib/theater/data.ts';
import { requestTotals } from '../apps/theater/lib/theater/workload.ts';
import { initialHome, homeDecision, applyHome } from '../apps/theater/lib/theater/home.ts';
import { DrivingEngine, driveDecision } from '../apps/theater/lib/theater/driving.ts';

// Live local inference only. Replay the published input order, never expected answers.
// Direct runtime timing includes validation/process startup/inference/cleanup, but no browser or HTTP.
const directory = process.argv[2];
assert.ok(directory, 'Usage: node --import tsx scripts/benchmark-needle.mjs <new-output-directory>');
mkdirSync(directory, { recursive: false });
const needle = installedNeedle();
assert.ok(needle, 'Run npm run setup:needle first');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceFiles = new Set(execFileSync('git', ['ls-files', 'apps/theater/lib', 'apps/theater/needle-release.json', 'scripts/benchmark-needle.mjs', 'package-lock.json'], {encoding:'utf8'}).trim().split('\n'));
sourceFiles.add('scripts/benchmark-needle.mjs');
sourceFiles.add('apps/theater/lib/needle-worker.ts');
writeFileSync(`${directory}/environment.json`, JSON.stringify({ measuredAtUtc:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:{os:os.release(),platform:process.platform,architecture:process.arch,cpu:os.cpus()[0].model,cores:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},configuration:{model:'needle-3',warmupRequests:0,automaticRetries:0,staticConcurrency:2,statefulConcurrency:1,depth:20,maxNewTokensByScene:needleMaxNewTokens,staticWorkersPerSchema:2,workerIdleMs:5000,navigationProcessPerRequest:true,browser:false,http:false},binarySha256:hash(needle.executable),weightsSha256:hash(needle.weights),sourceSha256:Object.fromEntries([...sourceFiles].map(p=>[p,hash(p)]))},null,2)+'\n');
const runtime = await createDemoRuntime({needle});
let nextId=1;
try {
  for (const {id:scene} of scenes) {
    const historical=JSON.parse(readFileSync(`docs/benchmarks/comparison/${scene}-qwen.json`,'utf8')).runs[0];
    const events=[]; const begin=performance.now();
    const request=async(item,signal=new AbortController().signal)=>{
      const event={id:nextId++,scene,item:structuredClone(item),input:structuredClone(item.context),status:'pending',sentAt:new Date().toISOString()};
      events.push(event); const start=performance.now();
      const reply=await runtime.run({id:scene,model:'needle-3',text:JSON.stringify(item.context)},signal);
      event.httpStatus=reply.status;
      if(signal.aborted){event.status='canceled';event.error='Canceled at driving deadline. No action applied.';}
      else if(reply.status===200){assert.equal(reply.body.model,'needle-3');event.status='validated';event.data=reply.body;}
      else {event.status='failed';event.error=reply.body.error;event.failure=reply.body;}
      event.elapsedMs=performance.now()-start;event.settledMs=performance.now()-begin;
      return event;
    };
    let car;
    if(scene==='navigate') {
      let nav={position:20,target:4,visited:[20]};const visits=new Map();
      for(let step=0;step<24&&nav.position!==nav.target;step++){
        const event=await request({id:`HOP-${step+1}`,title:`Junction ${nav.position} → ${nav.target}`,context:nav});
        if(event.status!=='validated')break;
        const next=event.data.decision.next; nav={...nav,position:next,visited:[...nav.visited,next]};
        visits.set(next,(visits.get(next)??0)+1);if(visits.get(next)>=3)break;
      }
    } else if(scene==='home') {
      let state={...initialHome};
      for(const old of historical.events){const event=await request({...old.item,context:{...old.item.context,state:{...state}}});if(event.status!=='validated')break;state=applyHome(state,homeDecision.parse(event.data.decision));}
    } else if(scene==='drive') {
      const engine=new DrivingEngine();engine.start(performance.now());
      const abort=new AbortController();const deadline=setTimeout(()=>abort.abort(),10000);
      const tick=setInterval(()=>engine.tick(performance.now()),60);
      try{let step=0;while(!abort.signal.aborted&&engine.tick(performance.now()).elapsedMs<10000){const event=await request({id:`DRV-${++step}`,title:`Drive tick ${step}`,context:{...engine.state}},abort.signal);if(event.status==='validated'&&!abort.signal.aborted)engine.apply(driveDecision.parse(event.data.decision),performance.now());}}
      finally{clearTimeout(deadline);clearInterval(tick);engine.stop(performance.now());car={...engine.state};}
    } else {
      let next=0;
      const worker=async()=>{while(next<historical.events.length)await request(historical.events[next++].item);};
      await Promise.all([worker(),worker()]);
    }
    const run={scene,model:'needle-3',elapsedMs:performance.now()-begin,concurrency:['navigate','drive','home'].includes(scene)?1:2,events,...(car?{car}:{}),requestOrder:events.map(e=>e.item.id),totals:requestTotals(events)};
    writeFileSync(`${directory}/${scene}-needle.json`,JSON.stringify({generatedAt:new Date().toISOString(),model:'needle-3',mode:'live',datasetVersion:3,mappingVersion:'needle-scenes-v2',measurement:'Direct demo runtime; no browser/HTTP. Two reset workers for static schemas, fresh native process for navigation. Schema-sized response caps; no warmups, retries or fallback.',runs:[run]},null,2)+'\n');
    process.stdout.write(`${scene}: ${events.filter(e=>e.status==='validated').length}/${events.length} validated, ${(run.elapsedMs/1000).toFixed(2)}s\n`);
  }
} finally {await runtime.close();}
