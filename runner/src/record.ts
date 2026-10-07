// Run records: results/<subject-key>/<suite>/<run>/ with run.json, raw.jsonl (or a
// pointer for raw data over 5 MB) and summary.json, which is always recomputable
// from raw data and run.json alone.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { sha256, type Subject } from './identity.ts';
import { percentile, round6 } from './stats.ts';
import type { RawRow, SuiteModule } from './suite.ts';

export const RAW_LIMIT_BYTES = 5 * 1024 * 1024;

/** Repository root: the directory holding suites/ (this file is runner/src/record.ts). */
export const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');

export type RunJson = {
  schema: 1; run_id: string; status: 'complete' | 'partial' | 'failed'; stop_reason: string | null;
  suite: { name: string; tier: string; suite_hash: string; ids: number };
  subject: Subject; mode: string; profile: string;
  harness: { name: 'bench'; commit: string; dirty: boolean; suite_hash: string; scorer: { name: string; version: string }; agent: null };
  endpoint: string; dataset: unknown; request_settings: Record<string, unknown>;
  dispatch: { concurrency: number; requests_per_minute: number | null; retries: 0 };
  budget: { cap_usd: number | null; spent_usd: number; price: unknown };
  environment: { node: string; platform: string; arch: string; location: string };
  attempted: number; completed: number; started_at: string; finished_at: string | null;
  observed_models: Record<string, number>;
};

/** The paths that make up the harness: bench, its suites, and the packages it imports. */
export const HARNESS_PATHS = ['runner', 'suites', 'packages', 'package.json', 'package-lock.json'];

/** `dirty` means uncommitted changes to the harness itself; edits elsewhere (results, site, docs) do not count. */
export function harnessCommit(root = REPO_ROOT): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no', '--', ...HARNESS_PATHS], { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch { return { commit: 'unknown', dirty: true }; }
}

/** The suite version: its definition files, the tier's id list and the code that scores it. */
export function suiteHash(suite: SuiteModule, tier: string, root = REPO_ROOT): string {
  const dir = join(root, 'suites', suite.name);
  const files = ['suite.yaml', `${tier}.ids`].map((f) => join(dir, f)).filter(existsSync)
    // Scoring code comes from this checkout; suite data from the root being run.
    .concat(suite.sourceFiles.concat('runner/src/stats.ts').map((f) => join(f.startsWith('runner/') ? REPO_ROOT : root, f)));
  return sha256(files.map((f) => `${relative(f.includes(`${REPO_ROOT}/runner/`) ? REPO_ROOT : root, f)}\n${readFileSync(f, 'utf8')}`).join('\n\0\n'));
}

export function runDirFor(root: string, subject: Subject, suite: string, tier: string, profile: string, mode: string, started: Date): string {
  const date = started.toISOString().slice(0, 10);
  const id = sha256(`${subject.key}|${suite}|${mode}|${started.toISOString()}`).slice(0, 6);
  const modePart = mode === 'native' ? '' : `-${mode.replace(/[^a-z0-9]+/gi, '-')}`;
  return join(root, 'results', subject.key, suite, `${date}-${tier}-${profile}${modePart}-${id}`);
}

/** Write the subject registry entry once; later runs never rewrite it. */
export function ensureSubject(root: string, subject: Subject): string {
  const file = join(root, 'subjects', subject.key, 'subject.yaml');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const { key, target, engine_visibility, verified_identity, label, ...identity } = subject;
    writeFileSync(file, YAML.stringify({ key, target, ...identity, engine_visibility, verified_identity, label, trained_on: [], overlap: [] }));
  }
  return file;
}

export function writeRaw(dir: string, rows: RawRow[], root = REPO_ROOT): void {
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  if (Buffer.byteLength(text) <= RAW_LIMIT_BYTES) { writeFileSync(join(dir, 'raw.jsonl'), text); return; }
  // ponytail: large raw data stays in the ignored .artifacts/raw until the Hub dataset upload exists (M4+).
  const local = join(root, '.artifacts', 'raw', `${relative(join(root, 'results'), dir).replace(/\//g, '__')}.jsonl`);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, text);
  writeFileSync(join(dir, 'raw.pointer.json'), JSON.stringify({ path: relative(root, local), sha256: sha256(text), bytes: Buffer.byteLength(text), uploaded: false }, null, 2) + '\n');
}

export function readRaw(dir: string, root = REPO_ROOT): RawRow[] {
  const direct = join(dir, 'raw.jsonl');
  let text: string;
  if (existsSync(direct)) text = readFileSync(direct, 'utf8');
  else {
    const ptr = JSON.parse(readFileSync(join(dir, 'raw.pointer.json'), 'utf8')) as { path: string; sha256: string };
    text = readFileSync(join(root, ptr.path), 'utf8');
    if (sha256(text) !== ptr.sha256) throw new Error(`${ptr.path}: hash differs from raw.pointer.json`);
  }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as RawRow);
}

/** summary.json from raw rows and run.json only. Deterministic: same inputs, same bytes. */
export function buildSummary(run: RunJson, rows: RawRow[], suite: SuiteModule, dir?: string): string {
  const ok = rows.filter((r) => r.ok);
  const latencies = ok.map((r) => r.latency_ms);
  const summary = {
    run_id: run.run_id, suite: run.suite.name, tier: run.suite.tier, suite_hash: run.suite.suite_hash,
    subject: run.subject.key, mode: run.mode, profile: run.profile, status: run.status,
    label: run.subject.label,
    items: { planned: run.suite.ids, attempted: rows.length, succeeded: ok.length, failed: rows.length - ok.length,
      failed_by_status: Object.fromEntries([...rows.filter((r) => !r.ok).reduce((m, r) => m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : 1))) },
    ...suite.summarize(rows, dir),
    latency_ms: {
      p50: round6(percentile(latencies, 50) ?? 0), p95: round6(percentile(latencies, 95) ?? 0), p99: round6(percentile(latencies, 99) ?? 0),
      note: `successful requests, nearest rank, measured from ${run.environment.location}`,
    },
    usage: {
      input_tokens: rows.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0),
      output_tokens: rows.reduce((s, r) => s + (r.usage?.output_tokens ?? 0), 0),
      cost_usd: round6(rows.reduce((s, r) => s + r.cost_usd, 0)),
    },
  };
  return JSON.stringify(summary, null, 2) + '\n';
}
