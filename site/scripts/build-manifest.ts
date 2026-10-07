#!/usr/bin/env node
// Build the site's manifest from the committed records:
//   results/<subject key>/<suite>/<run>/{run.json, summary.json, raw.jsonl, harness/}
//   subjects/<subject key>/subject.yaml, suites/<name>/suite.yaml, results/references.yaml
// -> lib/manifest.generated.json   (what every page renders)
// -> public/results/<run id>/...   (the run's files, downloadable from its page)
// A run folder without summary.json is still in progress and is skipped. `--check`
// validates only and writes nothing.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type {
  Board, ConformanceRun, DecisionsRun, EmbeddingDim, EmbeddingsRun, Fidelity, Hardware, Interval, Manifest,
  Matrix, RecipeRef, Run, Subject, Suite, Verdict,
} from '../lib/types.ts';
import { engineFamily } from './engines.ts';
import { overall } from './overall.ts';
import { bootstrapMean, rankBands } from './stats.ts';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.env.BENCH_ROOT ?? join(SITE, '..');
const RESULTS = join(ROOT, 'results');
const REPO = 'https://github.com/iammrduncan/inference-benchmarks';
const ENGINES_REPO = 'https://github.com/iammrduncan/inference-engines';
const checkOnly = process.argv.includes('--check');

// Hardware classes are the hardware segment of a recipe id (`<model>/<hardware>/<variant>`).
const HARDWARE: Record<string, string> = {
  p100: 'NVIDIA Tesla P100 16 GB',
  b70: 'Intel Arc Pro B70',
  'apple-m': 'Apple M-series',
  'esp32-s3': 'ESP32-S3',
  'gb10-dgx-spark': 'NVIDIA DGX Spark (GB10)',
};

// ---- validation helpers: records are parsed as unknown and checked before use ----------

class RecordError extends Error {}
type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new RecordError(`${where}: expected an object`);
  return v as Obj;
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new RecordError(`${where}: expected a string`);
  return v;
}
function optStr(v: unknown, where: string): string | null {
  return v === null || v === undefined ? null : str(v, where);
}
function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RecordError(`${where}: expected a finite number`);
  return v;
}
function interval(v: unknown, where: string): Interval {
  const o = obj(v, where);
  return { value: num(o.value, `${where}.value`), low: num(o.low, `${where}.low`), high: num(o.high, `${where}.high`), n: num(o.n, `${where}.n`) };
}
function strRecord(v: unknown, where: string): Record<string, string> {
  const o = obj(v, where);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, String(x)]));
}
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()) : []);
const posix = (p: string) => p.split(sep).join('/');

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

// ---- suites -------------------------------------------------------------------------------

function loadSuites(): Suite[] {
  return dirs(join(ROOT, 'suites')).flatMap((name) => {
    const file = join(ROOT, 'suites', name, 'suite.yaml');
    if (!existsSync(file)) return [];
    const y = obj(YAML.parse(readFileSync(file, 'utf8')), `suites/${name}/suite.yaml`);
    const tiers = obj(y.tiers ?? {}, `suites/${name}.tiers`);
    const scorer = y.scorer === undefined ? null : obj(y.scorer, `suites/${name}.scorer`);
    return [{
      name: str(y.name, `suites/${name}.name`),
      status: str(y.status, `suites/${name}.status`),
      description: str(y.description, `suites/${name}.description`).trim(),
      protocol: str(y.protocol, `suites/${name}.protocol`),
      category: optStr(y.category, `suites/${name}.category`),
      tiers: Object.fromEntries(Object.entries(tiers).map(([t, v]) => {
        const tier = typeof v === 'object' && v !== null ? (v as Obj) : {};
        return [t, typeof tier.note === 'string' ? tier.note : ''];
      })),
      scorer: scorer ? `${String(scorer.name)} ${String(scorer.version)}` : null,
    }];
  });
}

// ---- runs ---------------------------------------------------------------------------------

/** Every folder that holds a run.json, as a path relative to results/. */
function findRunDirs(dir = RESULTS): string[] {
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, 'run.json'))) return [posix(relative(RESULTS, dir))];
  return dirs(dir).flatMap((d) => findRunDirs(join(dir, d)));
}

