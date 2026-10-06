'use client';
import { applyHome, homeInput, rooms } from '../../lib/theater/home';
import type { PlayerState } from './use-player';

export function HomeScene({ player: p, selectedId, onSelect, inspectionId = 'theater-input theater-output' }: { player: PlayerState; selectedId: number | undefined; onSelect: (id: number) => void; inspectionId?: string }) {
  const selected = p.events.find(event => event.id === selectedId);
  const before = selected ? homeInput.parse(selected.input).state : p.home;
  const state = selected?.data ? applyHome(before, selected.data.decision) : before;
  const latest = p.events.at(-1);
  const viewed = selected ?? latest;
  const lastChange = (device: string) => p.events.findLast(event => event.data?.decision.action === 'apply' && event.data.decision[device] !== 'unchanged' && event.data.decision[device] !== 0 && (!selected || event.id <= selected.id));
  return <div className="home-stage">
    <div className="scene-caption"><b>CONNECTED HOME</b><span>{selected ? `SNAPSHOT / ${selected.item.id}` : 'LIVE / SIMULATED DEVICES'}</span></div>
    <div className="home-command"><span>{viewed?.status === 'pending' ? 'LISTENING' : viewed?.data?.decision.action === 'clarify' ? 'NEEDS CLARIFICATION' : 'HOUSEHOLD REQUEST'}</span><p>{viewed?.item.title ?? 'Lights, blinds, climate. Press play to bring the house to life.'}</p></div>
    <div className="home-floor">
      {rooms.map(room => {
        const event = lastChange(room);
        return <button type="button" key={room} className={`home-room ${state[room]}`} disabled={!event} aria-label={`Inspect last ${room} light command`} onClick={() => { if (event) onSelect(event.id); }} aria-controls={inspectionId}>
          <span className="room-title">{room === 'living' ? 'LIVING ROOM' : room.toUpperCase()}</span>
          <svg viewBox="0 0 180 90" aria-hidden="true">
            <g className="room-furniture" fill="none" stroke="currentColor" strokeWidth="2">
              {room === 'kitchen' ? <><path d="M10 15H55V30H25V75H10Z"/><circle cx="18" cy="24" r="4"/><rect x="65" y="38" width="70" height="32" rx="8"/><path d="M80 32V25M120 32V25M80 76V82M120 76V82"/></> : room === 'living' ? <><rect x="28" y="48" width="100" height="30" rx="6"/><path d="M38 48V64H118V48M78 50V63"/><rect x="50" y="14" width="60" height="8" rx="2"/><rect x="55" y="30" width="50" height="12" rx="6"/></> : room === 'bedroom' ? <><rect x="42" y="15" width="86" height="65" rx="5"/><path d="M42 41H128"/><rect x="50" y="22" width="26" height="13" rx="3"/><rect x="93" y="22" width="26" height="13" rx="3"/><path d="M24 24H35V38H24ZM136 24H148V38H136Z"/></> : <><path d="M30 18H148V73H30Z" strokeDasharray="4 4"/><rect x="122" y="26" width="15" height="39" rx="3"/><path d="M42 73V47Q66 47 66 73"/></>}
            </g><circle className="room-glow" cx="155" cy="17" r="12"/><circle className="room-bulb" cx="155" cy="17" r="5"/>
          </svg>
          <span className="room-level">{state[room] === 'off' ? 'OFF · 0%' : state[room] === 'dim' ? 'DIM · 30%' : 'BRIGHT · 100%'}</span>
        </button>;
      })}
    </div>
    <div className="home-devices">{(['blinds', 'temperature'] as const).map(device => {
      const event = lastChange(device);
      return <button type="button" key={device} onClick={() => { if (event) onSelect(event.id); }} disabled={!event} aria-label={`Inspect last ${device} command`} aria-controls={inspectionId}><span>{device === 'blinds' ? '▤ BLINDS' : '◉ THERMOSTAT'}</span><strong>{device === 'blinds' ? state.blinds.toUpperCase() : `${state.temperature}°C`}</strong></button>;
    })}</div>
    <div className="home-timeline" aria-label="Home command history">{Array.from({ length: 24 }, (_, i) => {
      const event = p.events[i];
      const action = event?.data?.decision.action;
      return <button type="button" key={i} disabled={!event} className={action === 'apply' ? 'applied' : action === 'clarify' ? 'clarify' : event?.status ?? 'waiting'} onClick={() => { if (event) onSelect(event.id); }} aria-pressed={Boolean(event && event.id === selectedId)} aria-controls={inspectionId} aria-label={event ? `Inspect ${event.item.id}: ${event.item.title}. ${action ?? event.status}` : `Home command ${i + 1} not dispatched`} title={event?.item.title ?? 'Not dispatched'}>{action === 'apply' ? '✓' : action === 'clarify' ? '?' : event?.status === 'failed' ? '!' : i + 1}</button>;
    })}</div>
    <div className="home-legend"><span>✓ applied</span><span>? clarify / no change</span><span>Click a device or command to inspect</span></div>
  </div>;
}
