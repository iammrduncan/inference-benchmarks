import { z } from 'zod';
import { invalid, badOutput } from './errors.js';
import { limits, record } from './json.js';
import { modelIds, type Model } from './models.js';
export type { Model } from './models.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Description = string | null | JsonValue[] | { [key: string]: JsonValue };
function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(v => isJson(v, depth + 1));
  return record(value) && Object.values(value).every(v => isJson(v, depth + 1));
}
// Preserve caller-owned keys verbatim. z.record intentionally drops __proto__,
// which would silently change structured evaluation data and distribution labels.
const description = z.custom<Description>((v: unknown) =>
  (v === null || typeof v === 'string' || Array.isArray(v) || record(v)) && isJson(v));
const question = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('choice'), instructions: description, criteria: z.unknown() }),
  z.strictObject({ type: z.literal('score'), instructions: description, criteria: z.array(description).min(2).max(10) }),
  z.strictObject({ type: z.literal('noul'), instructions: description,
    criteria: z.strictObject({ true: description.optional(), false: description.optional() }).optional() }),
]);
export type Question = z.infer<typeof question>;
export type Message = { role: 'system' | 'developer' | 'user' | 'assistant'; content: string };
export type Usage = { input_tokens: number; output_tokens: number };
export type Answer = { type: 'noul'; noul: number } |
  { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number } |
  { type: 'score'; score: number; legend: Record<string, unknown>; probabilities: Record<string, number>; confidence: number };
export type NumericSlot = { type: 'number' | 'integer'; minimum: number; maximum: number };
export type Job = { rubric: unknown; slots: NumericSlot[]; distribution?: boolean };

export function resolveModel(value: string, defaultModel: Model, alias = false): Model {
  const known = modelIds.find(model => model === value);
  if (known) return known;
  if (alias && value === 'jev-latest') return defaultModel;
  return invalid();
}
export function validName(value: string): boolean { return Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= 256; }
export function choices(q: Question): [string, unknown][] {
  if (q.type !== 'choice' || !record(q.criteria)) return invalid();
  const entries = Object.entries(q.criteria).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length < 2 || entries.length > 255 || entries.some(([key, value]) => !validName(key) || !description.safeParse(value).success)) return invalid();
  return entries;
}
export function parseSystemOne(body: unknown, defaultModel: Model) {
  const result = z.strictObject({ state: description, model: z.string(), questions: z.unknown() }).safeParse(body);
  if (!result.success || result.data.state === null || !record(result.data.questions)) return invalid();
  const entries = Object.entries(result.data.questions);
  if (!entries.length || entries.length > limits.questions || Buffer.byteLength(JSON.stringify(result.data.questions)) > 65_536) return invalid();
  const questions = entries.map(([id, raw]) => {
    if (!validName(id)) return invalid();
    const parsed = question.safeParse(raw);
    if (!parsed.success) return invalid();
    if (parsed.data.type === 'choice') choices(parsed.data);
    return { id, question: parsed.data };
  });
  return { model: resolveModel(result.data.model, defaultModel, true), questions,
    messages: [{ role: 'user', content: JSON.stringify(result.data.state) } satisfies Message] };
}
export function questionJob(q: Question): Job {
  const count = q.type === 'choice' ? choices(q).length : q.type === 'score' ? q.criteria.length : 1;
  const rubric = q.type === 'choice'
    ? { type: q.type, instructions: q.instructions, options: choices(q).map(([label, description]) => ({ label, description })) }
    : q;
  return { rubric, distribution: q.type !== 'noul', slots: Array.from({ length: count }, () => ({ type: 'number', minimum: 0, maximum: 1 })) };
}
export function distribution(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0 || v > 1) || total <= 0 || Math.abs(total - 1) > 1e-6) return badOutput();
  return values.map(v => v / total);
}
export function confidence(values: number[]): number {
  const entropy = -values.reduce((sum, p) => sum + (p === 0 ? 0 : p * Math.log(p)), 0);
  const value = 1 - entropy / Math.log(values.length);
  if (!Number.isFinite(value) || value < -1e-12 || value > 1 + 1e-12) return badOutput();
  return Math.min(1, Math.max(0, value));
}
export function answer(q: Question, raw: number[]): Answer {
  if (raw.length !== questionJob(q).slots.length) return badOutput();
  if (q.type === 'noul') {
    const noul = raw[0];
    if (noul === undefined || !Number.isFinite(noul) || noul < 0 || noul > 1) return badOutput();
    return { type: 'noul', noul };
  }
  const p = distribution(raw);
  const labels = q.type === 'choice' ? choices(q).map(([key]) => key) : q.criteria.map((_, i) => String(i));
  const probabilities = Object.fromEntries(labels.map((label, i) => {
    const value = p[i];
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) return badOutput();
    return [label, value];
  }));
  if (q.type === 'choice') {
    let winner = 0;
    p.forEach((v, i) => { if (v > (p[winner] ?? -1)) winner = i; });
    const choice = labels[winner];
    if (choice === undefined) return badOutput();
    return { type: 'choice', choice, probabilities, confidence: confidence(p) };
  }
  return { type: 'score', score: p.reduce((sum, v, i) => sum + v * i, 0),
    legend: Object.fromEntries(q.criteria.map((value, i) => [String(i), value])),
    probabilities, confidence: confidence(p) };
}
export const chatRequest = z.strictObject({ model: z.string(),
  messages: z.array(z.strictObject({ role: z.enum(['system', 'developer', 'user', 'assistant']), content: z.string() })).min(1).max(64),
  response_format: z.strictObject({ type: z.literal('json_schema'), json_schema: z.strictObject({
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), strict: z.literal(true), schema: z.unknown(), description: z.string().optional(),
  }) }), stream: z.literal(false).optional(), n: z.literal(1).optional(),
});