const VENDORS: Record<string, string> = { nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple' };

/** "Apple M4 Pro · 24 GB", "NVIDIA P100 · 16 GB": the exact device, not just its family. */
export function deviceLabel(d: Obj, observed: Obj | null): string {
  if (d.kind === 'apple-silicon') {
    const chip = typeof observed?.chip === 'string' ? observed.chip : `Apple ${String(d.chip ?? d.label ?? 'silicon')}`;
    const mem = observed?.memory_gb ?? d.memory_gb;
    return mem !== undefined ? `${chip} · ${String(mem)} GB` : chip;
  }
  if (d.kind === 'gpu') {
    const vendor = typeof d.vendor === 'string' ? (VENDORS[d.vendor] ?? d.vendor) : '';
    const name = `${vendor} ${String(d.model ?? d.label ?? 'GPU')}`.trim();
    return d.vram_gb !== undefined ? `${name} · ${String(d.vram_gb)} GB` : name;
  }
  return String(d.chip ?? d.model ?? d.label ?? d.kind);
}

function hardwareOf(run: Obj): Hardware | null {
  if (run.hardware === undefined || run.hardware === null) return null;
  const h = obj(run.hardware, 'run.hardware');
  const recipe = optStr(h.recipe, 'run.hardware.recipe');
  const family = recipe?.split('/')[1] ?? 'unknown';
  const host = optStr(h.host, 'run.hardware.host') ?? 'unknown';
  const placements = Array.isArray(h.placements) ? h.placements.map((p, i) => obj(p, `run.hardware.placements[${i}]`)) : [];
  const devices = placements.flatMap((p) => {
    const observed = p.observed ? obj(p.observed, 'run.hardware.observed') : null;
    return (Array.isArray(p.devices) ? p.devices : []).map((d, i) => ({ d: obj(d, `run.hardware.devices[${i}]`), observed }));
  });
  if (devices.length === 0) {
    // Older records name only the recipe's hardware family.
    return { class: family, label: HARDWARE[family] ?? family, host };
  }
  const labels = devices.map((x) => deviceLabel(x.d, x.observed));
  const counted = [...new Set(labels)].map((l) => {
    const n = labels.filter((x) => x === l).length;
    return n > 1 ? `${n}× ${l}` : l;
  });
  const ids = devices.map((x) => String(x.d.label ?? x.d.kind));
  const note = optStr(h.backfilled, 'run.hardware.backfilled');
  return { class: `${family}:${[...new Set(ids)].join('+')}`, label: counted.join(' + '), host, ...(note ? { note } : {}) };
}

function recipeOf(run: Obj): RecipeRef | null {
  if (run.launcher === undefined || run.hardware === undefined) return null;
  const l = obj(run.launcher, 'run.launcher');
  const h = obj(run.hardware, 'run.hardware');
  const source = obj(l.source, 'run.launcher.source');
  return {
    id: str(h.recipe, 'run.hardware.recipe'),
    profile: optStr(l.profile, 'run.launcher.profile'),
    commit: str(source.commit, 'run.launcher.source.commit'),
    // The launcher may clone from a local mirror; the public repository is what readers can use.
    repo: optStr(source.mirror, 'run.launcher.source.mirror') ?? ENGINES_REPO,
    params: strRecord(l.params ?? {}, 'run.launcher.params'),
  };
}

function resultsRelative(path: string | null): string | null {
  if (!path) return null;
  const i = path.indexOf('/results/');
  return i >= 0 ? path.slice(i + '/results/'.length) : path.replace(/^results\//, '');
}

function reproduce(subject: Obj, suite: string, tier: string, profile: string, mode: string, recipe: RecipeRef | null, hardware: Hardware | null, reference: string | null): string {
  const tail = `--suite ${suite} --tier ${tier} --profile ${profile}`;
  const target = str(subject.target, 'subject.target');
  if (target === 'recipe' && recipe) {
    const parts = [`npm run bench -- run --recipe ${recipe.id}`];
    if (recipe.profile) parts.push(`--recipe-profile ${recipe.profile}`);
    if (hardware) parts.push(`--on <host with a ${hardware.class}>`);
    parts.push(tail);
    if (reference) parts.push(`--reference results/${reference}`);
    return parts.join(' \\\n    ');
  }
  if (target === 'cloud') {
    const cp = obj(subject.checkpoint, 'subject.checkpoint');
    const via = mode.startsWith('gateway:') ? ` --via ${mode}` : '';
    return `op run --env-file=benchmarks.env.op -- \\\n  npm run bench -- run --cloud ${String(cp.provider)}:${String(cp.model_id)}${via} \\\n    ${tail}`;
  }
  return `npm run bench -- run --endpoint <URL> --identity <identity.yaml> --model <name> ${tail}`;
}

function fidelity(v: unknown, where: string): Fidelity | null {
  if (v === undefined || v === null) return null;
  const f = obj(v, where);
  const verdict = str(f.verdict, `${where}.verdict`);
  if (!['broken', 'degraded', 'faithful', 'lossless'].includes(verdict)) throw new RecordError(`${where}.verdict: unknown verdict ${verdict}`);
  return {
    n: num(f.n, `${where}.n`), mean_cosine: num(f.mean_cosine, `${where}.mean_cosine`), p1_cosine: num(f.p1_cosine, `${where}.p1_cosine`),
    min_cosine: num(f.min_cosine, `${where}.min_cosine`), top10_overlap: num(f.top10_overlap, `${where}.top10_overlap`),
    queries: num(f.queries, `${where}.queries`), documents: num(f.documents, `${where}.documents`), verdict: verdict as Verdict,
  };
}

type Loaded = { run: Run; subject: Obj };

function loadRun(id: string): Loaded | null {
  const dir = join(RESULTS, id);
  if (!existsSync(join(dir, 'summary.json'))) return null; // still running, or failed before summarizing
  const where = `results/${id}`;
  const run = obj(readJson(join(dir, 'run.json')), `${where}/run.json`);
  const summary = obj(readJson(join(dir, 'summary.json')), `${where}/summary.json`);
  const subject = obj(run.subject, `${where}/run.json subject`);
  const suite = obj(run.suite, `${where}/run.json suite`);
  const harness = obj(run.harness, `${where}/run.json harness`);
  const scorer = harness.scorer === null || harness.scorer === undefined ? null : obj(harness.scorer, `${where} harness.scorer`);
  const items = obj(summary.items, `${where}/summary.json items`);
  const latency = summary.latency_ms ? obj(summary.latency_ms, `${where} latency_ms`) : null;
  const usage = summary.usage ? obj(summary.usage, `${where} usage`) : null;
  const suiteName = str(suite.name, `${where} suite.name`);
  const tier = str(suite.tier, `${where} suite.tier`);
  const profile = str(run.profile, `${where} profile`);
  const mode = str(run.mode, `${where} mode`);
  const hardware = hardwareOf(run);
  const recipe = recipeOf(run);
  const reference = resultsRelative(optStr(run.reference, `${where} reference`));
  const subjectKey = str(subject.key, `${where} subject.key`);
  if (!id.startsWith(`${subjectKey}/${suiteName}/`)) throw new RecordError(`${where}: folder does not match subject key ${subjectKey} and suite ${suiteName}`);

  const base = {
    id, run_id: str(run.run_id, `${where} run_id`), subject: subjectKey, suite: suiteName, tier, profile, mode,
    status: str(summary.status, `${where} status`), label: optStr(summary.label, `${where} label`),
    started_at: str(run.started_at, `${where} started_at`), finished_at: str(run.finished_at, `${where} finished_at`),
    items: {
      planned: num(items.planned, `${where} items.planned`), attempted: num(items.attempted, `${where} items.attempted`),
      succeeded: num(items.succeeded, `${where} items.succeeded`), failed: num(items.failed, `${where} items.failed`),
    },
    harness: {
      commit: str(harness.commit, `${where} harness.commit`), dirty: harness.dirty === true,
      scorer: scorer ? `${String(scorer.name)} ${String(scorer.version)}` : 'bench', suite_hash: str(harness.suite_hash, `${where} harness.suite_hash`),
    },
    latency_ms: latency ? { p50: num(latency.p50, `${where} p50`), p95: num(latency.p95, `${where} p95`), p99: num(latency.p99, `${where} p99`) } : null,
    usage: usage ? { input_tokens: num(usage.input_tokens, `${where} input_tokens`), output_tokens: num(usage.output_tokens, `${where} output_tokens`), cost_usd: num(usage.cost_usd, `${where} cost_usd`) } : null,
    hardware, recipe,
    endpoint: optStr(run.endpoint, `${where} endpoint`),
    files: walkFiles(dir).map((p) => posix(relative(dir, p))).sort(),
    notes: Array.isArray(summary.notes) ? summary.notes.map(String) : [],
    reproduce: reproduce(subject, suiteName, tier, profile, mode, recipe, hardware, reference),
  };
  const metrics = obj(summary.metrics, `${where} metrics`);

  if (suiteName === 'typed-decisions') {
    const r: DecisionsRun = {
      ...base, kind: 'decisions',
      metrics: {
        decisions: num(metrics.decisions, `${where} decisions`), valid: num(metrics.valid, `${where} valid`),
        accuracy: interval(metrics.accuracy, `${where} accuracy`), kl_from_gold: interval(metrics.kl_from_gold, `${where} kl`),
        brier: interval(metrics.brier, `${where} brier`), ece: num(metrics.ece, `${where} ece`),
        accuracy_by_type: Object.fromEntries(Object.entries(obj(metrics.accuracy_by_type, `${where} by_type`)).map(([k, v]) => [k, interval(v, `${where} by_type.${k}`)])),
        accuracy_by_workflow: Object.fromEntries(Object.entries(obj(metrics.accuracy_by_workflow, `${where} by_workflow`)).map(([k, v]) => [k, interval(v, `${where} by_workflow.${k}`)])),
      },
      invalid_reasons: Object.fromEntries(Object.entries(obj(summary.invalid_reasons ?? {}, `${where} invalid_reasons`)).map(([k, v]) => [k, num(v, `${where} invalid_reasons.${k}`)])),
    };
    return { run: r, subject };
  }
  if (suiteName === 'decision-conformance') {
    const checks = obj(metrics.checks, `${where} checks`);
    const r: ConformanceRun = {
      ...base, kind: 'conformance',
      metrics: {
        passed: num(metrics.passed, `${where} passed`), total: num(metrics.total, `${where} total`),
        checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => {
          const c = obj(v, `${where} checks.${k}`);
          return [k, { passed: num(c.passed, `${where} ${k}.passed`), total: num(c.total, `${where} ${k}.total`), failures: Array.isArray(c.failures) ? c.failures.map(String) : [] }];
        })),
      },
    };
    return { run: r, subject };
  }
  if (suiteName === 'embeddings') {
    const byDim = obj(metrics.by_dim, `${where} by_dim`);
    const dims: EmbeddingDim[] = Object.entries(byDim).map(([d, v]) => {
      const x = obj(v, `${where} by_dim.${d}`);
      const tasks = Object.fromEntries(Object.entries(obj(x.tasks, `${where} by_dim.${d}.tasks`)).map(([t, s]) => [t, num(obj(s, `${where} ${t}`).main_score, `${where} ${t}.main_score`)]));
      return { dim: Number(d), score: bootstrapMean(Object.values(tasks)), tasks, fidelity: fidelity(x.fidelity, `${where} by_dim.${d}.fidelity`), delta: null };
    }).sort((a, b) => b.dim - a.dim);
    const t = summary.throughput ? obj(summary.throughput, `${where} throughput`) : null;
    const r: EmbeddingsRun = {
      ...base, kind: 'embeddings', reference, is_reference: reference === null, dims,
      throughput: t ? {
        texts_per_s: num(t.texts_per_s, `${where} texts_per_s`), tokens_per_s: num(t.tokens_per_s, `${where} tokens_per_s`),
        engine_tokens_per_s: num(t.engine_tokens_per_s, `${where} engine_tokens_per_s`), tokens: num(t.tokens, `${where} tokens`), texts: num(t.texts, `${where} texts`),
      } : null,
      engine_info: run.engine === undefined ? null : obj(run.engine, `${where} engine`),
    };
    return { run: r, subject };
  }
  throw new RecordError(`${where}: no site view for suite ${suiteName}`);
}

