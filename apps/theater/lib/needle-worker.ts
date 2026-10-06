import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Fault } from '@decision/gateway/errors';
import { parseJson } from '@decision/gateway/json';
import type { DemoInput } from './contracts';
import { decodeNeedle, requestNeedle, type NeedleConfig } from './needle';
import type { NeedlePlan } from './needle-plan';

type Slot = { busy: boolean; directory?: string; child?: ChildProcess; closed?: Promise<void>;
  origin?: string; stopping?: Promise<void>; idleTimer?: NodeJS.Timeout };
type Waiting = { signal: AbortSignal; resolve: (slot: Slot) => void; reject: (error: Fault) => void;
  abort: () => void };
type Group = { contract: string; slots: Slot[]; waiting: Waiting[] };

// Two reset workers preserve throughput without the four-process tail-latency spike
// measured on M4 Pro. A 5-second idle expiry bounds the cost across scene changes.
// ponytail: native HTTP is process-global; one in-flight request per worker, never
// parallel /reset and /complete on the same process. Navigation changes its schema
// per junction and continues to use isolated one-shot processes.
export function createNeedleRunner(config: NeedleConfig) {
  const groups = new Map<DemoInput['id'], Group>();
  let stopped = false;
  const environment = { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production',
    NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' };

  async function availablePort() {
    const server = createServer();
    let listening = false;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No loopback port');
      listening = true;
      return address.port;
    } finally { if (listening) await new Promise<void>(resolve => server.close(() => resolve())); }
  }

  async function stopSlot(slot: Slot) {
    if (slot.stopping) return slot.stopping;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.stopping = (async () => {
      slot.child?.kill('SIGKILL');
      await slot.closed;
      if (slot.directory) await rm(slot.directory, { recursive: true, force: true });
    })();
    return slot.stopping;
  }

  async function startSlot(slot: Slot, plan: NeedlePlan, signal: AbortSignal) {
    signal.throwIfAborted();
    slot.directory = await mkdtemp(path.join(tmpdir(), 'decision-needle-worker-'));
    const toolsPath = path.join(slot.directory, 'tools.json');
    await writeFile(toolsPath, JSON.stringify(plan.tools), { mode: 0o600, signal });
    const port = await availablePort();
    signal.throwIfAborted();
    slot.origin = `http://127.0.0.1:${port}`;
    const child = spawn(config.executable, ['--model', config.weights, '--tools', toolsPath,
      '--max', String(plan.max_new_tokens), '--depth', String(plan.depth), '--forced', '--fail-input-overflow', '--serve', '--port', String(port)],
    { env: environment, stdio: 'ignore' });
    slot.child = child;
    slot.closed = new Promise<void>(resolve => {
      child.once('close', () => resolve());
      child.once('error', () => resolve());
    });
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try {
      const started = performance.now();
      while (performance.now() - started < 5000 && child.exitCode === null && child.signalCode === null) {
        signal.throwIfAborted();
        try {
          const response = await fetch(`${slot.origin}/reset`, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(250)]) });
          if (response.ok) return;
        } catch { /* Native listener is still starting. */ }
        await delay(10, undefined, { signal });
      }
      throw new Error('Needle worker unavailable');
    } finally { signal.removeEventListener('abort', abort); }
  }

  function dispatch(group: Group) {
    while (group.waiting.length && !stopped) {
      let slot = group.slots.find(candidate => !candidate.busy && !candidate.stopping);
      if (!slot && group.slots.length < 2) {
        slot = { busy: false };
        group.slots.push(slot);
      }
      if (!slot) break;
      const waiting = group.waiting.shift();
      if (!waiting) break;
      waiting.signal.removeEventListener('abort', waiting.abort);
      if (waiting.signal.aborted) { waiting.reject(new Fault('deadline_exceeded', 504)); continue; }
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.busy = true;
      waiting.resolve(slot);
    }
  }

  function acquire(group: Group, signal: AbortSignal) {
    if (stopped || signal.aborted) return Promise.reject(new Fault('deadline_exceeded', 504));
    return new Promise<Slot>((resolve, reject) => {
      const waiting: Waiting = { signal, resolve, reject, abort: () => {
        const index = group.waiting.indexOf(waiting);
        if (index !== -1) group.waiting.splice(index, 1);
        reject(new Fault('deadline_exceeded', 504));
      } };
      group.waiting.push(waiting);
      signal.addEventListener('abort', waiting.abort, { once: true });
      dispatch(group);
    });
  }

  async function release(group: Group, slot: Slot, healthy: boolean) {
    if (!healthy || stopped) {
      await stopSlot(slot).catch(() => { /* Preserve the original inference error. */ });
      const index = group.slots.indexOf(slot);
      if (index !== -1) group.slots.splice(index, 1);
    } else {
      slot.busy = false;
      if (!group.waiting.length) {
        slot.idleTimer = setTimeout(() => {
          const index = group.slots.indexOf(slot);
          if (index !== -1 && !slot.busy) {
            group.slots.splice(index, 1);
            void stopSlot(slot).catch(() => { /* Idle worker cleanup is best effort. */ });
          }
        }, 5000);
        slot.idleTimer.unref();
      }
    }
    dispatch(group);
  }

  async function request(input: DemoInput, plan: NeedlePlan, signal: AbortSignal) {
    if (stopped || signal.aborted) throw new Fault('deadline_exceeded', 504);
    if (input.id === 'navigate') return requestNeedle(input, plan, config, signal);
    const contract = JSON.stringify({ tools: plan.tools, depth: plan.depth, maxNewTokens: plan.max_new_tokens,
      forced: plan.forced, failInputOverflow: plan.fail_input_overflow });
    let group = groups.get(input.id);
    if (!group) { group = { contract, slots: [], waiting: [] }; groups.set(input.id, group); }
    if (group.contract !== contract) return requestNeedle(input, plan, config, signal);
    const slot = await acquire(group, signal);
    let healthy = true;
    try {
      if (!slot.origin) await startSlot(slot, plan, signal);
      const reset = await fetch(`${slot.origin}/reset`, { method: 'POST', signal });
      if (!reset.ok) throw new Error('Needle reset failed');
      const response = await fetch(`${slot.origin}/complete`, { method: 'POST', signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: plan.input }) });
      if (!response.ok) throw new Error('Needle completion failed');
      let raw: unknown;
      try { raw = parseJson(await response.text()); }
      catch { throw new Fault('invalid_provider_output', 502); }
      signal.throwIfAborted();
      try { return decodeNeedle(input, plan, raw); }
      catch { throw new Fault('invalid_provider_output', 502); }
    } catch (error) {
      if (signal.aborted || stopped) { healthy = false; throw new Fault('deadline_exceeded', 504); }
      if (error instanceof Fault) throw error;
      healthy = false;
      throw new Fault('provider_unavailable', 502);
    } finally { await release(group, slot, healthy); }
  }

  async function close() {
    stopped = true;
    for (const group of groups.values()) {
      for (const waiting of group.waiting.splice(0)) {
        waiting.signal.removeEventListener('abort', waiting.abort);
        waiting.reject(new Fault('deadline_exceeded', 504));
      }
    }
    await Promise.all([...groups.values()].flatMap(group => group.slots.map(stopSlot)));
  }
  return { request, close };
}
