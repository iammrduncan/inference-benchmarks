import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createDemoRuntime } from '../lib/runtime';
import { scenes, workItem, fixtureValues } from '../lib/theater/data';
import { theaterPlan, theaterDecision } from '../lib/theater/contracts';
import { navigationContext, exits, fixtureNext } from '../lib/theater/navigation';
import { DrivingEngine, drivingContext } from '../lib/theater/driving';
import { localRequest } from '../lib/request';
import { shuffledWorkload, requestTotals } from '../lib/theater/workload';
import { demoModel } from '../lib/models';
import { homeWorkItem } from '../lib/theater/home';

test('selected model survives every demo path and unknown models never reach inference',async()=>{
  const runtime=await createDemoRuntime({stub:true});
  try{
    for(const model of demoModel.options){
      const inputs=[
        {id:'home',text:JSON.stringify(homeWorkItem(0).context)},
        ...(['dispatch','screen','approve','judge'] as const).map(id=>({id,text:JSON.stringify(workItem(id,1).context)})),
        {id:'navigate',text:JSON.stringify({position:20,target:4,visited:[20]})},
        {id:'drive',text:JSON.stringify(new DrivingEngine().state)},
      ];
      for(const input of inputs){
        const response=await runtime.run({...input,model},new AbortController().signal);
        assert.equal(response.status,200,JSON.stringify(response.body));
        const result=z.object({model:demoModel,contract:z.object({model:demoModel}),estimatedCostUsd:z.number()}).parse(response.body);
        assert.equal(result.model,model);assert.equal(result.contract.model,model);assert.equal(result.estimatedCostUsd,0);
      }
    }
    const before=runtime.config().calls;
    assert.equal((await runtime.run({id:'home',model:'unknown',text:JSON.stringify(homeWorkItem(0).context)},new AbortController().signal)).status,400);
    assert.equal(runtime.config().calls,before);
    const defaultResponse=await runtime.run({id:'home',text:JSON.stringify(homeWorkItem(0).context)},new AbortController().signal);
    assert.equal(z.object({model:demoModel}).parse(defaultResponse.body).model,'qwen-3.8-27b');
  }finally{await runtime.close();}
});

test('bulk dispatch shuffles a complete workload without changing its input-to-label pairing',()=>{
  for(const scene of ['dispatch','screen','approve','judge'] as const){
    const original=Array.from({length:100},(_,i)=>workItem(scene,i));
    const shuffled=shuffledWorkload(scene,()=>0.37);
    assert.equal(new Set(shuffled.map(item=>item.id)).size,100);
    assert.notDeepEqual(shuffled.map(item=>item.id),original.map(item=>item.id));
    assert.notDeepEqual(shuffled.map(item=>item.id),shuffledWorkload(scene,()=>0.72).map(item=>item.id));
    assert.deepEqual([...shuffled].sort((a,b)=>a.id.localeCompare(b.id)),original);
  }
});
test('demo inputs include permitted commands, attacks and a full range of weighted partial credit',()=>{
  for(const scene of ['screen','approve'] as const){
    const expected=Array.from({length:100},(_,i)=>fixtureValues(scene,i)[0]);
    assert.equal(expected.filter(v=>v===0).length,50);assert.equal(expected.filter(v=>v===1).length,50);
    assert.equal(new Set(Array.from({length:100},(_,i)=>workItem(scene,i).title)).size,20);
  }
  const scores=new Set(Array.from({length:100},(_,i)=>fixtureValues('judge',i)[0]));
  assert.deepEqual([...scores].sort((a,b)=>(a??0)-(b??0)),Array.from({length:11},(_,i)=>i*10));
  const pairs=Array.from({length:100},(_,i)=>{const item=workItem('judge',i);assert.ok(!JSON.stringify(item.context).includes('expected'));return JSON.stringify([item.context.golden,item.context.candidate]);});
  assert.equal(new Set(pairs).size,100);
  const invalid={...workItem('judge',1).context,criteria:[{requirement:'Any answer',points:200}]};
  assert.throws(()=>theaterPlan('judge',JSON.stringify(invalid)));
});
test('average request cost uses reported usage and never treats missing usage as free',()=>{
  const a={data:{usage:{input_tokens:100,output_tokens:10},estimatedCostUsd:0.00012}};
  const b={data:{usage:{input_tokens:200,output_tokens:20},estimatedCostUsd:0.00024}};
  const measured=requestTotals([a,{},b,{}]);
  assert.equal(measured.measuredRequests,2);assert.equal(measured.input,300);assert.equal(measured.output,30);
  assert.ok(Math.abs((measured.averageCostUsd??0)-0.00018)<1e-12);
  assert.equal(requestTotals([{}]).averageCostUsd,null);
  assert.equal(requestTotals([{data:{...a.data,estimatedCostUsd:0}}]).averageCostUsd,0);
});