/** Δ vs reference, paired task by task at the same dimension, with a bootstrap interval. */
function addDeltas(runs: Run[]): void {
  const byId = new Map(runs.map((r) => [r.id, r]));
  for (const r of runs) {
    if (r.kind !== 'embeddings' || !r.reference) continue;
    const ref = byId.get(r.reference);
    if (!ref || ref.kind !== 'embeddings') throw new RecordError(`results/${r.id}: reference ${r.reference} is not a published embeddings run`);
    for (const d of r.dims) {
      const refDim = ref.dims.find((x) => x.dim === d.dim);
      if (!refDim) continue;
      const diffs = Object.entries(d.tasks).map(([task, s]) => {
        const base = refDim.tasks[task];
        if (base === undefined) throw new RecordError(`results/${r.id}: reference has no ${task} at ${d.dim}`);
        return s - base;
      });
      d.delta = bootstrapMean(diffs);
    }
  }
}

// ---- subjects -----------------------------------------------------------------------------

function loadSubject(key: string, fromRun: Obj, runs: Run[]): Subject {
  const file = join(ROOT, 'subjects', key, 'subject.yaml');
  const y = existsSync(file) ? obj(YAML.parse(readFileSync(file, 'utf8')), `subjects/${key}/subject.yaml`) : fromRun;
  const target = str(y.target, `subjects/${key} target`);
  if (target !== 'recipe' && target !== 'cloud' && target !== 'endpoint') throw new RecordError(`subjects/${key}: unknown target ${target}`);
  const visibility = str(y.engine_visibility, `subjects/${key} engine_visibility`);
  if (visibility !== 'public' && visibility !== 'private') throw new RecordError(`subjects/${key}: engine_visibility must be public or private`);
  const engine = obj(y.engine, `subjects/${key} engine`);
  return {
    key, model: str(y.model, `subjects/${key} model`), target, label: optStr(y.label, `subjects/${key} label`),
    engine_visibility: visibility, verified_identity: y.verified_identity === true,
    checkpoint: strRecord(y.checkpoint, `subjects/${key} checkpoint`), quant: strRecord(y.quant, `subjects/${key} quant`),
    engine: { name: str(engine.name, `subjects/${key} engine.name`), version: str(engine.version, `subjects/${key} engine.version`) },
    runs: runs.filter((r) => r.subject === key).sort((a, b) => b.started_at.localeCompare(a.started_at)).map((r) => r.id),
  };
}

