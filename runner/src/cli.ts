#!/usr/bin/env node
// bench: the measuring harness for inference-benchmarks. `npm run bench -- <command>`.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { buildSummary, readRaw, REPO_ROOT, type RunJson } from './record.ts';
import { runAll, SUITES, type Target } from './run.ts';
import { loadCases, quickIds, scoreDecisions, type Decision } from './suites/typed-decisions.ts';
import { round6 } from './stats.ts';
import type { Tier } from './suite.ts';

const USAGE = `usage: npm run bench -- <command> [options]

  run --suite a,b (--cloud provider:model [--via gateway:json-schema] | --endpoint URL --identity FILE --model M [--api-key-env VAR])
      [--tier quick|core] [--profile greedy-nothink] [--budget-usd N] [--concurrency N] [--rpm N]
                                 send the suites to one subject and write results/<subject>/<suite>/<run>/
  summarize <run-dir...> [--check]
                                 recompute summary.json from raw data and run.json; --check fails if it differs
  subjects                       subjects with results
  calibrate typed-decisions      rebuild the dataset card's Uniform and Prior baselines offline
  ids typed-decisions            regenerate the committed quick.ids / core.ids

Cloud keys come from the environment only: op run --env-file=benchmarks.env.op -- npm run bench -- ...
Suites: ${Object.keys(SUITES).join(', ')}`;

const OPTIONS = {
  suite: { type: 'string' }, cloud: { type: 'string' }, via: { type: 'string' }, endpoint: { type: 'string' },
  identity: { type: 'string' }, model: { type: 'string' }, 'api-key-env': { type: 'string' },
  tier: { type: 'string' }, profile: { type: 'string' }, 'budget-usd': { type: 'string' }, concurrency: { type: 'string' }, rpm: { type: 'string' },
  check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} as const;

function target(v: Record<string, string | boolean | undefined>): Target {
  if (v.cloud && v.endpoint) throw new Error('use --cloud or --endpoint, not both');
  if (typeof v.cloud === 'string') {
    const i = v.cloud.indexOf(':');
    if (i < 1) throw new Error('--cloud expects provider:model, e.g. typesafe:jev-latest');
    return { kind: 'cloud', provider: v.cloud.slice(0, i), model: v.cloud.slice(i + 1), ...(typeof v.via === 'string' ? { via: v.via } : {}) };
  }
  if (typeof v.endpoint === 'string') {
    if (typeof v.identity !== 'string' || typeof v.model !== 'string') throw new Error('--endpoint needs --identity FILE and --model NAME');
    return { kind: 'endpoint', url: v.endpoint, identity: v.identity, model: v.model, ...(typeof v['api-key-env'] === 'string' ? { keyEnv: v['api-key-env'] } : {}) };
  }
  throw new Error('run needs --cloud or --endpoint');
}

/** Every directory under results/ holding a run.json. */
function findRuns(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, 'run.json'))) return [dir];
  return readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isDirectory()).flatMap(findRuns);
}

async function main(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd, ...rest] = positionals;
  if (!cmd || v.help) { console.log(USAGE); return cmd ? 0 : 1; }
  switch (cmd) {
    case 'run': {
      if (!v.suite) throw new Error('run needs --suite');
      const tier = (v.tier ?? 'quick') as Tier;
      if (tier !== 'quick' && tier !== 'core') throw new Error('--tier is quick or core');
      const budget = v['budget-usd'] === undefined ? null : Number(v['budget-usd']);
      if (budget !== null && !(budget >= 0)) throw new Error('--budget-usd must be a non-negative number');
      const dirs = await runAll(target(v), { suites: v.suite.split(','), tier, profile: v.profile ?? 'greedy-nothink', budgetUsd: budget, concurrency: v.concurrency ? Number(v.concurrency) : 2, rpm: v.rpm ? Number(v.rpm) : null });
      for (const d of dirs) console.log(relative(process.cwd(), d));
      return 0;
    }
    case 'summarize': {
      const dirs = rest.flatMap((p) => findRuns(resolve(p)));
      if (!dirs.length) throw new Error('summarize needs run directories (or a folder containing them)');
      let differ = 0;
      for (const dir of dirs) {
        const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunJson;
        if (run.stop_reason === 'running') { console.log(`running   ${relative(process.cwd(), dir)} (no raw data yet; skipped)`); continue; }
        const suite = SUITES[run.suite.name];
        if (!suite) throw new Error(`${dir}: unknown suite ${run.suite.name}`);
        const fresh = buildSummary(run, readRaw(dir), suite);
        const file = join(dir, 'summary.json');
        const same = existsSync(file) && readFileSync(file, 'utf8') === fresh;
        if (v.check) { console.log(`${same ? 'identical' : 'DIFFERS  '} ${relative(process.cwd(), file)}`); if (!same) differ++; }
        else { writeFileSync(file, fresh); console.log(`wrote ${relative(process.cwd(), file)}`); }
      }
      return differ ? 1 : 0;
    }
    case 'subjects': {
      const base = join(REPO_ROOT, 'subjects');
      const files = existsSync(base) ? findFiles(base, 'subject.yaml') : [];
      if (!files.length) { console.log('no subjects yet'); return 0; }
      for (const f of files) {
        const s = YAML.parse(readFileSync(f, 'utf8')) as { key: string; target: string; label: string | null };
        const runs = findRuns(join(REPO_ROOT, 'results', s.key));
        console.log(`${s.key.padEnd(60)} ${s.target.padEnd(9)} ${String(runs.length).padStart(3)} run(s)${s.label ? `  [${s.label}]` : ''}`);
      }
      return 0;
    }
    case 'calibrate': {
      if (rest[0] !== 'typed-decisions') throw new Error('calibrate supports typed-decisions');
      return calibrateTypedDecisions();
    }
    case 'ids': {
      if (rest[0] !== 'typed-decisions') throw new Error('ids supports typed-decisions');
      const cases = await loadCases(REPO_ROOT, 'test');
      const dir = join(REPO_ROOT, 'suites', 'typed-decisions');
      writeFileSync(join(dir, 'core.ids'), cases.map((c) => c.id).join('\n') + '\n');
      writeFileSync(join(dir, 'quick.ids'), quickIds(cases).join('\n') + '\n');
      console.log(`core.ids ${cases.length}, quick.ids ${quickIds(cases).length}`);
      return 0;
    }
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 1;
  }
}

