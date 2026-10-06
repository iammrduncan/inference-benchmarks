'use client';
import { useRef, useState } from 'react';
import { scenes, workItem, type SceneId } from '../../lib/theater/data';
import { requestTotals, shuffledWorkload } from '../../lib/theater/workload';
import { models, demoModel, providerName, priceLabel } from '../../lib/models';
import { contractSnapshot, type ContractSnapshot } from '../../lib/theater/contract-view';
import { usePlayer, type PlayerState } from './use-player';
import { SceneVisual } from './visuals';
import { JsonCode } from './json-code';
import { ContractDialog } from './contract-dialog';

export function ComparisonPlayer({ onSingle }: { onSingle: () => void }) {
  const left = usePlayer('qwen-3.8-27b');
  const right = usePlayer('jev-latest');
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const [generation, setGeneration] = useState(0);
  const current = scenes.find(s => s.id === left.scene) ?? scenes[0];
  const configured = [left, right].every(p => p.config?.availableModels.includes(p.model));
  const ready = configured && (left.scene !== 'drive' || [left,right].every(p => p.gpu === 'ready'));
  function select(scene: SceneId) {
    if (busy.current) return;
    left.select(scene); right.select(scene); setGeneration(n => n + 1);
  }
  async function run() {
    if (busy.current || !ready) return;
    busy.current = true; setRunning(true); setGeneration(n => n + 1);
    // Share input order, not a per-response barrier: each provider runs at its own
    // speed. Independent engines preserve feedback in home, routing and driving.
    const workload = shuffledWorkload(left.scene);
    try { await Promise.all([left.play(false, workload), right.play(false, workload)]); }
    finally { busy.current = false; setRunning(false); }
  }
  function target(node: number) { if (!busy.current) { left.target(node); right.target(node); } }
  function threshold(value: Parameters<PlayerState['setScoreThreshold']>[0]) { left.setScoreThreshold(value); right.setScoreThreshold(value); }
  return <main className="theater-shell comparison-shell">
    <header className="theater-top"><div className="theater-brand"><i>↗</i> typesafe benchmark<span>/ side by side</span></div><span className="theater-connection">{left.config?.mode === 'fixture' ? 'FIXTURES / NO INFERENCE' : left.config ? 'LIVE COMPARISON' : 'CONNECTING'}</span><button disabled={running} onClick={onSingle}>Single model ↗</button></header>
    <nav className="scene-tabs" aria-label="Demo scenes">{scenes.map((s,i) => <button key={s.id} aria-current={left.scene === s.id ? 'page' : undefined} disabled={running} onClick={() => select(s.id)}><small>0{i+1}</small>{s.short}</button>)}</nav>
    <section className="theater-title"><div><p>{current.kicker}</p><h1>{current.name}</h1><span>Same inputs. Two models. Watch both run.</span></div><div className="theater-controls"><button className="play-scene" disabled={!ready || running} onClick={() => { void run(); }}>▶ Run demo</button><button className="stop-show" disabled={!running} onClick={() => { left.stop(); right.stop(); }}>■ Stop both</button></div></section>
    {!configured && <p className="comparison-warning" role="status">{left.connectionError || right.connectionError || (!left.config || !right.config ? 'Connecting to the demo server…' : 'Select an available model on each side. Install Needle or RLCD, or configure a cloud key, to enable more models.')}</p>}
    <div className="comparison-grid">{([['left',left],['right',right]] as const).map(([side,p]) => <ComparisonLane key={side} side={side} player={{...p,target,setScoreThreshold:threshold}} generation={generation} locked={running} onModelChange={value => { p.selectModel(value); setGeneration(n => n + 1); }}/>) }</div>
    <footer className="theater-footer"><span>Matching input order · independent results and timing</span><span>Simulated actions. Types ≠ correctness. {left.config?.mode === 'fixture' ? 'Synthetic tokens; no inference.' : 'Estimated cost; failed-call usage may be unknown.'}</span></footer>
  </main>;
}