// ---- leaderboards and matrices ----------------------------------------------------------

const latestFirst = (a: Run, b: Run) => b.started_at.localeCompare(a.started_at);

function boards(runs: Run[]): Board[] {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.status !== 'complete') continue; // partial runs are published but never ranked
    const id = `${r.suite}/${r.tier}/${r.profile}`;
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  return [...groups.entries()].map(([id, group]) => {
    // One row per subject and mode: the latest complete run.
    const latest = new Map<string, Run>();
    for (const r of [...group].sort(latestFirst)) if (!latest.has(`${r.subject}|${r.mode}`)) latest.set(`${r.subject}|${r.mode}`, r);
    const rows = [...latest.values()];
    const first = rows[0];
    if (!first) throw new Error(`empty board ${id}`);
    const score = (r: Run): Interval | null =>
      r.kind === 'decisions' ? r.metrics.accuracy
        : r.kind === 'embeddings' ? (r.dims.find((d) => d.dim === Math.max(...r.dims.map((x) => x.dim)))?.score ?? null)
          : null;
    const scored = rows.map((r) => ({ r, s: score(r) }));
    const metric = first.kind === 'decisions' ? 'accuracy' : first.kind === 'embeddings' ? 'mean MTEB main score (full dimension)' : 'checks passed';
    if (scored.every((x) => x.s)) {
      scored.sort((a, b) => (b.s?.value ?? 0) - (a.s?.value ?? 0));
      const bands = rankBands(scored.map((x) => x.s as Interval));
      return { id, suite: first.suite, tier: first.tier, profile: first.profile, metric, rows: scored.map((x, i) => ({ run: x.r.id, rank: bands[i] ?? { low: i + 1, high: i + 1 } })) };
    }
    // Conformance is pass/fail per check: listed, not ranked.
    return { id, suite: first.suite, tier: first.tier, profile: first.profile, metric, rows: scored.map((x) => ({ run: x.r.id, rank: { low: 0, high: 0 } })) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function matrices(runs: Run[], subjects: Subject[], references: Record<string, string>): Matrix[] {
  const out: Matrix[] = [];
  const bySubject = new Map(subjects.map((s) => [s.key, s]));
  const checkpoints = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.kind !== 'embeddings' || r.status !== 'complete' || r.tier !== 'quick') continue;
    const cp = r.subject.split('/').slice(0, 2).join('/');
    checkpoints.set(cp, [...(checkpoints.get(cp) ?? []), r]);
  }
  for (const [cp, group] of checkpoints) {
    const variants: Matrix['variants'] = [];
    const hardware: Matrix['hardware'] = [];
    const cells: Matrix['cells'] = {};
    let refVariant: string | null = null;
    let refHardware: string | null = null;
    for (const r of [...group].sort(latestFirst)) {
      const s = bySubject.get(r.subject);
      if (!s) continue;
      const quant = r.subject.split('/')[2] ?? 'unknown';
      const family = engineFamily(s.engine.name);
      const key = `${quant}|${family}`;
      const hw = r.hardware?.class ?? 'unknown';
      if (!variants.some((v) => v.key === key)) variants.push({ key, quant, family });
      if (!hardware.some((h) => h.class === hw)) hardware.push({ class: hw, label: r.hardware?.label ?? 'unknown hardware' });
      if (r.subject === references[cp]) { refVariant = key; refHardware = hw; }
      cells[key] ??= {};
      const row = cells[key];
      if (row && !row[hw]) row[hw] = { run: r.id, subject: r.subject, engine: `${s.engine.name} ${s.engine.version}` };
    }
    // The reference first; then full precision before quantized, then by bits.
    const order = (q: string) => ['fp32', 'bf16', 'fp16', 'q8', 'int8', 'q6', 'q5', 'q4', 'q3', 'q2'].findIndex((p) => q.startsWith(p));
    variants.sort((a, b) => Number(b.key === refVariant) - Number(a.key === refVariant) || order(a.quant) - order(b.quant) || a.family.localeCompare(b.family));
    hardware.sort((a, b) => Number(b.class === refHardware) - Number(a.class === refHardware) || a.label.localeCompare(b.label));
    out.push({ model: cp.split('/')[0] ?? cp, checkpoint: cp, suite: 'embeddings', reference: references[cp] ?? null, variants, hardware, cells });
  }
  return out;
}

// ---- main -------------------------------------------------------------------------------

function build(): Manifest {
  const loaded = findRunDirs().map(loadRun).filter((x): x is Loaded => x !== null);
  const runs = loaded.map((x) => x.run);
  addDeltas(runs);
  const subjectKeys = [...new Set(runs.map((r) => r.subject))];
  const subjects = subjectKeys.map((k) => {
    const from = loaded.find((x) => x.run.subject === k);
    if (!from) throw new Error(`no run for ${k}`);
    return loadSubject(k, from.subject, runs);
  });
  const refFile = join(RESULTS, 'references.yaml');
  const refs = existsSync(refFile) ? obj(YAML.parse(readFileSync(refFile, 'utf8')) ?? {}, 'results/references.yaml') : {};
  const references = Object.fromEntries(Object.entries(refs).map(([cp, v]) => [cp, str(obj(v, `references.${cp}`).subject, `references.${cp}.subject`)]));
  for (const [cp, key] of Object.entries(references)) {
    const s = subjects.find((x) => x.key === key);
    if (!s) throw new RecordError(`results/references.yaml: ${cp} names ${key}, which has no published runs`);
    if (s.engine_visibility === 'private') throw new RecordError(`results/references.yaml: ${key} has a private engine and cannot be a reference`);
  }
  const suites = loadSuites();
  const allBoards = boards(runs);
  const category = new Map(suites.map((s) => [s.name, s.category]));
  return {
    generated_at: new Date().toISOString(), repo: REPO, engines_repo: ENGINES_REPO,
    suites, subjects, runs: runs.sort(latestFirst), boards: allBoards, matrices: matrices(runs, subjects, references),
    overall: overall(runs, allBoards, (suite) => category.get(suite) ?? null),
  };
}

try {
  const manifest = build();
  if (!checkOnly) {
    writeFileSync(join(SITE, 'lib', 'manifest.generated.json'), `${JSON.stringify(manifest)}\n`);
    const pub = join(SITE, 'public', 'results');
    rmSync(pub, { recursive: true, force: true });
    for (const r of manifest.runs) {
      mkdirSync(join(pub, r.id), { recursive: true });
      cpSync(join(RESULTS, r.id), join(pub, r.id), { recursive: true });
    }
  }
  console.log(`manifest: ${manifest.runs.length} runs, ${manifest.subjects.length} subjects, ${manifest.boards.length} leaderboards, ${manifest.matrices.length} model matrices${checkOnly ? ' (check only)' : ''}`);
} catch (e) {
  if (e instanceof RecordError) {
    console.error(`site manifest: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
