'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { scenes, type SceneId, type WorkItem } from '../../lib/theater/data';
import { shuffledWorkload, requestTotals } from '../../lib/theater/workload';
import { navigationContext, type NavigationState } from '../../lib/theater/navigation';
import { DrivingEngine, driveDecision, drivingContext } from '../../lib/theater/driving';
import { initialHome, homeDecision, homeInput, applyHome } from '../../lib/theater/home';
import { passesThreshold } from '../../lib/theater/judge';
import { demoModel, defaultModel, type DemoModel } from '../../lib/models';
const configSchema=z.object({token:z.string(),mode:z.enum(['fixture','live']),model:demoModel,availableModels:z.array(demoModel)});
const resultSchema=z.object({model:demoModel,decision:z.record(z.string(),z.unknown()),elapsedMs:z.number().finite(),usage:z.object({input_tokens:z.number().nonnegative(),output_tokens:z.number().nonnegative()}).nullable(),nativeMetrics:z.object({prefillTokensPerSecond:z.number().finite().nonnegative(),decodeTokensPerSecond:z.number().finite().nonnegative(),peakRamMb:z.number().finite().nonnegative()}).optional(),rlcdMetrics:z.object({engineElapsedMs:z.number().finite().nonnegative(),prefillMs:z.number().finite().nonnegative(),suffixEvalMs:z.number().finite().nonnegative(),sequentialForwardPasses:z.number().int().positive(),fieldCount:z.number().int().positive(),collisionFields:z.array(z.string())}).optional(),reportedFieldScores:z.record(z.string(),z.object({value:z.union([z.string(),z.number(),z.boolean()]),reportedProbability:z.number().min(0).max(1),collision:z.boolean()})).optional(),costNote:z.string().optional(),usageNote:z.string().optional(),estimatedCostUsd:z.number().nonnegative().nullable(),contract:z.unknown(),providerModel:z.string().optional(),nativeAnswers:z.record(z.string(),z.unknown()).optional(),mappingVersion:z.string().optional(),providerCalls:z.number().int().positive().optional(),questionCount:z.number().int().positive().optional(),route:z.string().optional(),booleanThreshold:z.object({comparison:z.string(),value:z.number()}).optional()});
export type DecisionResult=z.infer<typeof resultSchema>;
export type PlayerEvent={id:number;scene:SceneId;item:WorkItem;input:unknown;status:'pending'|'validated'|'failed'|'canceled';sentAt:string;elapsedMs?:number;settledMs?:number;data?:DecisionResult;error?:string;httpStatus?:number};
export type SceneRun={scene:SceneId;model:DemoModel;elapsedMs:number;concurrency:number;events:PlayerEvent[];car?:DrivingEngine['state']};
export function usePlayer(initialModel?: DemoModel){
  const [config,setConfig]=useState<z.infer<typeof configSchema>>();const [connectionError,setConnectionError]=useState('');
  const [home,setHome]=useState({...initialHome});
  const [scoreThreshold,setScoreThreshold]=useState(90);
  const [model,setModel]=useState<DemoModel>(initialModel ?? defaultModel);
  const [scene,setScene]=useState<SceneId>('dispatch');const currentScene=useRef<SceneId>('dispatch');const [events,setEvents]=useState<PlayerEvent[]>([]);const [running,setRunning]=useState(false);const [playlist,setPlaylist]=useState(false);const [concurrency,setConcurrency]=useState(initialModel ? 2 : 5);const [elapsedMs,setElapsedMs]=useState(0);const [note,setNote]=useState('Ready when you are.');
  const [navigation,setNavigation]=useState<NavigationState>({position:20,target:4,visited:[20]});const navSetup=useRef({start:20,target:4});
  const engine=useRef(new DrivingEngine()).current;const [car,setCar]=useState({...engine.state});
  const [gpu,setGpu]=useState('loading');const gpuRef=useRef('loading');const onGpu=useCallback((status:string)=>{gpuRef.current=status;setGpu(status);},[]);
  const control=useRef<AbortController|null>(null);const started=useRef(0);const nextId=useRef(1);const archive=useRef<SceneRun[]>([]);
  useEffect(()=>{const abort=new AbortController();void fetch('/api/config',{signal:abort.signal}).then(async r=>{if(!r.ok)throw new Error('Unavailable');const next=configSchema.parse(await r.json());setConfig(next);setModel(initialModel && next.availableModels.includes(initialModel) ? initialModel : next.model);}).catch(()=>{if(!abort.signal.aborted)setConnectionError('Connection unavailable. Reload after checking the demo server.');});return()=>{abort.abort();control.current?.abort();engine.stop(performance.now());};},[engine,initialModel]);
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>{setElapsedMs(performance.now()-started.current);if(scene==='drive')setCar({...engine.tick(performance.now())});},60);return()=>clearInterval(timer);},[running,scene,engine]);
  async function play(all:boolean, sharedWorkload?: readonly WorkItem[]){
    if(!config||!config.availableModels.includes(model)||control.current)return;
    const connection=config;const abort=new AbortController();control.current=abort;archive.current=[];setPlaylist(all);
    const sequence=all?scenes.map(s=>s.id):[scene];
    try{for(const id of sequence){if(abort.signal.aborted)break;
      if(id==='drive'&&currentScene.current!=='drive'){gpuRef.current='loading';setGpu('loading');}currentScene.current=id;
      setScene(id);setEvents([]);setElapsedMs(0);setNote('Starting…');started.current=performance.now();setRunning(true);const rows:PlayerEvent[]=[];let stopReason='';
      const request=async(item:WorkItem,signal:AbortSignal=abort.signal)=>{
        const event:PlayerEvent={id:nextId.current++,scene:id,item,input:id==='navigate'?navigationContext(z.object({position:z.number(),target:z.number(),visited:z.array(z.number())}).parse(item.context)):id==='drive'?drivingContext(z.object({x:z.number(),z:z.number(),speed:z.number(),collisions:z.number(),distance:z.number(),elapsedMs:z.number()}).parse(item.context)):item.context,status:'pending',sentAt:new Date().toISOString()};rows.push(event);setEvents([...rows]);const begin=performance.now();
        try{const r=await fetch('/api/decide',{method:'POST',signal,headers:{'content-type':'application/json','x-demo-token':connection.token},body:JSON.stringify({id,model,text:JSON.stringify(item.context)})});const raw:unknown=await r.json();event.httpStatus=r.status;
          if(signal.aborted)throw new Error('Canceled');if(!r.ok){const error=z.object({error:z.string(),code:z.string().optional()}).safeParse(raw);event.status='failed';event.error=error.success?error.data.error:`HTTP ${r.status}`;
            if(r.status===429)stopReason='Rate limit reached. Retry later. No automatic retries.';
            else if(error.success&&error.data.code==='provider_authentication_failed')stopReason=event.error;
            else if(r.status===401||r.status===403)stopReason='Demo session rejected. Reload the page before trying again.';
            if(stopReason)setNote(`${stopReason} Waiting for in-flight requests.`);
          }else{const result=resultSchema.parse(raw);if(result.model!==model)throw new Error('Unexpected response model');event.data=result;event.status='validated';}
        }catch{event.status=signal.aborted?'canceled':'failed';event.error=signal.aborted?'Canceled. No action applied.':'Request failed. No action applied.';}
        event.elapsedMs=performance.now()-begin;event.settledMs=performance.now()-started.current;setEvents([...rows]);return event;
      };
      if(id==='home'){
        let state={...initialHome};setHome(state);setNote('One command at a time. Each request sees the latest home state.');
        for(const item of sharedWorkload ?? shuffledWorkload('home')){
          if(abort.signal.aborted)break;
          const command=homeInput.parse(item.context);
          const result=await request({...item,context:{...command,state:{...state}}});
          if(result.status!=='validated'||abort.signal.aborted)break;
          state=applyHome(state,homeDecision.parse(result.data?.decision));setHome(state);
        }
        setNote(`${rows.filter(e=>e.data?.decision.action==='apply').length} applied / ${rows.filter(e=>e.data?.decision.action==='clarify').length} need clarification · simulated devices`);
      }else if(id==='navigate'){
        let nav:NavigationState={position:navSetup.current.start,target:navSetup.current.target,visited:[navSetup.current.start]};setNavigation(nav);setNote('Navigating the street graph one decision at a time.');const visits=new Map<number,number>();
        for(let step=0;step<24&&!abort.signal.aborted&&nav.position!==nav.target;step++){
          const result=await request({id:`HOP-${step+1}`,title:`Junction ${nav.position} → ${nav.target}`,context:nav});if(result.status!=='validated')break;
          const next=z.object({next:z.number().int().min(0).max(24)}).parse(result.data?.decision).next;
          nav={...nav,position:next,visited:[...nav.visited,next]};setNavigation(nav);visits.set(next,(visits.get(next)??0)+1);if((visits.get(next)??0)>=3)break;
        }setNote(nav.position===nav.target?'Destination reached. Every hop was a model decision.':'Route stopped: inspect the selected hops.');
      }else if(id==='drive'){
        const readyDeadline=performance.now()+20000;
        while(gpuRef.current==='loading'&&!abort.signal.aborted&&performance.now()<readyDeadline)await new Promise(resolve=>setTimeout(resolve,50));
        if(gpuRef.current!=='ready'){setNote(gpuRef.current==='loading'?'WebGPU did not become ready.':gpuRef.current);}
        else if(!abort.signal.aborted){started.current=performance.now();engine.start(started.current);setNote('Live steering and throttle from validated decisions.');setCar({...engine.state});const driveAbort=new AbortController();const signal=AbortSignal.any([abort.signal,driveAbort.signal]);const timer=setTimeout(()=>driveAbort.abort(),10000);
          let step=0;try{while(!signal.aborted&&!stopReason&&engine.tick(performance.now()).elapsedMs<10000){const state={...engine.state};const result=await request({id:`DRV-${++step}`,title:`Drive tick ${step}`,context:state},signal);if(result.status==='validated'&&!signal.aborted)engine.apply(driveDecision.parse(result.data?.decision),performance.now());}}finally{clearTimeout(timer);engine.stop(performance.now());setCar({...engine.state});}setNote(`${(engine.state.elapsedMs/1000).toFixed(2)} seconds · ${engine.state.distance.toFixed(0)} m · ${engine.state.collisions} collisions`);}
      }else{const workload=sharedWorkload ?? shuffledWorkload(id);let next=0;setNote('Shuffled requests arriving at inference speed.');const worker=async()=>{while(!abort.signal.aborted&&!stopReason&&next<workload.length){const item=workload[next++];if(item)await request(item);}};await Promise.all(Array.from({length:concurrency},worker));setNote(`${rows.filter(e=>e.status==='validated').length} validated / ${rows.length} dispatched · shuffled`);}
      const duration=performance.now()-started.current;setElapsedMs(duration);setRunning(false);archive.current.push({scene:id,model,elapsedMs:duration,concurrency:id==='navigate'||id==='drive'||id==='home'?1:concurrency,events:rows,...(id==='drive'?{car:{...engine.state}}:{})});
      if(stopReason){setNote(`Run stopped after ${rows.length} requests. ${stopReason}`);break;}
      if(all&&!abort.signal.aborted&&id!==sequence.at(-1)){setNote(n=>`${n} · next scene…`);await new Promise(resolve=>setTimeout(resolve,1200));}
    }}finally{control.current=null;setRunning(false);setPlaylist(false);if(abort.signal.aborted)setNote('Stopped. No further requests will be dispatched.');}
  }
  function select(id:SceneId){if(control.current||currentScene.current===id)return;currentScene.current=id;setScene(id);setEvents([]);setElapsedMs(0);setNote('Ready when you are.');if(id==='home')setHome({...initialHome});if(id==='drive'){gpuRef.current='loading';setGpu('loading');}}
  function target(node:number){if(control.current)return;navSetup.current.target=node;setNavigation({position:navSetup.current.start,target:node,visited:[navSetup.current.start]});}
  function selectModel(value:string){const selected=demoModel.safeParse(value);if(control.current||!selected.success||!config?.availableModels.includes(selected.data)||selected.data===model)return;setModel(selected.data);setEvents([]);setHome({...initialHome});setElapsedMs(0);archive.current=[];setNote('Model changed. Ready for a new run.');}
  function download(){const payload={generatedAt:new Date().toISOString(),model:archive.current[0]?.model,mode:config?.mode,datasetVersion:3,mappingVersion:model==='needle-3'?'needle-scenes-v2':model==='qwen-2.5-1.5b-rlcd'?'rlcd-scenes-v2':model==='jev-latest'?'jev-scenes-v1':'cerebras-schema-v1',runs:archive.current.map(run=>({...run,requestOrder:run.events.map(e=>e.item.id),totals:requestTotals(run.events),...(run.scene==='judge'?{validityPolicy:{threshold:scoreThreshold,comparison:'strictly greater than',validAnswers:run.events.filter(e=>typeof e.data?.decision.accuracy==='number'&&passesThreshold(e.data.decision.accuracy,scoreThreshold)).length}}:{})})),costNote:'Reported usage with dated list-price estimates where configured. Jev uses account-owner pricing supplied 2026-09-17: $0.04/M input, free output. Local Needle and RLCD runs have zero API fees; hardware/electricity are excluded and unavailable token counts remain null. Average cost divides known cost by priced requests; failed/canceled calls are excluded and may still be billed.',timingNote:'Scene measurement excludes the 1.2-second slideshow transition; driving playtime comes from its monotonic 10-second engine clock.'};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='decision-theater.json';a.click();URL.revokeObjectURL(url);}
  return{config,connectionError,home,scoreThreshold,setScoreThreshold,model,selectModel,scene,events,running,playlist,concurrency,setConcurrency,elapsedMs,note,navigation,target,engine,car,gpu,onGpu,play,select,stop:()=>control.current?.abort(),download};
}
export type PlayerState=ReturnType<typeof usePlayer>;
