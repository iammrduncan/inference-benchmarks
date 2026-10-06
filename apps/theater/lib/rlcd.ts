import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { Fault } from '@decision/gateway/errors';
import { applyDecision, type DemoInput } from './contracts';
import { rlcdWorkerSchema, type RlcdPlan } from './rlcd-plan';

export type RlcdConfig = { python: string; worker: string; source: string; weights: string };
const finiteNonnegative = z.number().finite().nonnegative();
const probability = z.number().finite().min(0).max(1);
const responseSchema = z.object({
  mode: z.literal('parallel_constrained_calibrated'),
  elapsed_ms: finiteNonnegative,
  prefill_ms: finiteNonnegative,
  suffix_eval_ms: finiteNonnegative,
  sequential_forward_passes: z.number().int().positive(),
  is_valid_json: z.literal(true),
  schema_match: z.literal(true),
  parsed_json: z.record(z.string(), z.object({ value: z.union([z.string(), z.boolean()]), prob: probability })),
  field_telemetry: z.record(z.string(), z.unknown()),
  num_fields: z.number().int().positive(),
  collision_fields: z.array(z.string()),
});
const workerMessage = z.union([
  z.object({ type: z.literal('ready') }),
  z.object({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.number().int().nullable(), ok: z.literal(false), error: z.literal('inference_failed') }),
]);

export function decodeRlcd(input: DemoInput, plan: RlcdPlan, raw: unknown) {
  const response = responseSchema.parse(raw);
  const names = Object.keys(plan.fields);
  const outputNames = Object.keys(response.parsed_json);
  if (response.num_fields !== names.length || outputNames.length !== names.length
    || names.some(name => !Object.hasOwn(response.parsed_json, name))
    || response.collision_fields.some(name => !Object.hasOwn(plan.fields, name))) {
    throw new Fault('invalid_provider_output', 502);
  }
  const modelResult: Record<string, string | number | boolean> = {};
  const reportedFieldScores: Record<string, { value: string | number | boolean; reportedProbability: number; collision: boolean }> = {};
  for (const name of names) {
    const field = plan.fields[name];
    const decision = response.parsed_json[name];
    if (!field || !decision) throw new Fault('invalid_provider_output', 502);
    if (typeof decision.value !== 'string') throw new Fault('invalid_provider_output', 502);
    const index = field.choices.indexOf(decision.value);
    const selected = field.values[index];
    if (index === -1 || selected === undefined) throw new Fault('invalid_provider_output', 502);
    const value = selected;
    modelResult[name] = value;
    reportedFieldScores[name] = { value, reportedProbability: decision.prob,
      collision: response.collision_fields.includes(name) };
  }
  const result: Record<string, string | number | boolean> = plan.mapping.kind === 'judge_criteria'
    ? { accuracy: plan.mapping.criteria.reduce((sum, criterion) => sum
      + (modelResult[criterion.field] === true ? criterion.points : 0), 0),
      valid: plan.mapping.criteria.every(criterion => modelResult[criterion.field] === true) }
    : modelResult;
  const decision = applyDecision(input, result);
  return { result, decision, reportedFieldScores, rlcdMetrics: {
    engineElapsedMs: response.elapsed_ms,
    prefillMs: response.prefill_ms,
    suffixEvalMs: response.suffix_eval_ms,
    sequentialForwardPasses: response.sequential_forward_passes,
    fieldCount: response.num_fields,
    collisionFields: response.collision_fields,
  } };
}

type Pending = {
  id: number; input: DemoInput; plan: RlcdPlan; signal: AbortSignal; settled: boolean;
  resolve: (value: ReturnType<typeof decodeRlcd>) => void; reject: (error: Fault) => void;
  abort: () => void;
};
type WorkerState = {
  child: ChildProcessWithoutNullStreams; ready: Promise<void>; resolveReady: () => void;
  rejectReady: (error: Fault) => void; readySettled: boolean; closed: Promise<void>;
  resolveClosed: () => void; buffer: string; ended: boolean;
};

