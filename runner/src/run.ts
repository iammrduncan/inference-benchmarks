// bench run: resolve the target, send every item, record every byte, then summarize.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { cloudSubject, endpointSubject, type Identity, type Subject } from './identity.ts';
import { cost, decisionEndpoint, gatewayJsonSchema, priceFor, typesafe, type DecisionProvider, type Price } from './providers.ts';
import { buildSummary, ensureSubject, harnessCommit, REPO_ROOT, runDirFor, suiteHash, writeRaw, type RunJson } from './record.ts';
import type { RawRow, SuiteModule, Tier, Usage } from './suite.ts';
import { typedDecisions, suiteDef } from './suites/typed-decisions.ts';
import { decisionConformance } from './suites/decision-conformance.ts';
import { embeddingsSuite, runEmbeddings } from './embeddings.ts';
import { recipeDown, recipeSubject, recipeUp, type RecipeTarget } from './launcher.ts';

export const SUITES: Record<string, SuiteModule> = {
  'typed-decisions': typedDecisions,
  'decision-conformance': decisionConformance,
  embeddings: embeddingsSuite,
};

export type Target =
  | { kind: 'cloud'; provider: string; model: string; via?: string }
  | { kind: 'endpoint'; url: string; identity: string; model: string; keyEnv?: string }
  | ({ kind: 'recipe' } & RecipeTarget);

export type RunOptions = { suites: string[]; tier: Tier; profile: string; budgetUsd: number | null; concurrency: number; rpm?: number | null; reference?: string; root?: string; log?: (m: string) => void };

type Resolved = { subject: Subject; provider: DecisionProvider; price: Price | undefined; settings: Record<string, unknown>; hardware?: unknown; launcher?: unknown };

