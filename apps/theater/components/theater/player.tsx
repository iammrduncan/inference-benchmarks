'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { scenes, workItem } from '../../lib/theater/data';
import { requestTotals } from '../../lib/theater/workload';
import { usePlayer } from './use-player';
import { SceneVisual } from './visuals';
import { JsonCode } from './json-code';
import { demoModel, models, providerName, priceLabel } from '../../lib/models';
import { ContractDialog } from './contract-dialog';
import { contractSnapshot, type ContractSnapshot } from '../../lib/theater/contract-view';
import './theater.css';
import { ComparisonPlayer } from './comparison-player';
export function DemoPlayer(){
  const [compare,setCompare]=useState(true);
  return compare ? <ComparisonPlayer onSingle={()=>setCompare(false)}/> : <><button className="comparison-return" onClick={()=>setCompare(true)}>← Side-by-side comparison</button><SinglePlayer/></>;
}
function SinglePlayer(){
  const shell=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    // Browser chrome/fullscreen transitions can leave viewport units larger than
    // the visible area. Size the player from the current visual viewport too.
    const fit=()=>shell.current?.style.setProperty('--theater-height',`${Math.min(window.innerHeight,window.visualViewport?.height??window.innerHeight)}px`);
    fit();window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);
    return()=>{window.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('resize',fit);};
  },[]);
  const p=usePlayer();const [pinned,setPinned]=useState<number>();const current=scenes.find(s=>s.id===p.scene)??scenes[0];const index=scenes.indexOf(current);const locked=p.running||p.playlist;
  const [contract,setContract]=useState<ContractSnapshot>();
  const settled=p.events.filter(e=>e.status!=='pending').sort((a,b)=>(a.settledMs??0)-(b.settledMs??0));const done=settled.filter(e=>e.data);const pinnedEvent=p.events.find(e=>e.id===pinned);const focus=pinnedEvent??settled.at(-1)??p.events.at(-1);
  useEffect(()=>{shell.current?.querySelectorAll('pre.theater-code').forEach(element=>{element.scrollTop=0;});},[focus?.id]);
  const totals=requestTotals(p.events);
  const preview=p.scene==='navigate'?{position:20,target:4,streetGraph:'25 junctions + closures + travel costs'}:p.scene==='drive'?{sensors:'position, speed, lane offset, road lookahead, obstacles'}:workItem(p.scene,0).context;
  const progress=p.scene==='drive'?p.car.elapsedMs/10000:current.count?settled.length/current.count:0;
  function openContract(){
    const context=focus?.item.context??(p.scene==='navigate'?p.navigation:p.scene==='drive'?p.car:workItem(p.scene,0).context);
    setContract(contractSnapshot({scene:focus?.scene??p.scene,model:p.model,context,
      ...(focus?{requestId:focus.item.id}:{}),...(focus?.data?{recorded:focus.data.contract}:{}),scoreThreshold:p.scoreThreshold}));
  }
  return <div ref={shell} className="theater-shell"><header className="theater-top"><Link href="/" className="theater-brand"><i>↗</i> typesafe benchmark<span>/ typed intelligence</span></Link><div className="theater-connection"><i/><label className="model-picker"><span>{p.config?.mode==='live'?providerName(p.model):p.config?'FIXTURES / NO INFERENCE':'CONNECTING'}</span><select aria-label="Inference model" value={p.model} disabled={!p.config||locked} onChange={e=>p.selectModel(e.target.value)}>{demoModel.options.map(model=><option key={model} value={model} disabled={!p.config?.availableModels.includes(model)}>{models[model].label}</option>)}</select><small className="model-pricing" title="USD per million input / output tokens. List-price estimate; cache discounts excluded.">{priceLabel(p.model)}</small></label></div><button onClick={p.download} disabled={locked||!settled.length}>Export session ↗</button></header>
    <nav className="scene-tabs" aria-label="Demo scenes">{scenes.map((s,i)=><button key={s.id} aria-current={p.scene===s.id?'page':undefined} disabled={locked} onClick={()=>{setPinned(undefined);p.select(s.id);}}><small>0{i+1}</small>{s.short}{p.scene===s.id&&<i/>}</button>)}</nav>
    <section className="theater-title"><div><div className="theater-scene-meta"><p>{current.kicker}</p><button className="view-contract" type="button" aria-haspopup="dialog" onClick={openContract}>View the contract ↗</button></div><h1>{current.name}</h1><span>{current.detail}</span></div><div className="theater-controls"><label>STREAM SIZE<select aria-label="Concurrent requests" disabled={locked||p.scene==='navigate'||p.scene==='drive'||p.scene==='home'} value={p.scene==='navigate'||p.scene==='drive'||p.scene==='home'?1:p.concurrency} onChange={e=>p.setConcurrency(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n===1?'Single stream':`${n} in parallel`}</option>)}</select></label><button className="play-scene" disabled={!p.config||locked} onClick={()=>{setPinned(undefined);void p.play(false);}}>▶ Play scene</button><button className="play-all" disabled={!p.config||locked} onClick={()=>{setPinned(undefined);void p.play(true);}}>▶ Play all {scenes.length}</button><button className="stop-show" disabled={!locked} onClick={p.stop}>■ Stop</button></div></section>
    <div className="theater-workspace"><aside className="theater-stream input-stream"><div className="stream-heading"><span>01 / INPUTS</span><b>{p.events.length} SENT</b></div><div className="code-heading">{focus?.item.id??'CONTEXT PREVIEW'}{pinnedEvent&&<b>PINNED</b>}</div><pre id="theater-input" className="theater-code"><JsonCode value={focus?.input??preview}/></pre><div className="theater-feed" aria-label="Input stream">{p.events.length?p.events.toReversed().slice(0,100).map(e=><button key={e.id} onClick={()=>setPinned(e.id)} className={`${e.status} ${focus?.id===e.id?'selected':''}`}><i/><div><b>{e.item.id}</b><span>{e.item.title}</span></div><small>{e.status==='pending'?'…':`${e.elapsedMs?.toFixed(0)}ms`}</small></button>):<div className="stream-idle"><span>↳</span>Context in.<br/>Decisions out.<small>Press play to start live requests.</small></div>}</div></aside>
    <section className="theater-center" aria-label="Active demo"><div className="scene-visual" key={p.scene}><SceneVisual player={p} selectedId={pinnedEvent?.id} onSelect={setPinned}/></div><div className="scene-progress"><i style={{width:`${Math.min(100,progress*100)}%`}}/></div><div className="scene-status" role="status"><span className={p.running?'running-dot':''}/>{p.connectionError||p.note}<b>{p.scene==='drive'?`${(p.car.elapsedMs/1000).toFixed(1)} / 10 s`:`${settled.length} / ${current.count}`}</b></div></section>
    <aside className="theater-stream output-stream"><div className="stream-heading"><span>03 / TYPED RETURNS</span><button onClick={()=>setPinned(undefined)}>Follow live ↗</button></div><div className="code-heading">{focus?.item.id??'WAITING'}<b>{focus?.status==='validated'?'✓ VALIDATED':focus?.status??'STRICT OUTPUT'}</b></div><pre id="theater-output" className="theater-code result-code">{focus?.data?<JsonCode value={focus.data.decision}/>:focus?.error??(focus?.status==='pending'?'// Request in flight.\n// Waiting for a validated decision.':'// Only complete, validated\n// decisions cross this boundary.')}</pre><div className="theater-feed return-feed" aria-label="Output stream">{settled.toReversed().slice(0,100).map(e=><button key={e.id} onClick={()=>setPinned(e.id)} className={`${e.status} ${focus?.id===e.id?'selected':''}`}><div><b>{e.item.id}<small>{e.elapsedMs?.toFixed(0)} ms</small></b><code>{e.data?JSON.stringify(e.data.decision):e.error}</code></div></button>)}</div></aside></div>
    <div className="theater-metrics">{[['VALIDATED',`${done.length} / ${p.events.length}`],['WALL TIME',`${(p.elapsedMs/1000).toFixed(2)}s`],['DECISIONS / SEC',p.elapsedMs?(done.length/(p.elapsedMs/1000)).toFixed(1):'—'],['INPUT / OUTPUT TOKENS',totals.unmeasuredRequests?'Not reported':`${totals.input.toLocaleString()} / ${totals.output.toLocaleString()}`],['OUTPUT TOKENS / SEC',p.elapsedMs&&!totals.unmeasuredRequests?(totals.output/(p.elapsedMs/1000)).toFixed(1):'—'],['ESTIMATED COST',totals.unpricedRequests?'Unknown':`$${totals.cost.toFixed(5)}`],['AVG / REQUEST',totals.averageCostUsd===null?'—':`$${totals.averageCostUsd.toFixed(6)}`]].map(([label,value])=><div key={label} title={label==='AVG / REQUEST'?`Estimated mean across ${totals.pricedRequests} requests with known pricing. Unknown pricing, pending, failed and canceled requests are excluded.`:undefined}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <footer className="theater-footer"><span>0{index+1} / {String(scenes.length).padStart(2,'0')} · {p.playlist?'AUTO ADVANCE':'SELECT A SCENE OR PLAY THE FULL SHOW'}</span><span>{p.config?.mode==='fixture'?'Synthetic outputs & tokens. ':''}Real elapsed timing. Simulated actions. Types ≠ correctness. Failed-call costs may be unknown.</span></footer>
    {contract&&<ContractDialog snapshot={contract} onClose={()=>setContract(undefined)}/>}
  </div>;
}
