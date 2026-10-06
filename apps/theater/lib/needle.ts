import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Fault } from '@decision/gateway/errors';
import { parseJson } from '@decision/gateway/json';
import { applyDecision, type DemoInput } from './contracts';
import type { NeedlePlan } from './needle-plan';

export type NeedleConfig = { executable: string; weights: string };
const execute = promisify(execFile);
const nonnegative = z.number().finite().nonnegative();
const responseSchema = z.object({ type: z.literal('call'), success: z.literal(true), error: z.null(),
  function_calls: z.array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })).length(1),
  prefill_tps: nonnegative, decode_tps: nonnegative, peak_ram_mb: nonnegative,
});

export function decodeNeedle(input: DemoInput, plan: NeedlePlan, raw: unknown) {
  const response = responseSchema.parse(raw);
  const call = response.function_calls[0];
  if (!call || call.name !== plan.tools[0]?.name) throw new Fault('invalid_provider_output', 502);
  // All scenes reject extra keys, prose, illegal choices, and out-of-range numbers.
  // Suppressed calls and the engine's reasoning never cross this boundary.
  const decision = applyDecision(input, call.arguments);
  return { result: call.arguments, decision, nativeMetrics: { prefillTokensPerSecond: response.prefill_tps,
    decodeTokensPerSecond: response.decode_tps, peakRamMb: response.peak_ram_mb } };
}

export async function requestNeedle(input: DemoInput, plan: NeedlePlan, config: NeedleConfig, signal: AbortSignal) {
  signal.throwIfAborted();
  const directory = await mkdtemp(path.join(tmpdir(), 'decision-needle-'));
  try {
    const tools = path.join(directory, 'tools.json');
    await writeFile(tools, JSON.stringify(plan.tools), { mode: 0o600, signal });
    // One process per request isolates Needle's process-global conversation and
    // lets cancellation terminate actual CPU work. Startup is included in timing.
    const { stdout } = await execute(config.executable, ['--model', config.weights, '--tools', tools,
      '--prompt', plan.input, '--max', String(plan.max_new_tokens), '--depth', String(plan.depth),
      '--forced', '--fail-input-overflow'], { signal, killSignal: 'SIGKILL', maxBuffer: 262_144, encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production', NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' } });
    signal.throwIfAborted();
    try { return decodeNeedle(input, plan, parseJson(stdout)); }
    catch { throw new Fault('invalid_provider_output', 502); }
  } catch (error) {
    if (signal.aborted) throw new Fault('deadline_exceeded', 504);
    if (error instanceof Fault) throw error;
    throw new Fault('provider_unavailable', 502);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
