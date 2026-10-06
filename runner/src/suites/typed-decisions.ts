// typed-decisions: LocalLLaMA/typed-decisions, the Hub-official System One benchmark.
// Loading is pinned by revision and SHA-256; scoring follows suites/typed-decisions/suite.yaml.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { fetchPinned, readParquet } from '../datasets.ts';
import { rng, wilson, bootstrapMean, roundInterval, round6, type Interval } from '../stats.ts';
import type { RawRow, SuiteItem, SuiteModule } from '../suite.ts';

type Dist = Record<string, number>;
export type GoldAnswer = { type: 'choice' | 'score' | 'noul'; label: string; probabilities: Dist };
export type Case = { id: string; workflow: string; state: unknown; questions: Record<string, unknown>; gold: Record<string, GoldAnswer> };
type SuiteDef = { dataset: { repo: string; revision: string; workflows: string[]; files: Record<string, string>; train_files: Record<string, string> } };

const SUITE_DIR = (root: string) => join(root, 'suites', 'typed-decisions');
export const TOLERANCE = 0.01;
const EPS = 1e-12;

export function suiteDef(root: string): SuiteDef {
  return YAML.parse(readFileSync(join(SUITE_DIR(root), 'suite.yaml'), 'utf8')) as SuiteDef;
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const parse = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);

function toGold(raw: unknown): Record<string, GoldAnswer> {
  const out: Record<string, GoldAnswer> = {};
  for (const [k, v] of Object.entries(asRecord(raw))) {
    const g = asRecord(v);
    const type = g.type;
    if (type !== 'choice' && type !== 'score' && type !== 'noul') throw new Error(`gold ${k}: unknown type`);
    const probabilities = Object.fromEntries(Object.entries(asRecord(g.probabilities)).map(([o, p]) => [o, Number(p)]));
    out[k] = { type, label: String(g.label), probabilities };
  }
  return out;
}

/** Load pinned cases for a split ('test' sends to subjects; 'train' only rebuilds the Prior). */
export async function loadCases(root: string, split: 'test' | 'train' = 'test'): Promise<Case[]> {
  const def = suiteDef(root);
  const files = split === 'test' ? def.dataset.files : def.dataset.train_files;
  const cases: Case[] = [];
  for (const [path, sha256] of Object.entries(files)) {
    const local = await fetchPinned({ repo: def.dataset.repo, revision: def.dataset.revision, path, sha256 });
    for (const r of await readParquet(local, ['id', 'workflow', 'state', 'questions', 'gold'])) {
      cases.push({ id: String(r.id), workflow: String(r.workflow), state: parse(r.state), questions: asRecord(parse(r.questions)), gold: toGold(parse(r.gold)) });
    }
  }
  return cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Seeded, stratified quick subset: n cases per workflow. Generated once and committed as quick.ids. */
export function quickIds(cases: Case[], perWorkflow = 25, seed = 20261006): string[] {
  const out: string[] = [];
  for (const wf of [...new Set(cases.map((c) => c.workflow))].sort()) {
    const ids = cases.filter((c) => c.workflow === wf).map((c) => c.id);
    const next = rng(seed);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [ids[i], ids[j]] = [ids[j] as string, ids[i] as string]; }
    out.push(...ids.slice(0, perWorkflow).sort());
  }
  return out;
}

/** A model answer turned into a distribution over the gold's options, or the reason it is invalid. */
export type Prediction = { ok: true; dist: Dist } | { ok: false; reason: string };

export function predict(answer: unknown, gold: GoldAnswer): Prediction {
  const a = asRecord(answer);
  const options = Object.keys(gold.probabilities);
  if (gold.type === 'noul') {
    const p = Number(a.noul);
    if (!Number.isFinite(p) || p < 0 || p > 1) return { ok: false, reason: 'noul missing or outside [0, 1]' };
    return { ok: true, dist: { false: 1 - p, true: p } };
  }
  const probs = asRecord(a.probabilities);
  const keys = Object.keys(probs);
  if (keys.length !== options.length || options.some((o) => !(o in probs))) return { ok: false, reason: `options differ: got [${keys.join(', ')}]` };
  const values = options.map((o) => Number(probs[o]));
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return { ok: false, reason: 'probability outside [0, 1]' };
  const total = values.reduce((s, v) => s + v, 0);
  // The slack keeps 'within 0.01' inclusive: providers that round to 2 decimals sum to exactly 0.99.
  if (Math.abs(total - 1) > TOLERANCE + 1e-9) return { ok: false, reason: `probabilities sum to ${round6(total)}` };
  return { ok: true, dist: Object.fromEntries(options.map((o, i) => [o, (values[i] ?? 0) / total])) };
}

/** Argmax, ties to the first option in the gold's option order. */
export function argmax(dist: Dist, options: string[]): string {
  let best = options[0] ?? '';
  for (const o of options) if ((dist[o] ?? 0) > (dist[best] ?? 0)) best = o;
  return best;
}

export type Decision = { workflow: string; question: string; type: GoldAnswer['type']; gold: GoldAnswer; pred: Prediction };

export type DecisionMetrics = {
  decisions: number; valid: number;
  accuracy: Interval; kl_from_gold: Interval | null; brier: Interval | null; ece: number | null;
  accuracy_by_type: Record<string, Interval>; accuracy_by_workflow: Record<string, Interval>;
};

