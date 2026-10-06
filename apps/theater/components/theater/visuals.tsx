'use client';
import { useId, useMemo } from 'react';
import { sceneColors } from '../../lib/theater/data';
import { teams } from '../../lib/traffic';
import { junctions, exits, closedRoads } from '../../lib/theater/navigation';
import type { PlayerState } from './use-player';
import { HomeScene } from './home-scene';
import { passesThreshold } from '../../lib/theater/judge';
import { City } from './city';
export function SceneVisual({player:p,selectedId,onSelect,inspectionId='theater-input theater-output'}:{player:PlayerState;selectedId:number|undefined;onSelect:(id:number)=>void;inspectionId?:string}){
  const mapId=useId();
  const done=useMemo(()=>p.events.filter(e=>e.status==='validated'),[p.events]);
  if(p.scene==='home')return <HomeScene player={p} selectedId={selectedId} onSelect={onSelect} inspectionId={inspectionId}/>;
  if(p.scene==='drive')return <div className="driving-stage"><City engine={p.engine} onReady={p.onGpu}/><div className="drive-hud"><span>WEBGPU / THIRD PERSON</span><strong>{(p.car.speed*3.6).toFixed(0)}<small>km/h</small></strong><div><b>{(Math.max(0,10000-p.car.elapsedMs)/1000).toFixed(1)}s</b><b>{p.car.distance.toFixed(0)} m</b><b>{p.car.collisions} impacts</b></div></div>{p.gpu!=='ready'&&<div className="gpu-notice">{p.gpu==='loading'?'Preparing the WebGPU city…':p.gpu}{p.gpu.includes('HTTPS')&&<a href="https://josephs-macbook-pro.taila9c138.ts.net/">Open secure demo ↗</a>}</div>}<div className="car-control">steer: <b>{p.engine.control.steer}</b> / throttle: <b>{p.engine.control.throttle}</b></div></div>;
  if(p.scene==='navigate'){
    const point=(id:number)=>({x:80+(id%5)*110,y:40+Math.floor(id/5)*82});
    return <div className="route-stage"><div className="scene-caption"><b>RIVER DISTRICT</b><span>Click a junction to set the destination</span></div><svg viewBox="0 0 600 415" role="img" aria-label={`Street graph. Courier at ${p.navigation.position}, target ${p.navigation.target}`}>
      <defs><pattern id={mapId} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="var(--t-line)"/></pattern></defs><rect width="600" height="415" fill={`url(#${mapId})`}/>
      <path d="M285 -20 Q220 100 290 185 T270 450" fill="none" stroke="var(--t-comment)" strokeWidth="45"/>
      {junctions.flatMap(j=>exits(j.id).filter(n=>n.to>j.id).map(n=>{const a=point(j.id),b=point(n.to);return <g key={`${j.id}-${n.to}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--t-selection)" strokeWidth="17"/><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--t-comment)" strokeWidth="1.5"/><text x={(a.x+b.x)/2+5} y={(a.y+b.y)/2-5} className="map-cost">{n.cost}m</text></g>;}))}
      {closedRoads.map(([a,b])=>{const x=point(a),y=point(b);return <line key={`${a}-${b}`} x1={x.x} y1={x.y} x2={y.x} y2={y.y} stroke="var(--t-red)" strokeWidth="5" strokeDasharray="5 5"/>;})}
      <polyline points={p.navigation.visited.map(id=>{const v=point(id);return`${v.x},${v.y}`;}).join(' ')} fill="none" stroke="var(--t-green)" strokeWidth="6" strokeLinejoin="round"/>
      {junctions.map(j=>{const v=point(j.id);return <g role="button" aria-label={`Set destination ${j.id}`} tabIndex={0} onClick={()=>p.target(j.id)} onKeyDown={e=>{if(e.key==='Enter')p.target(j.id);}} key={j.id} className={`map-node ${j.id===p.navigation.target?'destination':''}`}><circle cx={v.x} cy={v.y} r={j.id===p.navigation.target?16:10} fill={j.id===p.navigation.target?'var(--t-orange)':'var(--t-panel)'} stroke="var(--t-comment)"/><text x={v.x} y={v.y+3} textAnchor="middle">{j.id===p.navigation.target?'◆':j.id}</text></g>;})}
      <g style={{transform:`translate(${point(p.navigation.position).x}px,${point(p.navigation.position).y}px)`}} className="map-courier"><circle r="19" fill="var(--t-green)" opacity=".15"/><circle r="12" fill="var(--t-green)"/><path d="M-5 0 L0 -5 L5 0 L0 5 Z" fill="var(--t-paper)"/></g>
    </svg><div className="map-legend"><span>● courier</span><span>◆ destination</span><span>┄ closed road</span><span>{p.navigation.visited.length-1} hops</span></div></div>;
  }
  if(p.scene==='dispatch'){
    const counts=Object.fromEntries(teams.map(team=>[team,done.filter(e=>e.data?.decision.team===team).length]));
    return <div className="ticket-stage"><div className="scene-caption"><b>SUPPORT SWITCHBOARD</b><span>Click a ticket to inspect its decision</span></div><svg viewBox="0 0 600 430" role="group" aria-label={`${done.length} tickets categorized. Select a ticket to inspect input and output.`}>
      <path d="M300 45 V75 M150 75 H450 M150 75 V95 M450 75 V95" fill="none" stroke="var(--t-comment)" strokeWidth="2"/><rect x="223" y="17" width="154" height="40" rx="20" fill="var(--t-selection)"/><text x="300" y="42" textAnchor="middle" className="gate-label">{p.events.filter(e=>e.status==='pending').length} IN FLIGHT</text>
      {teams.map((team,i)=>{const x=i%2*290+15,y=Math.floor(i/2)*166+90;return <g key={team}><rect x={x} y={y} width="280" height="155" rx="12" fill="var(--t-panel)" stroke="var(--t-line)"/><text x={x+16} y={y+26} className="queue-title" fill={sceneColors[team]}>{team.toUpperCase()}</text><text x={x+260} y={y+27} textAnchor="end" className="queue-count">{String(counts[team]).padStart(2,'0')}</text></g>;})}
      {Array.from({length:100},(_,i)=>{const event=p.events[i];const team=typeof event?.data?.decision.team==='string'?event.data.decision.team:undefined;const t=teams.findIndex(v=>v===team);const index=t<0?i:done.filter(e=>e.id<= (event?.id??0)&&e.data?.decision.team===team).length-1;const x=t<0?28+(i%25)*22:(t%2)*290+33+(index%10)*24;const y=t<0?401+Math.floor(i/25)*5:Math.floor(t/2)*166+135+Math.floor(index/10)*10;return <g key={i} className="flying-ticket" style={{transform:`translate(${x}px,${y}px)`,opacity:t<0?.28:1}}
          role={event?'button':undefined} tabIndex={event?0:undefined}
          aria-label={event?`Inspect ${event.item.id}: ${event.item.title}. ${team??event.status}`:undefined}
          aria-pressed={event?event.id===selectedId:undefined} aria-controls={inspectionId}
          onClick={()=>{if(event)onSelect(event.id);}}
          onKeyDown={e=>{if(event&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(event.id);}}}>
          <rect className="ticket-hit-area" x="-3" y="-1" width="23" height="9" fill="transparent"/>
          <rect className="ticket-glyph" width="17" height="7" rx="2" fill={team?sceneColors[team]:'var(--t-comment)'}/>
          <title>{event?`${event.item.id}: ${event.item.title}`:`Ticket ${i+1} waiting`}</title>
        </g>;})}
    </svg></div>;
  }
  if(p.scene==='judge'){
    const scores=done.map(e=>Number(e.data?.decision.accuracy));const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
    return <div className="judge-stage"><div className="scene-caption"><b>GOLDEN REFERENCE LAB</b><span>Click a score to inspect its evaluation</span></div><div className="judge-overview"><div><strong>{avg.toFixed(1)}</strong><span>MEAN ACCURACY / 100</span></div><div><strong>{scores.filter(score=>passesThreshold(score,p.scoreThreshold)).length}</strong><span>VALID ANSWERS · &gt; {p.scoreThreshold}%</span></div></div><label className="judge-threshold">VALID IF ACCURACY &gt;<input aria-label="Validity threshold" type="range" min="0" max="100" step="1" value={p.scoreThreshold} onChange={e=>p.setScoreThreshold(Number(e.target.value))}/><output>{p.scoreThreshold}%</output></label><div className="score-grid">{Array.from({length:100},(_,i)=>{const e=p.events[i];const v=e?.data?.decision.accuracy;const score=typeof v==='number'?v:undefined;return <button type="button" className={`score-tile ${score===undefined?(e?.status==='failed'?'failed':'waiting'):passesThreshold(score,p.scoreThreshold)?'good':score>=40?'partial':'bad'}`} key={i}
          disabled={!e} onClick={()=>{if(e)onSelect(e.id);}} aria-pressed={Boolean(e&&e.id===selectedId)} aria-controls={inspectionId}
          aria-label={e?`Inspect ${e.item.id}: ${e.item.title}. ${score===undefined?e.status:`Score ${score} out of 100`}`:`Evaluation ${i+1} not dispatched`}
          title={e?`${e.item.id}: ${e.item.title}`:`Evaluation ${i+1}`} style={{'--score':`${score??0}%`} as React.CSSProperties}>
          <b>{score??(e?.status==='failed'?'!':'·')}</b><i/>
        </button>;})}</div><div className="score-axis"><span>0 / incorrect</span><span>partial credit</span><span>green / &gt; {p.scoreThreshold}%</span></div></div>;
  }
  const allowed=done.filter(e=>e.data?.decision.decision==='allow').length,blocked=done.length-allowed;
  return <div className="gate-stage"><div className="scene-caption"><b>{p.scene==='approve'?'AGENT ACTION FIREWALL':'REQUEST FILTER'}</b><span>{p.scene==='approve'?'Commands are never executed':'Decisions are estimates, not a security guarantee'}</span></div><div className="gate-counters"><div><strong>{allowed.toString().padStart(2,'0')}</strong><span>ALLOW</span></div><div className="gate-symbol">{p.scene==='approve'?'⌘':'⛨'}<small>TYPE GATE</small></div><div><strong>{blocked.toString().padStart(2,'0')}</strong><span>BLOCK</span></div></div><div className="verdict-grid">{Array.from({length:100},(_,i)=>{const e=p.events[i];const value=e?.data?.decision.decision;return <button type="button" key={i} className={`verdict-tile ${value==='allow'?'allow':value==='block'?'block':e?.status??'waiting'}`}
        disabled={!e} onClick={()=>{if(e)onSelect(e.id);}} aria-pressed={Boolean(e&&e.id===selectedId)} aria-controls={inspectionId}
        aria-label={e?`Inspect ${e.item.id}: ${e.item.title}. ${value??e.status}`:`Request ${i+1} not dispatched`}
        title={e?`${e.item.id}: ${e.item.title}`:`Request ${i+1}`}>
        <span>{value==='allow'?'✓':value==='block'?'×':e?.status==='pending'?'•':e?.status==='failed'?'!':e?.status==='canceled'?'—':String(i+1).padStart(2,'0')}</span>
      </button>;})}</div><div className="split-bar"><i style={{width:`${done.length?allowed/done.length*100:50}%`}}/><b/></div></div>;
}
