// decision-conformance: protocol checks re-implemented from finnhll/jev-eval (MIT).
// See suites/decision-conformance/suite.yaml for the exact rules and tolerances.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawRow, SuiteItem, SuiteModule } from '../suite.ts';
import { round6 } from '../stats.ts';

type Question = { type: 'choice' | 'score' | 'noul'; instructions: string; criteria: unknown };
type Probes = {
  repeats: number;
  batched: { id: string; state: unknown; questions: Record<string, Question> }[];
  monotonic: { id: string; question: Question; states: unknown[] };
};
type Expected =
  | { kind: 'batched'; probe: string; rep: number; questions: Record<string, Question> }
  | { kind: 'separate'; probe: string; question: string; questions: Record<string, Question> }
  | { kind: 'reversed'; probe: string; questions: Record<string, Question> }
  | { kind: 'monotonic'; probe: string; index: number; questions: Record<string, Question> };

export const SUM_TOLERANCE = 0.01;
export const SEPARATE_TOLERANCE = 0.05;
export const REPEAT_STD_LIMIT = 0.02;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function loadProbes(root: string): Probes {
  return JSON.parse(readFileSync(join(root, 'suites', 'decision-conformance', 'probes.json'), 'utf8')) as Probes;
}

function reverseChoices(questions: Record<string, Question>): Record<string, Question> {
  return Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.type === 'choice'
    ? { ...q, criteria: Object.fromEntries(Object.entries(rec(q.criteria)).reverse()) } : q]));
}

export function options(q: Question): string[] {
  if (q.type === 'choice') return Object.keys(rec(q.criteria)).sort();
  if (q.type === 'score') return (Array.isArray(q.criteria) ? q.criteria : []).map((_, i) => String(i));
  return ['false', 'true'];
}

/** The answer as a distribution, for comparisons across requests. */
export function distribution(q: Question, answer: unknown): Record<string, number> | null {
  const a = rec(answer);
  if (q.type === 'noul') { const p = Number(a.noul); return Number.isFinite(p) ? { false: 1 - p, true: p } : null; }
  const probs = rec(a.probabilities);
  const out: Record<string, number> = {};
  for (const o of options(q)) { const v = Number(probs[o]); if (!Number.isFinite(v)) return null; out[o] = v; }
  return out;
}

/** Structural invariants for one answer; returns the failures (empty when it passes). */
export function invariantFailures(q: Question, answer: unknown): string[] {
  const a = rec(answer);
  const f: string[] = [];
  if (a.type !== q.type) f.push(`type ${String(a.type)} != ${q.type}`);
  if (q.type === 'noul') {
    const p = Number(a.noul);
    if (!Number.isFinite(p) || p < 0 || p > 1) f.push('noul not in [0, 1]');
    return f;
  }
  const probs = rec(a.probabilities);
  const want = options(q);
  const got = Object.keys(probs).sort();
  if (got.join('\u0000') !== [...want].sort().join('\u0000')) { f.push('options differ from criteria'); return f; }
  const values = want.map((o) => Number(probs[o]));
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) f.push('probability outside [0, 1]');
  const total = values.reduce((s, v) => s + v, 0);
  // Tolerances are inclusive; the 1e-9 slack absorbs float error at the boundary (2-decimal rounding).
  if (Math.abs(total - 1) > SUM_TOLERANCE + 1e-9) f.push(`sum ${round6(total)}`);
  if (q.type === 'choice') {
    const max = Math.max(...values);
    if (typeof a.choice !== 'string' || Number(probs[a.choice]) < max - 1e-9) f.push('choice is not an argmax');
    const c = Number(a.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) f.push('confidence missing or outside [0, 1]');
  } else {
    const expected = values.reduce((s, v, i) => s + v * i, 0) / (total || 1);
    if (!Number.isFinite(Number(a.score)) || Math.abs(Number(a.score) - expected) > SUM_TOLERANCE + 1e-9) f.push('score is not the weighted mean');
  }
  return f;
}

type Check = { passed: number; total: number; failures: string[]; [k: string]: unknown };
const check = (): Check => ({ passed: 0, total: 0, failures: [] });
const mark = (c: Check, ok: boolean, why: string) => { c.total++; if (ok) c.passed++; else c.failures.push(why); };

