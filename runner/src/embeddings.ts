// The embeddings suite: collect MTEB inputs (with the model's own prompts), embed them
// through the subject's /v1/embeddings endpoint, then let MTEB score the stored vectors.
// The scorer never calls a model; bench is the only client. See suites/embeddings/suite.yaml.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { postJsonReachable, TRANSPORT_BACKOFF_MS } from './client.ts';
import { sha256, type Subject } from './identity.ts';
import { buildSummary, harnessCommit, REPO_ROOT, runDirFor, ensureSubject, writeRaw, type RunJson } from './record.ts';
import { percentile, round6 } from './stats.ts';
import type { RawRow, SuiteModule, Tier } from './suite.ts';

/** EmbeddingGemma 2's width: runs recorded before engines reported their dimension. */
const DEFAULT_DIM = 768;
const SCORER = join(REPO_ROOT, 'runner', 'scorers', 'mteb');
type Suite = { tiers: Record<string, { tasks?: string[]; benchmark?: string }>; dims: number[]; batch_size: number; scorer: { version: string } };
type ManifestRow = { sha256: string; text: string; role: 'query' | 'document' };

const artifacts = (root: string, ...p: string[]) => { const d = join(root, '.artifacts', 'embeddings', ...p.slice(0, -1)); mkdirSync(d, { recursive: true }); return join(d, p[p.length - 1] ?? ''); };
const suiteDef = (root: string) => YAML.parse(readFileSync(join(root, 'suites', 'embeddings', 'suite.yaml'), 'utf8')) as Suite;

