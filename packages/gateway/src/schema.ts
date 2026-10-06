import { z } from 'zod';
import { Fault, badOutput } from './errors.js';
import { record } from './json.js';
import type { Job, NumericSlot } from './contracts.js';

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type Leaf = { kind: 'leaf'; index: number; values?: (string | number | boolean | null)[] };
type Node = Leaf | { kind: 'constant'; value: string | number | boolean | null } |
  { kind: 'object'; entries: [string, Node][] } | { kind: 'tuple'; items: Node[] };
const scalar = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);
const rawSchema = z.strictObject({
  type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']),
  description: z.string().max(8192).optional(), title: z.string().max(256).optional(),
  properties: z.unknown().optional(), required: z.array(z.string()).optional(),
  additionalProperties: z.literal(false).optional(), prefixItems: z.array(z.unknown()).optional(),
  items: z.literal(false).optional(), enum: z.array(scalar).min(1).max(255).optional(),
  const: scalar.optional(), minimum: z.number().finite().optional(), maximum: z.number().finite().optional(),
});
function fail(): never { throw new Fault('invalid_schema', 400); }

// A bounded schema subset is interpreted once into a numeric codec. No user schema
// is evaluated as code, and no provider string is ever used as an output value.
export function compileSchema(input: unknown, description?: string): { job: Job; decode: (values: number[]) => Value } {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > 65_536) return fail();
  const slots: NumericSlot[] = [];
  const rubrics: unknown[] = [];
  const context: { field: string[]; description: string }[] = [];
  let propertyCount = 0;
  let enumCount = 0;
  function build(raw: unknown, path: string[], depth: number): Node {
    if (depth > 10) return fail();
    const parsed = rawSchema.safeParse(raw);
    if (!parsed.success || !record(raw)) return fail();
    const s = parsed.data;
    if (s.description && (s.type === 'object' || s.type === 'array')) context.push({ field: path, description: s.description });
    const common = ['type', 'description', 'title'];
    const permitted = s.type === 'object' ? ['properties', 'required', 'additionalProperties']
      : s.type === 'array' ? ['prefixItems', 'items']
      : ['enum', 'const', ...(s.type === 'number' || s.type === 'integer' ? ['minimum', 'maximum'] : [])];
    if (Object.keys(raw).some(k => !common.includes(k) && !permitted.includes(k))) return fail();
    if (s.type === 'object') {
      if (!record(s.properties) || s.additionalProperties !== false || !s.required) return fail();
      const keys = Object.keys(s.properties);
      propertyCount += keys.length;
      if (propertyCount > 500 || new Set(s.required).size !== keys.length || s.required.length !== keys.length || keys.some(k => !s.required?.includes(k) || Buffer.byteLength(k) > 256 || !k.length)) return fail();
      return { kind: 'object', entries: Object.entries(s.properties).map(([key, value]) => [key, build(value, [...path, key], depth + 1)]) };
    }
    if (s.type === 'array') {
      if (!s.prefixItems || s.items !== false || s.prefixItems.length > 255) return fail();
      return { kind: 'tuple', items: s.prefixItems.map((value, i) => build(value, [...path, String(i)], depth + 1)) };
    }
    const matchesType = (v: unknown) => s.type === 'null' ? v === null : s.type === 'integer' ? typeof v === 'number' && Number.isSafeInteger(v) : typeof v === s.type;
    const withinBounds = (v: unknown) => typeof v !== 'number' || ((s.minimum === undefined || v >= s.minimum) && (s.maximum === undefined || v <= s.maximum));
    if (s.minimum !== undefined && s.maximum !== undefined && s.minimum > s.maximum) return fail();
    if (s.enum && (s.enum.some(v => !matchesType(v) || !withinBounds(v)) || new Set(s.enum).size !== s.enum.length)) return fail();
    if (Object.hasOwn(raw, 'const')) {
      const value = s.const;
      if (value === undefined || !matchesType(value) || !withinBounds(value) || (s.enum && !s.enum.includes(value))) return fail();
      return { kind: 'constant', value };
    }
    if (s.type === 'null') return { kind: 'constant', value: null };
    const values = s.enum ?? (s.type === 'boolean' ? [false, true] : undefined);
    if (s.type === 'string' && !values) return fail();
    const index = slots.length;
    if (index >= 255) return fail();
    if (values) {
      enumCount += values.length;
      if (enumCount > 500) return fail();
      slots.push({ type: 'integer', minimum: 0, maximum: values.length - 1 });
      // Explicit indices avoid models treating a two-choice selection as a yes/no
      // probability (1) or using one-based positions. The decoder stays unchanged.
      rubrics.push({ field: path, description: s.description ?? '', allowedSelections: values.map((value, index) => ({ index, value })) });
      return { kind: 'leaf', index, values };
    }
    if (s.minimum === undefined || s.maximum === undefined || Math.abs(s.minimum) > 1e6 || Math.abs(s.maximum) > 1e6) return fail();
    if (s.type !== 'number' && s.type !== 'integer') return fail();
    if (s.type === 'integer' && Math.ceil(s.minimum) > Math.floor(s.maximum)) return fail();
    slots.push({ type: s.type, minimum: s.minimum, maximum: s.maximum });
    rubrics.push({ field: path, description: s.description ?? '', minimum: s.minimum, maximum: s.maximum });
    return { kind: 'leaf', index };
  }
  if (!record(input) || input.type !== 'object') return fail();
  const root = build(input, [], 1);
  function materialize(node: Node, values: number[]): Value {
    switch (node.kind) {
      case 'constant': return node.value;
      case 'object': return Object.fromEntries(node.entries.map(([key, child]) => [key, materialize(child, values)]));
      case 'tuple': return node.items.map(child => materialize(child, values));
      case 'leaf': {
        const value = values[node.index];
        if (value === undefined) return badOutput();
        if (!node.values) return value;
        const selected = node.values[value];
        if (selected === undefined) return badOutput();
        return selected;
      }
    }
  }
  return { job: { rubric: { task: 'Return one numeric value for each field in order. Selections are ZERO-BASED indices.',
    ...(description ? { description } : {}), ...(context.length ? { context } : {}), fields: rubrics }, slots },
    decode(values) { validateNumbers(values, slots); return materialize(root, values); } };
}
export function validateNumbers(raw: unknown, slots: NumericSlot[]): number[] {
  const parsed = z.array(z.number().finite()).safeParse(raw);
  if (!parsed.success || parsed.data.length !== slots.length) return badOutput();
  for (const [i, slot] of slots.entries()) {
    const value = parsed.data[i];
    if (value === undefined || value < slot.minimum || value > slot.maximum || (slot.type === 'integer' && !Number.isSafeInteger(value))) return badOutput();
  }
  return parsed.data;
}