/** Map a target to its subject and a decision client. */
export async function resolveTarget(t: Exclude<Target, { kind: 'recipe' }>): Promise<Resolved> {
  if (t.kind === 'endpoint') {
    const raw = YAML.parse(readFileSync(t.identity, 'utf8')) as Identity & { engine_visibility?: 'public' | 'private' };
    return { subject: endpointSubject(raw, raw.engine_visibility ?? 'public'), provider: decisionEndpoint(t.url, t.model, t.keyEnv), price: undefined,
      settings: { note: 'self-declared endpoint; sampling is whatever the endpoint applies' } };
  }
  const subject = cloudSubject(t.provider, t.model);
  if (t.provider === 'typesafe') {
    if (t.via) throw new Error('typesafe speaks the decision protocol natively; drop --via');
    return { subject, provider: typesafe(t.model), price: priceFor('typesafe', t.model), settings: { note: 'native decision API; the protocol has no sampling parameters' } };
  }
  if (t.provider === 'cerebras') {
    if (t.via !== 'gateway:json-schema') throw new Error('cerebras has no decision protocol; use --via gateway:json-schema (gateway:logprob is not built yet)');
    return { subject, provider: await gatewayJsonSchema(t.model), price: priceFor('cerebras', t.model),
      settings: { gateway: 'packages/gateway json-schema mode', per_question_request: true, temperature: 0, reasoning_effort: t.model === 'qwen-3.8-27b' ? 'none' : 'low', source: 'packages/gateway/src/cerebras.ts' } };
  }
  throw new Error(`no decision client for cloud provider "${t.provider}" yet (supported: typesafe, cerebras via the gateway)`);
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function usageOf(response: unknown): Usage | undefined {
  const u = rec(rec(response).usage);
  const i = Number(u.input_tokens ?? u.prompt_tokens); const o = Number(u.output_tokens ?? u.completion_tokens);
  return Number.isSafeInteger(i) && Number.isSafeInteger(o) && i >= 0 && o >= 0 ? { input_tokens: i, output_tokens: o } : undefined;
}

/** Run one suite against a resolved target; returns the run directory and what it spent. */
export async function runSuite(r: Resolved, suite: SuiteModule, o: RunOptions): Promise<{ dir: string; spent: number }> {
  const root = o.root ?? REPO_ROOT;
  const log = o.log ?? ((m: string) => process.stderr.write(`[bench] ${m}\n`));
  if (suite.protocol !== 'decision') throw new Error(`${suite.name} needs protocol ${suite.protocol}`);
  if (o.budgetUsd !== null && !r.price) throw new Error(`--budget-usd needs a known price for ${r.subject.key}; none is recorded`);
  const items = await suite.items(root, o.tier);
  const started = new Date();
  const dir = runDirFor(root, r.subject, suite.name, o.tier, o.profile, r.provider.describe.mode, started);
  mkdirSync(dir, { recursive: true });
  ensureSubject(root, r.subject);
  const hash = suiteHash(suite, o.tier, root);
  const def = suite.name === 'typed-decisions' ? suiteDef(root).dataset : null;
  const run: RunJson = {
    schema: 1, run_id: dir.split('/').pop() ?? '', status: 'partial', stop_reason: 'running',
    suite: { name: suite.name, tier: o.tier, suite_hash: hash, ids: items.length },
    subject: r.subject, mode: r.provider.describe.mode, profile: o.profile,
    harness: { name: 'bench', ...harnessCommit(root), suite_hash: hash, scorer: suite.scorer, agent: null },
    endpoint: r.provider.describe.endpoint, dataset: def, request_settings: r.settings,
    dispatch: { concurrency: Math.max(1, o.concurrency), requests_per_minute: o.rpm ?? null, retries: 0 },
    budget: { cap_usd: o.budgetUsd, spent_usd: 0, price: r.price ?? null },
    environment: { node: process.version, platform: process.platform, arch: process.arch, location: process.env.BENCH_LOCATION ?? Intl.DateTimeFormat().resolvedOptions().timeZone },
    attempted: 0, completed: 0, started_at: started.toISOString(), finished_at: null, observed_models: {},
    ...(r.hardware !== undefined ? { hardware: r.hardware } : {}), ...(r.launcher !== undefined ? { launcher: r.launcher } : {}),
  };
  const save = () => writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  save();
  log(`${suite.name} ${o.tier}: ${items.length} item(s) -> ${r.subject.key} (${run.mode})`);

  const rows: RawRow[] = [];
  let spent = 0; let next = 0; let stop: string | null = null;
  // Pacing keeps requests under provider rate limits. It delays dispatch; it never retries.
  const gapMs = o.rpm ? 60_000 / o.rpm : 0;
  let slot = 0;
  const paced = async () => { if (!gapMs) return; const now = Date.now(); const at = Math.max(now, slot); slot = at + gapMs; if (at > now) await new Promise((res) => setTimeout(res, at - now)); };
  const worker = async () => {
    while (next < items.length && !stop) {
      if (o.budgetUsd !== null && spent >= o.budgetUsd) { stop = 'budget'; break; }
      const index = next++;
      const item = items[index];
      if (!item) break;
      await paced();
      const c = await r.provider.call(item.body);
      const usage = c.ok ? usageOf(c.response) : undefined;
      const usd = cost(usage, r.price);
      spent += usd;
      const model = rec(c.response).model;
      rows.push({ index, item_id: item.id, ok: c.ok, status: c.status, latency_ms: c.latency_ms, request: c.request,
        ...(c.response !== undefined ? { response: c.response } : {}), ...(c.error ? { error: c.error } : {}),
        ...(usage ? { usage } : {}), cost_usd: usd, ...(typeof model === 'string' ? { model } : {}), expected: item.expected });
      if (rows.length % 25 === 0) log(`${rows.length}/${items.length} sent, $${spent.toFixed(4)}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  } finally {
    rows.sort((a, b) => a.index - b.index);
    run.attempted = rows.length;
    run.completed = rows.filter((x) => x.ok).length;
    run.observed_models = rows.reduce<Record<string, number>>((m, x) => { if (x.model) m[x.model] = (m[x.model] ?? 0) + 1; return m; }, {});
    run.budget.spent_usd = Math.round(spent * 1e6) / 1e6;
    run.status = rows.length === items.length ? 'complete' : 'partial';
    run.stop_reason = stop ?? (rows.length === items.length ? null : 'interrupted');
    run.finished_at = new Date().toISOString();
    writeRaw(dir, rows, root);
    save();
    writeFileSync(join(dir, 'summary.json'), buildSummary(run, rows, suite));
  }
  log(`${suite.name}: ${run.completed}/${items.length} ok, $${run.budget.spent_usd} -> ${dir}`);
  return { dir, spent };
}

export async function runAll(t: Target, o: RunOptions): Promise<string[]> {
  const unknown = o.suites.filter((s) => !SUITES[s]);
  if (unknown.length) throw new Error(`unknown suite(s): ${unknown.join(', ')}; known: ${Object.keys(SUITES).join(', ')}`);
  if (t.kind === 'recipe') return runRecipe(t, o);
  const r = await resolveTarget(t);
  const dirs: string[] = [];
  try {
    // One cap for the whole command: each suite gets what the earlier suites left.
    let remaining = o.budgetUsd;
    for (const name of o.suites) {
      const suite = SUITES[name];
      if (!suite) continue;
      const out = await runSuite(r, suite, { ...o, budgetUsd: remaining });
      dirs.push(out.dir);
      if (remaining !== null) remaining = Math.max(0, remaining - out.spent);
    }
  } finally { await r.provider.close(); }
  return dirs;
}

/** A recipe target: the launcher brings the engine up, bench measures it, the launcher takes it down. */
async function runRecipe(t: RecipeTarget, o: RunOptions): Promise<string[]> {
  const log = o.log ?? ((m: string) => process.stderr.write(`[bench] ${m}\n`));
  for (const name of o.suites) {
    const protocol = SUITES[name]?.protocol;
    if (protocol !== 'embeddings' && protocol !== 'decision') throw new Error(`recipe targets run the embeddings and decision suites so far, not ${name}`);
  }
  log(`launcher up ${t.recipe}${t.profile ? ` (profile ${t.profile})` : ''}`);
  const up = recipeUp(t);
  const dirs: string[] = [];
  try {
    const subject = recipeSubject(up);
    log(`${subject.key} at ${up.base_url}`);
    const hardware = { host: t.on ?? null, recipe: up.id, placements: up.hardware ?? [] };
    const launcher = { run_id: up.run_id, profile: up.profile, params: up.params, source: up.source, acknowledgments: up.acknowledgments };
    for (const name of o.suites) {
      log(`${name} ${o.tier}`);
      const suite = SUITES[name];
      if (suite?.protocol === 'decision') {
        if (up.endpoint.protocol !== 'decision') throw new Error(`${up.id} serves ${up.endpoint.protocol}, not the decision protocol ${name} needs`);
        const r: Resolved = {
          subject, provider: decisionEndpoint(up.base_url, up.endpoint.model ?? subject.model), price: undefined,
          settings: { note: 'recipe engine speaking the decision protocol natively; no sampling parameters' }, hardware, launcher,
        };
        dirs.push((await runSuite(r, suite, o)).dir);
      } else {
        const recipeDims = typeof up.params.dims === 'string' ? up.params.dims.split(',').map(Number) : undefined;
        dirs.push(await runEmbeddings({ ...(recipeDims ? { dims: recipeDims } : {}), subject, baseUrl: up.base_url, tier: o.tier, profile: o.profile, ...(o.reference ? { reference: o.reference } : {}), hardware, launcher, log }));
      }
    }
  } finally {
    log(`launcher down ${up.id}`);
    recipeDown(up.id);
  }
  return dirs;
}