function findFiles(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? findFiles(p, name) : n === name ? [p] : []; }).sort();
}

/** Rebuild the card's Uniform and Prior rows; KL and Brier must match exactly. */
async function calibrateTypedDecisions(): Promise<number> {
  const test = await loadCases(REPO_ROOT, 'test');
  const train = await loadCases(REPO_ROOT, 'train');
  // Prior: the mean train gold distribution of each question name, pooled across workflows.
  const sums = new Map<string, Map<string, number>>();
  for (const c of train) for (const [q, g] of Object.entries(c.gold)) {
    const m = sums.get(q) ?? sums.set(q, new Map()).get(q);
    for (const [o, p] of Object.entries(g.probabilities)) m?.set(o, (m.get(o) ?? 0) + p);
  }
  const decisions = (pred: (q: string, options: string[]) => Record<string, number>): Decision[] =>
    test.flatMap((c) => Object.entries(c.gold).map(([q, g]) => ({ workflow: c.workflow, question: q, type: g.type, gold: g,
      pred: { ok: true as const, dist: pred(q, Object.keys(g.probabilities)) } })));
  const uniform = scoreDecisions(decisions((_q, os) => Object.fromEntries(os.map((o) => [o, 1 / os.length]))));
  const prior = scoreDecisions(decisions((q, os) => {
    const m = sums.get(q); const total = os.reduce((s, o) => s + (m?.get(o) ?? 0), 0);
    return Object.fromEntries(os.map((o) => [o, (m?.get(o) ?? 0) / total]));
  }));
  const card = { uniform: { accuracy: 0.308, kl_from_gold: 0.444, brier: 0.238, ece: 0.169 }, prior: { accuracy: 0.470, kl_from_gold: 0.347, brier: 0.189, ece: 0.088 } };
  const row = (m: ReturnType<typeof scoreDecisions>) => ({ accuracy: round6(m.accuracy.value), kl_from_gold: round6(m.kl_from_gold?.value ?? NaN), brier: round6(m.brier?.value ?? NaN), ece: m.ece });
  const ours = { uniform: row(uniform), prior: row(prior) };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const exact = (['uniform', 'prior'] as const).every((b) => r3(ours[b].kl_from_gold) === card[b].kl_from_gold && r3(ours[b].brier) === card[b].brier);
  const out = { dataset_revision: '(see suite.yaml)', decisions: uniform.decisions, card, ours,
    kl_and_brier_match_card_to_3dp: exact,
    notes: ['Accuracy: the card does not state its tie rule; Uniform ties on every decision, so its accuracy is not a useful check. Prior has no ties and differs by 5 of 2000 decisions.',
      'ECE: the card does not define its ECE and says submitters compute it differently; ours is 10-bin top-label ECE and is not comparable.'] };
  const dir = join(REPO_ROOT, 'suites', 'typed-decisions', 'calibration');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'baselines.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ card, ours, kl_and_brier_match_card_to_3dp: exact }, null, 2));
  return exact ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (err: Error) => { console.error(`error: ${err.message}`); process.exit(1); });