test('four 100-item workloads complete through the real proxy at concurrency five',async()=>{
  const runtime=await createDemoRuntime({stub:true});
  try{for(const id of ['dispatch','screen','approve','judge'] as const){
    assert.equal(scenes.find(s=>s.id===id)?.count,100);
    for(let offset=0;offset<100;offset+=5)await Promise.all(Array.from({length:5},async(_,j)=>{
      const index=offset+j,item=workItem(id,index);assert.ok(!Object.hasOwn(item.context,'expected'));
      const response=await runtime.run({id,text:JSON.stringify(item.context)},new AbortController().signal);assert.equal(response.status,200,JSON.stringify(response.body));
      const body=z.object({decision:z.record(z.string(),z.unknown()),providerCalls:z.number()}).parse(response.body);assert.equal(body.providerCalls,1);
      if(id==='judge'){assert.equal(body.decision.accuracy,fixtureValues(id,index)[0]);assert.equal(body.decision.valid,fixtureValues(id,index)[1]===1);}
      else if(id!=='dispatch')assert.equal(body.decision.decision,fixtureValues(id,index)[0]===1?'block':'allow');
    }));
  }assert.equal(runtime.config().calls,400);}finally{await runtime.close();}
});
test('navigation passes the full structured graph and never accepts closed edges',()=>{
  let state={position:20,target:4,visited:[20]};
  const context=navigationContext(state);assert.equal(context.streetGraph.length,25);assert.ok(context.closedRoads.length>0);
  assert.throws(()=>theaterDecision('navigate',JSON.stringify({position:6,target:4,visited:[6]}),{move:'east'}));
  for(let i=0;i<24&&state.position!==state.target;i++){const next=fixtureNext(state);assert.ok(exits(state.position).some(n=>n.to===next));state={...state,position:next,visited:[...state.visited,next]};}
  assert.equal(state.position,4);
  assert.throws(()=>theaterPlan('navigate','{"position":30,"target":0,"visited":[]}'));
});
test('driving advances real elapsed time, ends at ten seconds and ignores late actions',()=>{
  const engine=new DrivingEngine();engine.start(1000);engine.apply({steer:'straight',throttle:'accelerate'},1000);engine.tick(3000);
  assert.equal(engine.state.elapsedMs,2000);assert.ok(engine.state.distance>15);
  const sensors=drivingContext(engine.state);assert.equal(sensors.lookahead.length,3);assert.ok(sensors.obstacles.length>0);
  engine.tick(12000);assert.equal(engine.state.elapsedMs,10000);assert.equal(engine.running,false);const final={...engine.state},control={...engine.control};
  engine.apply({steer:'left',throttle:'brake'},13000);engine.tick(20000);assert.deepEqual(engine.state,final);assert.deepEqual(engine.control,control);
  engine.start(20000);engine.tick(20500);engine.stop(20600);assert.equal(engine.state.elapsedMs,600);engine.tick(22000);assert.equal(engine.state.elapsedMs,600);
});
test('theater outputs reject prose, extra fields, invalid scores and unsupported controls',()=>{
  assert.throws(()=>theaterDecision('screen','{}',{decision:'allow',reason:'leaked'}));
  assert.throws(()=>theaterDecision('approve','{}',{decision:'execute'}));
  assert.throws(()=>theaterDecision('judge','{}',{accuracy:101,valid:true}));
  assert.throws(()=>theaterDecision('judge','{}',{accuracy:99.5,valid:true}));
  assert.throws(()=>theaterDecision('drive','{}',{steer:'teleport',throttle:'accelerate'}));
});
test('secure tailnet origin is exact and foreign origins remain forbidden',()=>{
  const host='josephs-macbook-pro.taila9c138.ts.net';const make=(origin:string)=>new Request(`https://${host}/api/decide`,{method:'POST',headers:{host,origin,'content-type':'application/json'},body:'{}'});
  assert.equal(localRequest(make(`https://${host}`),true,'100.127.125.114',host),true);
  assert.equal(localRequest(make(`http://${host}`),true,'100.127.125.114',host),false);
  assert.equal(localRequest(make('https://evil.test'),true,'100.127.125.114',host),false);
});

test('paired Qwen and Jev workloads share inputs and fit the shared admission limit',async()=>{
  const runtime=await createDemoRuntime({stub:true});
  const workload=shuffledWorkload('dispatch',()=>0.5).slice(0,8);
  const order:Record<string,string[]>={};
  try{
    await Promise.all((['qwen-3.8-27b','jev-latest'] as const).map(async model=>{
      let next=0; const seen:string[]=[]; order[model]=seen;
      await Promise.all(Array.from({length:2},async()=>{
        while(next<workload.length){
          const item=workload[next++]; assert.ok(item); seen.push(item.id);
          const result=await runtime.run({id:'dispatch',model,text:JSON.stringify(item.context)},new AbortController().signal);
          assert.equal(result.status,200,JSON.stringify(result.body));
          assert.equal(z.object({model:demoModel}).parse(result.body).model,model);
        }
      }));
    }));
    assert.deepEqual(order['qwen-3.8-27b'],workload.map(item=>item.id));
    assert.deepEqual(order['jev-latest'],order['qwen-3.8-27b']);
    assert.equal(runtime.config().calls,16);
  }finally{await runtime.close();}
});