// The upstream MLX engine holds a process-global GPU lock. A single persistent
// process avoids repeated model load while this queue makes that serialization explicit.
export function createRlcdRunner(config: RlcdConfig) {
  const waiting: Pending[] = [];
  let worker: WorkerState | undefined;
  let active: Pending | undefined;
  let nextId = 1;
  let pumping = false;
  let stopped = false;

  function finish(item: Pending, outcome: { value: ReturnType<typeof decodeRlcd> } | { error: Fault }) {
    if (item.settled) return;
    item.settled = true;
    item.signal.removeEventListener('abort', item.abort);
    if ('value' in outcome) item.resolve(outcome.value); else item.reject(outcome.error);
  }

  function end(state: WorkerState, fault: Fault) {
    if (state.ended) return;
    state.ended = true;
    state.resolveClosed();
    if (!state.readySettled) { state.readySettled = true; state.rejectReady(fault); }
    if (worker === state) worker = undefined;
    if (active) { const item = active; active = undefined;
      finish(item, { error: item.signal.aborted ? new Fault('deadline_exceeded', 504) : fault }); }
    void pump();
  }

  function failProtocol(state: WorkerState) {
    state.child.kill('SIGKILL');
    end(state, new Fault('invalid_provider_output', 502));
  }

  function handleLine(state: WorkerState, line: string) {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { failProtocol(state); return; }
    const parsed = workerMessage.safeParse(raw);
    if (!parsed.success) { failProtocol(state); return; }
    if ('type' in parsed.data) {
      if (state.readySettled || parsed.data.type !== 'ready') { failProtocol(state); return; }
      state.readySettled = true; state.resolveReady(); return;
    }
    const item = active;
    if (!item || parsed.data.id !== item.id) { failProtocol(state); return; }
    active = undefined;
    if (!parsed.data.ok) finish(item, { error: new Fault('provider_unavailable', 502) });
    else {
      try { finish(item, { value: decodeRlcd(item.input, item.plan, parsed.data.result) }); }
      catch { finish(item, { error: new Fault('invalid_provider_output', 502) }); }
    }
    void pump();
  }

  function startWorker() {
    const child = spawn(config.python, [config.worker, '--source', config.source, '--model', config.weights], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '',
        NODE_ENV: process.env.NODE_ENV ?? 'production', TMPDIR: process.env.TMPDIR ?? '/tmp',
        HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONUNBUFFERED: '1', DO_NOT_TRACK: '1' },
    });
    let resolveReady = () => {};
    let rejectReady: (error: Fault) => void = () => {};
    let resolveClosed = () => {};
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const state: WorkerState = { child, ready, resolveReady, rejectReady, readySettled: false,
      closed, resolveClosed, buffer: '', ended: false };
    worker = state;
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      state.buffer += chunk;
      if (state.buffer.length > 1_048_576) { failProtocol(state); return; }
      for (;;) {
        const newline = state.buffer.indexOf('\n');
        if (newline === -1) break;
        const line = state.buffer.slice(0, newline); state.buffer = state.buffer.slice(newline + 1);
        if (line) handleLine(state, line);
      }
    });
    child.once('error', () => end(state, new Fault('provider_unavailable', 502)));
    child.once('close', () => end(state, stopped ? new Fault('deadline_exceeded', 504) : new Fault('provider_unavailable', 502)));
    return state;
  }

  async function pump() {
    if (pumping || active || stopped) return;
    pumping = true;
    try {
      while (!active && waiting.length && !stopped) {
        const item = waiting.shift();
        if (!item || item.settled) continue;
        if (item.signal.aborted) { finish(item, { error: new Fault('deadline_exceeded', 504) }); continue; }
        active = item;
        const state = worker ?? startWorker();
        try {
          await state.ready;
          if (active !== item || item.settled) continue;
          item.signal.throwIfAborted();
          state.child.stdin.write(`${JSON.stringify({ id: item.id, context: item.plan.input,
            schema: rlcdWorkerSchema(item.plan) })}\n`);
        } catch {
          if (active === item) { active = undefined; finish(item, { error: item.signal.aborted
            ? new Fault('deadline_exceeded', 504) : new Fault('provider_unavailable', 502) }); }
          state.child.kill('SIGKILL');
          continue;
        }
      }
    } finally { pumping = false; }
  }

  function request(input: DemoInput, plan: RlcdPlan, signal: AbortSignal) {
    if (stopped || signal.aborted) return Promise.reject(new Fault('deadline_exceeded', 504));
    return new Promise<ReturnType<typeof decodeRlcd>>((resolve, reject) => {
      const item: Pending = { id: nextId++, input, plan, signal, settled: false, resolve, reject,
        abort: () => {
          if (item.settled) return;
          const index = waiting.indexOf(item);
          if (index !== -1) { waiting.splice(index, 1); finish(item, { error: new Fault('deadline_exceeded', 504) }); }
          else if (active === item) worker?.child.kill('SIGKILL');
        } };
      waiting.push(item);
      signal.addEventListener('abort', item.abort, { once: true });
      void pump();
    });
  }

  async function close() {
    if (stopped) return worker?.closed;
    stopped = true;
    for (const item of waiting.splice(0)) finish(item, { error: new Fault('deadline_exceeded', 504) });
    const state = worker;
    if (state) { state.child.kill('SIGKILL'); await state.closed; }
  }
  return { request, close };
}
