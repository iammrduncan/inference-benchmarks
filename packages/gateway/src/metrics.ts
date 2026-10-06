import type { ErrorCode } from './errors.js';
import type { Model, Usage } from './contracts.js';
import { models } from './models.js';
export type ProviderTiming = { queue_time: number; prompt_time: number; completion_time: number; total_time: number };
export type ProviderMetric = { requestId?: string; model: Model; durationMs: number; queueWaitMs: number; outcome: 'success' | ErrorCode;
  httpStatus?: number; usage: Usage | null; timing: ProviderTiming | null };
export const prices = models;
export function estimatedCost(model: Model, usage: Usage): number {
  return (usage.input_tokens * prices[model].input + usage.output_tokens * prices[model].output) / 1e6;
}
export function percentiles(values: number[]) {
  if (!values.length) return { p50: null, p95: null, p99: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? null;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}