/** Score decisions with the suite's definitions (scoring.version 1). */
export function scoreDecisions(decisions: Decision[]): DecisionMetrics {
  const correct: number[] = [];
  const kl: number[] = [];
  const brier: number[] = [];
  const conf: [number, number][] = [];
  const byType = new Map<string, number[]>();
  const byWf = new Map<string, number[]>();
  for (const d of decisions) {
    const options = Object.keys(d.gold.probabilities);
    let ok = 0;
    if (d.pred.ok) {
      const p = d.pred.dist;
      const top = argmax(p, options);
      ok = top === d.gold.label ? 1 : 0;
      kl.push(options.reduce((s, o) => { const g = d.gold.probabilities[o] ?? 0; return g > 0 ? s + g * Math.log(g / Math.max(p[o] ?? 0, EPS)) : s; }, 0));
      brier.push(options.reduce((s, o) => s + ((p[o] ?? 0) - (d.gold.probabilities[o] ?? 0)) ** 2, 0));
      conf.push([p[top] ?? 0, ok]);
    }
    correct.push(ok);
    (byType.get(d.type) ?? byType.set(d.type, []).get(d.type))?.push(ok);
    (byWf.get(d.workflow) ?? byWf.set(d.workflow, []).get(d.workflow))?.push(ok);
  }
  const prop = (xs: number[]) => roundInterval(wilson(xs.reduce((a, b) => a + b, 0), xs.length));
  const sortObj = (m: Map<string, number[]>) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, prop(v)]));
  return {
    decisions: decisions.length, valid: kl.length,
    accuracy: prop(correct),
    kl_from_gold: kl.length ? roundInterval(bootstrapMean(kl)) : null,
    brier: brier.length ? roundInterval(bootstrapMean(brier)) : null,
    ece: conf.length ? round6(ece(conf)) : null,
    accuracy_by_type: sortObj(byType), accuracy_by_workflow: sortObj(byWf),
  };
}

export function ece(items: [number, number][], bins = 10): number {
  const groups = new Map<number, [number, number][]>();
  for (const it of items) { const b = Math.min(bins - 1, Math.floor(it[0] * bins)); (groups.get(b) ?? groups.set(b, []).get(b))?.push(it); }
  let total = 0;
  for (const g of groups.values()) {
    const c = g.reduce((s, [x]) => s + x, 0) / g.length;
    const a = g.reduce((s, [, y]) => s + y, 0) / g.length;
    total += (g.length / items.length) * Math.abs(c - a);
  }
  return total;
}

/** A stable reason for a failed request: status and error code, never per-request ids. */
export function failureReason(row: RawRow): string {
  const code = asRecord(asRecord(row.response).error).code ?? asRecord(row.response).code;
  return `HTTP ${row.status}${typeof code === 'string' ? ` ${code}` : ''}`;
}

/** Decisions from raw rows: each row is one case, sent whole. */
export function decisionsFromRows(rows: RawRow[]): Decision[] {
  const out: Decision[] = [];
  for (const row of rows) {
    const expected = asRecord(row.expected);
    const gold = expected.gold as Record<string, GoldAnswer>;
    const answers = asRecord(asRecord(row.response).answers);
    for (const [q, g] of Object.entries(gold)) {
      const pred: Prediction = !row.ok ? { ok: false, reason: failureReason(row) }
        : !(q in answers) ? { ok: false, reason: 'answer missing' } : predict(answers[q], g);
      out.push({ workflow: String(expected.workflow), question: q, type: g.type, gold: g, pred });
    }
  }
  return out;
}

export const typedDecisions: SuiteModule = {
  name: 'typed-decisions',
  protocol: 'decision',
  scorer: { name: 'bench/typed-decisions', version: '1' },
  sourceFiles: ['runner/src/suites/typed-decisions.ts'],
  async items(root, tier): Promise<SuiteItem[]> {
    const ids = new Set(readFileSync(join(SUITE_DIR(root), `${tier}.ids`), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
    const cases = (await loadCases(root, 'test')).filter((c) => ids.has(c.id));
    if (cases.length !== ids.size) throw new Error(`typed-decisions ${tier}: ${ids.size} ids but ${cases.length} cases found`);
    return cases.map((c) => ({ id: c.id, body: { state: c.state, questions: c.questions }, expected: { workflow: c.workflow, gold: c.gold } }));
  },
  summarize(rows) {
    const m = scoreDecisions(decisionsFromRows(rows));
    const invalid = new Map<string, number>();
    for (const d of decisionsFromRows(rows)) if (!d.pred.ok) invalid.set(d.pred.reason, (invalid.get(d.pred.reason) ?? 0) + 1);
    return {
      metrics: m,
      invalid_reasons: Object.fromEntries([...invalid.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
      notes: [
        'accuracy counts every dispatched decision; kl_from_gold, brier and ece use valid decisions only',
        'ece uses 10-bin top-label confidence; the dataset card does not define its ECE, so ece is not comparable with the card',
        'intervals treat decisions as independent; each case contributes five related decisions, so true uncertainty is somewhat wider',
      ],
    };
  },
};