export function summarizeConformance(rows: RawRow[]): Record<string, unknown> {
  const inv = check(); const sep = check(); const rep = check(); const ord = check(); const mono = check();
  const answersOf = (r: RawRow) => rec(rec(r.response).answers);
  const byKind = (kind: Expected['kind']) => rows.filter((r) => rec(r.expected).kind === kind);
  for (const r of rows) {
    const e = r.expected as Expected;
    for (const [id, q] of Object.entries(e.questions)) {
      if (!r.ok) { mark(inv, false, `${r.item_id}: request failed (${r.error ?? r.status})`); continue; }
      const fails = invariantFailures(q, answersOf(r)[id]);
      mark(inv, fails.length === 0, `${r.item_id}/${id}: ${fails.join('; ')}`);
    }
  }
  let maxDiff = 0; let maxStd = 0; let maxConfDelta = 0;
  for (const b of byKind('batched').filter((r) => (r.expected as Expected & { rep: number }).rep === 1)) {
    const e = b.expected as Extract<Expected, { kind: 'batched' }>;
    for (const [id, q] of Object.entries(e.questions)) {
      const s = byKind('separate').find((r) => { const x = r.expected as Expected; return x.probe === e.probe && x.kind === 'separate' && x.question === id; });
      const p1 = b.ok ? distribution(q, answersOf(b)[id]) : null;
      const p2 = s?.ok ? distribution(q, answersOf(s)[id]) : null;
      if (!p1 || !p2) { mark(sep, false, `${e.probe}/${id}: missing answer`); continue; }
      const diff = Math.max(...options(q).map((o) => Math.abs((p1[o] ?? 0) - (p2[o] ?? 0))));
      maxDiff = Math.max(maxDiff, diff);
      mark(sep, diff <= SEPARATE_TOLERANCE + 1e-9, `${e.probe}/${id}: differs by ${round6(diff)}`);
      const reps = byKind('batched').filter((r) => (r.expected as Expected).probe === e.probe).map((r) => (r.ok ? distribution(q, answersOf(r)[id]) : null));
      if (reps.some((x) => !x)) { mark(rep, false, `${e.probe}/${id}: a repeat failed`); continue; }
      const std = Math.max(...options(q).map((o) => {
        const xs = reps.map((x) => x?.[o] ?? 0); const m = xs.reduce((a, c) => a + c, 0) / xs.length;
        return Math.sqrt(xs.reduce((a, c) => a + (c - m) ** 2, 0) / xs.length);
      }));
      maxStd = Math.max(maxStd, std);
      mark(rep, std <= REPEAT_STD_LIMIT + 1e-9, `${e.probe}/${id}: std ${round6(std)}`);
      if (q.type === 'choice') {
        const rv = byKind('reversed').find((r) => (r.expected as Expected).probe === e.probe);
        const a = rec(answersOf(b)[id]); const z = rv?.ok ? rec(answersOf(rv)[id]) : {};
        maxConfDelta = Math.max(maxConfDelta, Math.abs(Number(a.confidence ?? 0) - Number(z.confidence ?? 0)));
        mark(ord, a.choice !== undefined && a.choice === z.choice, `${e.probe}/${id}: ${String(a.choice)} vs ${String(z.choice)} when reversed`);
      }
    }
  }
  const series = byKind('monotonic').sort((a, b) => (a.expected as { index: number }).index - (b.expected as { index: number }).index);
  const scores = series.map((r) => { const q = Object.values((r.expected as Expected).questions)[0]; const d = q && r.ok ? distribution(q, Object.values(answersOf(r))[0]) : null; return d ? Object.entries(d).reduce((s, [k, v]) => s + Number(k) * v, 0) : null; });
  for (let i = 1; i < scores.length; i++) {
    const a = scores[i - 1]; const b = scores[i];
    mark(mono, a !== null && a !== undefined && b !== null && b !== undefined && b >= a - 1e-9, `state ${i - 1} -> ${i}: ${String(a)} -> ${String(b)}`);
  }
  sep.max_abs_diff = round6(maxDiff); rep.max_std = round6(maxStd); ord.max_confidence_delta = round6(maxConfDelta);
  mono.expected_scores = scores.map((s) => (s === null || s === undefined ? null : round6(s)));
  const checks = { invariants: inv, batched_vs_separate: sep, repeat_stability: rep, option_order: ord, monotonic: mono };
  const all = Object.values(checks);
  return { metrics: { checks, passed: all.reduce((s, c) => s + c.passed, 0), total: all.reduce((s, c) => s + c.total, 0) } };
}

export const decisionConformance: SuiteModule = {
  name: 'decision-conformance',
  protocol: 'decision',
  scorer: { name: 'bench/decision-conformance', version: '1' },
  sourceFiles: ['runner/src/suites/decision-conformance.ts', 'suites/decision-conformance/probes.json'],
  async items(root): Promise<SuiteItem[]> {
    const p = loadProbes(root);
    const items: SuiteItem[] = [];
    for (const b of p.batched) {
      for (let r = 1; r <= p.repeats; r++) items.push({ id: `batched:${b.id}:r${r}`, body: { state: b.state, questions: b.questions }, expected: { kind: 'batched', probe: b.id, rep: r, questions: b.questions } });
      for (const [qid, q] of Object.entries(b.questions)) items.push({ id: `separate:${b.id}:${qid}`, body: { state: b.state, questions: { [qid]: q } }, expected: { kind: 'separate', probe: b.id, question: qid, questions: { [qid]: q } } });
      const reversed = reverseChoices(b.questions);
      items.push({ id: `reversed:${b.id}`, body: { state: b.state, questions: reversed }, expected: { kind: 'reversed', probe: b.id, questions: reversed } });
    }
    p.monotonic.states.forEach((state, i) => {
      const questions = { severity: p.monotonic.question };
      items.push({ id: `monotonic:${p.monotonic.id}:${i}`, body: { state, questions }, expected: { kind: 'monotonic', probe: p.monotonic.id, index: i, questions } });
    });
    return items;
  },
  summarize: summarizeConformance,
};