function ComparisonLane({ player:p, side, generation, locked, onModelChange }: { player:PlayerState; side:'left'|'right'; generation:number; locked:boolean; onModelChange:(value:string)=>void }) {
  const [selection,setSelection] = useState<{generation:number;id:number}>();
  const [contract,setContract] = useState<ContractSnapshot>();
  const pinned = selection?.generation === generation ? selection.id : undefined;
  const settled = p.events.filter(e => e.status !== 'pending');
  const done = settled.filter(e => e.data);
  const focus = p.events.find(e => e.id === pinned) ?? settled.toSorted((a,b) => (a.settledMs ?? 0)-(b.settledMs ?? 0)).at(-1) ?? p.events.at(-1);
  const totals = requestTotals(p.events);
  const name = models[p.model].label;
  const inspectionId = `comparison-${side}`;
  function openContract() {
    const context = focus?.item.context ?? (p.scene === 'navigate' ? p.navigation : p.scene === 'drive' ? p.car : workItem(p.scene,0).context);
    setContract(contractSnapshot({scene:p.scene,model:p.model,context,scoreThreshold:p.scoreThreshold,...(focus ? {requestId:focus.item.id} : {}),...(focus?.data ? {recorded:focus.data.contract} : {})}));
  }
  return <section className="comparison-lane" aria-label={`${side} comparison: ${name}`}>
    <header className="comparison-provider"><div><span>{providerName(p.model)}</span><label className="comparison-model"><span>{side.toUpperCase()} MODEL</span><select aria-label={`${side === 'left' ? 'Left' : 'Right'} model`} value={p.model} disabled={locked || !p.config} onChange={event => { setContract(undefined); onModelChange(event.target.value); }}>{demoModel.options.map(model => <option key={model} value={model} disabled={!p.config?.availableModels.includes(model)}>{models[model].label}</option>)}</select></label><small>{priceLabel(p.model)}</small></div><div><button onClick={openContract}>View contract ↗</button><button disabled={locked || !settled.length} onClick={p.download}>Export results ↗</button></div></header>
    <div className="comparison-metrics">{[['VALIDATED',`${done.length} / ${p.events.length}`],['WALL TIME',`${(p.elapsedMs/1000).toFixed(2)}s`],['DECISIONS / SEC',p.elapsedMs ? (done.length/(p.elapsedMs/1000)).toFixed(1) : '—'],['EST. COST',totals.unpricedRequests ? 'Unknown' : `$${totals.cost.toFixed(6)}`]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="scene-visual comparison-visual" key={p.scene}><SceneVisual player={p} selectedId={pinned} onSelect={id => setSelection({generation,id})} inspectionId={inspectionId}/></div>
    <div className="scene-status" role="status"><span className={p.running ? 'running-dot' : ''}/><div>{p.connectionError || p.note}</div></div>
    <details className="comparison-inspection" open={pinned !== undefined || undefined}><summary>{focus?.item.id ?? 'Input & output'} · {focus?.status ?? 'click a result to inspect'}</summary><div id={inspectionId} className="comparison-json"><div><h3>INPUT</h3><pre className="theater-code"><JsonCode value={focus?.input ?? {}}/></pre></div><div><h3>OUTPUT</h3><div className="comparison-result">
      <pre className="theater-code"><JsonCode value={focus?.data?.decision ?? focus?.error ?? 'Waiting for a decision'}/></pre>
      {focus?.data?.nativeMetrics && <p className="comparison-native-metrics">Engine decode {focus.data.nativeMetrics.decodeTokensPerSecond.toFixed(0)} tok/s · prefill {focus.data.nativeMetrics.prefillTokensPerSecond.toFixed(0)} tok/s · {focus.data.nativeMetrics.peakRamMb.toFixed(1)} MB peak RAM. Token counts not reported.</p>}
      {focus?.data?.rlcdMetrics && <p className="comparison-native-metrics">Engine {focus.data.rlcdMetrics.engineElapsedMs.toFixed(1)} ms · prefill {focus.data.rlcdMetrics.prefillMs.toFixed(1)} ms · batched suffix {focus.data.rlcdMetrics.suffixEvalMs.toFixed(1)} ms · {focus.data.rlcdMetrics.fieldCount} fields. Scores are vendor-reported; collision scores are synthetic.</p>}
    </div></div></div></details>
    {contract && <ContractDialog snapshot={contract} onClose={() => setContract(undefined)}/>}
  </section>;
}