function scorer(args: string[]): string {
  return execFileSync('uv', ['run', '-q', '--project', SCORER, '--python-preference', 'only-managed', 'python', join(SCORER, 'embeddings.py'), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
}

/** The model's own prompts, from config_sentence_transformers.json at the pinned revision. */
async function prompts(subject: Subject): Promise<{ path: string; sha256: string }> {
  const { hf, revision } = subject.checkpoint;
  if (!hf || !revision) throw new Error('embeddings needs a Hugging Face checkpoint and revision in the subject identity');
  const res = await fetch(`https://huggingface.co/${hf}/raw/${revision}/config_sentence_transformers.json`, { signal: AbortSignal.timeout(30_000) });
  const cfg = res.ok ? (await res.json()) as { prompts?: Record<string, string> } : {};
  const text = JSON.stringify(cfg.prompts ?? {});
  const path = artifacts(REPO_ROOT, 'prompts', `${sha256(text).slice(0, 16)}.json`);
  writeFileSync(path, text);
  return { path, sha256: sha256(text) };
}

function tasksFor(def: Suite, tier: Tier): string[] {
  const t = def.tiers[tier];
  if (t?.tasks) return t.tasks;
  throw new Error(`embeddings ${tier}: only explicit task lists are supported so far`);
}

/**
 * Decode one base64 float32 vector. Small Buffers are views into Node's shared pool, so the
 * view must be cut by byteOffset and byteLength, never taken as the whole underlying buffer.
 */
export function decodeVector(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  if (buf.byteLength % 4 !== 0) return new Float32Array(0);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Write float32 rows as a NumPy .npy file (format 1.0). */
export function writeNpy(path: string, data: Float32Array, rows: number, cols: number): string {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rows}, ${cols}), }`;
  header += ' '.repeat(64 - ((10 + header.length + 1) % 64)) + '\n';
  const head = Buffer.alloc(10);
  head.write('\x93NUMPY', 0, 'latin1'); head[6] = 1; head[7] = 0; head.writeUInt16LE(header.length, 8);
  const buf = Buffer.concat([head, Buffer.from(header, 'latin1'), Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
  writeFileSync(path, buf);
  return sha256(buf);
}

export type EmbedRun = { dims?: number[]; subject: Subject; baseUrl: string; tier: Tier; profile: string; reference?: string; hardware: unknown; launcher?: unknown; root?: string; log?: (m: string) => void };

/**
 * Which output widths to score. A recipe that names its dims wins (e.g. [1024] for a model
 * with no Matryoshka training); otherwise the suite's list, cut to the vectors' width.
 */
export function scoredDims(suiteDims: number[], width: number, fromRecipe?: number[]): number[] {
  const dims = fromRecipe && fromRecipe.length ? fromRecipe : suiteDims.filter((d) => d <= width);
  if (!dims.length || dims.some((d) => !Number.isSafeInteger(d) || d <= 0 || d > width)) throw new Error(`cannot score dims ${JSON.stringify(dims)} on ${width}-wide vectors`);
  return [...dims].sort((a, b) => b - a);
}

export async function runEmbeddings(o: EmbedRun): Promise<string> {
  const root = o.root ?? REPO_ROOT;
  const log = o.log ?? ((m: string) => process.stderr.write(`[bench] ${m}\n`));
  const def = suiteDef(root);
  const tasks = tasksFor(def, o.tier);
  const engine = ((await (await fetch(`${o.baseUrl}/v1/models`)).json()) as { engine?: unknown }).engine ?? null;
  const reported = (engine as { dimension?: unknown } | null)?.dimension;
  const DIM = typeof reported === 'number' && Number.isSafeInteger(reported) && reported > 0 ? reported : DEFAULT_DIM;
  const dims = scoredDims(def.dims, DIM, o.dims);
  const p = await prompts(o.subject);
  const manifestKey = sha256(JSON.stringify({ tasks, prompts: p.sha256, mteb: def.scorer.version })).slice(0, 16);
  const manifestPath = artifacts(root, 'manifests', `${manifestKey}.jsonl`);
  if (!existsSync(manifestPath)) { log(`collecting MTEB inputs for ${tasks.length} task(s)`); scorer(['collect', '--tasks', tasks.join(','), '--prompts', p.path, '--out', manifestPath]); }
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = manifestText.split('\n').filter(Boolean).map((l) => JSON.parse(l) as ManifestRow);

  const started = new Date();
  const dir = runDirFor(root, o.subject, 'embeddings', o.tier, o.profile, 'native', started);
  mkdirSync(join(dir, 'harness'), { recursive: true });
  ensureSubject(root, o.subject);
  const runId = dir.split('/').pop() ?? '';
  const hash = sha256([readFileSync(join(root, 'suites/embeddings/suite.yaml'), 'utf8'), readFileSync(join(REPO_ROOT, 'runner/src/embeddings.ts'), 'utf8'), readFileSync(join(SCORER, 'embeddings.py'), 'utf8')].join('\0'));
  const run: RunJson & Record<string, unknown> = {
    schema: 1, run_id: runId, status: 'partial', stop_reason: 'running',
    suite: { name: 'embeddings', tier: o.tier, suite_hash: hash, ids: manifest.length },
    subject: o.subject, mode: 'native', profile: o.profile,
    harness: { name: 'bench', ...harnessCommit(root), suite_hash: hash, scorer: { name: 'mteb', version: def.scorer.version }, agent: null },
    endpoint: `${o.baseUrl}/v1/embeddings`, dataset: { tasks, manifest: relative(root, manifestPath), manifest_sha256: sha256(manifestText), texts: manifest.length, prompts_sha256: p.sha256 },
    request_settings: { batch_size: def.batch_size, encoding_format: 'base64', order: 'by text length, descending', dims_scored: dims, width: DIM },
    dispatch: { concurrency: 1, requests_per_minute: null, retries: 0 },
    budget: { cap_usd: null, spent_usd: 0, price: null },
    environment: { node: process.version, platform: process.platform, arch: process.arch, location: process.env.BENCH_LOCATION ?? Intl.DateTimeFormat().resolvedOptions().timeZone },
    attempted: 0, completed: 0, started_at: started.toISOString(), finished_at: null, observed_models: {},
    engine, hardware: o.hardware, launcher: o.launcher ?? null, reference: o.reference ?? null,
  };
  const save = () => writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  save();

  // Embed longest first (less padding, and memory limits surface in the first batches); store in manifest order.
  const order = manifest.map((_, i) => i).sort((a, b) => (manifest[b]?.text.length ?? 0) - (manifest[a]?.text.length ?? 0) || a - b);
  const vectors = new Float32Array(manifest.length * DIM);
  const rows: RawRow[] = [];
  let failed = false;
  for (let b = 0; b * def.batch_size < order.length; b++) {
    const idx = order.slice(b * def.batch_size, (b + 1) * def.batch_size);
    const c = await postJsonReachable(`${o.baseUrl}/v1/embeddings`, { input: idx.map((i) => manifest[i]?.text), encoding_format: 'base64', model: o.subject.model }, {});
    const resp = (c.response ?? {}) as { data?: { index: number; embedding: string }[]; usage?: { prompt_tokens?: number }; engine_ms?: number; model?: string };
    let problem = !c.ok ? (c.error ?? `HTTP ${c.status}`) : !Array.isArray(resp.data) || resp.data.length !== idx.length ? 'wrong number of embeddings'
      : resp.model !== o.subject.model ? `answered by ${String(resp.model)}, not ${o.subject.model}` : null;
    for (const d of problem ? [] : resp.data ?? []) {
      const v = decodeVector(d.embedding);
      if (v.length !== DIM || !v.every(Number.isFinite)) { problem = `embedding ${d.index} has ${v.length} values or non-finite values`; break; }
      vectors.set(v, (idx[d.index] ?? 0) * DIM);
    }
    const ok = problem === null;
    if (!ok) failed = true;
    rows.push({ index: b, item_id: `batch-${b}`, ok, status: c.status, latency_ms: c.latency_ms,
      request: { url: c.request.url, body: { inputs: idx.length, sha256: idx.map((i) => manifest[i]?.sha256.slice(0, 16)) } },
      response: { usage: resp.usage ?? null, engine_ms: resp.engine_ms ?? null, model: resp.model ?? null }, ...(problem ? { error: problem } : {}),
      usage: { input_tokens: resp.usage?.prompt_tokens ?? 0, output_tokens: 0 }, cost_usd: 0, ...(resp.model ? { model: resp.model } : {}),
      ...(c.transport_failures ? { transport_failures: c.transport_failures } : {}) });
    if (failed) { log(`batch ${b} failed (HTTP ${c.status}: ${problem}): stopping; no hidden retries`); break; }
    if (b % 100 === 0) log(`${Math.min(order.length, (b + 1) * def.batch_size)}/${order.length} embedded`);
  }

  run.attempted = rows.length; run.completed = rows.filter((r) => r.ok).length;
  const retried = rows.filter((r) => r.transport_failures?.length).length;
  if (retried) (run.dispatch as RunJson['dispatch']).transport_retry = { backoff_ms: [...TRANSPORT_BACKOFF_MS], retried_requests: retried };
  run.observed_models = rows.reduce<Record<string, number>>((m, r) => { if (r.model) m[r.model] = (m[r.model] ?? 0) + 1; return m; }, {});
  writeRaw(dir, rows, root);
  if (!failed) {
    const vpath = artifacts(root, 'vectors', `${relative(join(root, 'results'), dir).replace(/\//g, '__')}.npy`);
    run.vectors = { path: relative(root, vpath), sha256: writeNpy(vpath, vectors, manifest.length, DIM), shape: [manifest.length, DIM], dtype: 'float32', uploaded: false };
    const refVectors = o.reference ? (JSON.parse(readFileSync(join(o.reference, 'run.json'), 'utf8')) as { vectors?: { path: string } }).vectors?.path : undefined;
    if (o.reference && !refVectors) throw new Error(`${o.reference}: reference run has no vectors`);
    log('scoring with MTEB (offline)');
    scorer(['score', '--tasks', tasks.join(','), '--prompts', p.path, '--manifest', manifestPath, '--vectors', vpath, '--dims', dims.join(','),
      '--out', join(dir, 'harness', 'scores.json'), ...(refVectors ? ['--reference', join(root, refVectors)] : [])]);
  }
  run.status = failed ? 'failed' : 'complete';
  run.stop_reason = failed ? 'request failed' : null;
  run.finished_at = new Date().toISOString();
  save();
  writeFileSync(join(dir, 'summary.json'), buildSummary(run, rows, embeddingsSuite, dir));
  return dir;
}

export const embeddingsSuite: SuiteModule = {
  name: 'embeddings', protocol: 'embeddings', scorer: { name: 'mteb', version: '2.22.5' },
  sourceFiles: ['runner/src/embeddings.ts', 'runner/scorers/mteb/embeddings.py'],
  async items() { throw new Error('the embeddings suite runs through runEmbeddings'); },
  summarize(rows, dir) {
    const ok = rows.filter((r) => r.ok);
    const texts = ok.reduce((s, r) => s + Number((r.request.body as { inputs?: number }).inputs ?? 0), 0);
    const tokens = ok.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0);
    const engineMs = ok.reduce((s, r) => s + Number((r.response as { engine_ms?: number } | undefined)?.engine_ms ?? 0), 0);
    const wallMs = ok.reduce((s, r) => s + r.latency_ms, 0);
    const scoresFile = dir ? join(dir, 'harness', 'scores.json') : '';
    const scores = scoresFile && existsSync(scoresFile) ? JSON.parse(readFileSync(scoresFile, 'utf8')) as Record<string, unknown> : null;
    return {
      metrics: scores,
      throughput: {
        texts, tokens, batches: ok.length,
        texts_per_s: round6(texts / (wallMs / 1000 || 1)), tokens_per_s: round6(tokens / (wallMs / 1000 || 1)),
        engine_tokens_per_s: round6(tokens / (engineMs / 1000 || 1)),
        batch_latency_ms: { p50: round6(percentile(ok.map((r) => r.latency_ms), 50) ?? 0), p95: round6(percentile(ok.map((r) => r.latency_ms), 95) ?? 0) },
        note: 'batches of 32 texts in descending length order, one request at a time; wall time includes HTTP and base64',
      },
      notes: ['dimensions below 768 are the same vectors truncated and re-normalized (Matryoshka); fidelity compares each dimension with the reference at the same dimension'],
    };
  },
};
