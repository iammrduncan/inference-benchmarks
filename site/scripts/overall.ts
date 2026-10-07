// The home page's overall tables: one per model type, because an Index that averages a
// decision model's accuracy with an embedding model's retrieval score compares nothing.
// Each table has one row per subject, one column per category ("bucket"), speed columns,
// and an Index computed only within the table. Pure functions over the manifest, so the
// rules are tested.
import type { Board, Bucket, OverallGroup, OverallRow, Run, SpeedColumn, SpeedFigure } from '../lib/types.ts';

type BucketDef = { id: string; label: string; note: string | null; matches: (suite: string, category: string | null) => boolean };
type GroupDef = { id: string; label: string; description: string; buckets: BucketDef[]; speed: SpeedColumn[]; owns: (r: Run) => boolean };

const byCategory = (c: string) => (_suite: string, category: string | null) => category === c;
const bySuite = (...names: string[]) => (suite: string) => names.includes(suite);

const PREFILL: SpeedColumn = { id: 'prefill', label: 'Prefill tok/s', lower_is_better: false, note: 'input tokens processed per second' };
const DECODE: SpeedColumn = { id: 'decode', label: 'Decode tok/s', lower_is_better: false, note: 'output tokens generated per second' };
const TTFT: SpeedColumn = { id: 'ttft', label: 'TTFT', lower_is_better: true, note: 'time to first token; needs the streaming suites' };
const LATENCY: SpeedColumn = { id: 'latency', label: 'Latency p50', lower_is_better: true, note: 'whole request' };

/**
 * Categories follow the core set's order (docs/design/core-set.md). A suite joins a bucket
 * through the `category` in its suite.yaml (or by name, for embedding modalities). Buckets
 * with no ranked suite yet still show, so the table says what is missing.
 */
export const GROUPS: GroupDef[] = [
  {
    id: 'language', label: 'Language & decision models',
    description: 'Chat, coding and decision models: anything that generates an answer.',
    owns: (r) => r.kind !== 'embeddings',
    buckets: [
      { id: 'decisions', label: 'Decisions', note: null, matches: byCategory('decisions') },
      { id: 'taste', label: 'Taste', note: "owner's ranking", matches: byCategory('taste') },
      { id: 'coding', label: 'Coding', note: null, matches: byCategory('coding') },
      { id: 'math', label: 'Math', note: null, matches: byCategory('math') },
      { id: 'tool-calling', label: 'Tool calling', note: null, matches: byCategory('tool-calling') },
      { id: 'knowledge', label: 'Knowledge', note: null, matches: byCategory('knowledge') },
    ],
    speed: [PREFILL, DECODE, TTFT, LATENCY],
  },
  {
    id: 'embedding', label: 'Embedding models',
    description: 'Models that turn text (or images and audio) into vectors for search and similarity.',
    owns: (r) => r.kind === 'embeddings',
    buckets: [
      { id: 'text', label: 'Text (MTEB)', note: null, matches: bySuite('embeddings', 'mteb-eng') },
      { id: 'code', label: 'Code', note: null, matches: bySuite('mteb-code') },
      { id: 'multilingual', label: 'Multilingual', note: null, matches: bySuite('mteb-multilingual') },
      { id: 'image', label: 'Image', note: null, matches: bySuite('mieb') },
      { id: 'audio', label: 'Audio', note: null, matches: bySuite('maeb') },
    ],
    speed: [{ ...PREFILL, note: 'input tokens embedded per second (engine time); embedding has no decode' }],
  },
];

/** A suite's headline on a 0–100 scale. Only ranked boards count; pass/fail suites do not. */
export function headline(run: Run): number | null {
  switch (run.kind) {
    case 'decisions': return run.metrics.accuracy.value * 100;
    case 'embeddings': return run.dims[0] ? run.dims[0].score.value * 100 : null;
    case 'conformance': return null;
  }
}

/**
 * For each suite, the one board every row is compared on: the tier with the most subjects
 * (ties go to the larger tier), so a bucket never mixes tiers.
 */
export function boardPerSuite(boards: Board[]): Map<string, Board> {
  const tierSize: Record<string, number> = { quick: 0, core: 1, think: 2, full: 3 };
  const out = new Map<string, Board>();
  for (const b of boards) {
    if (b.rows.every((r) => r.rank.low === 0)) continue; // listed, not ranked
    const cur = out.get(b.suite);
    if (!cur || b.rows.length > cur.rows.length || (b.rows.length === cur.rows.length && (tierSize[b.tier] ?? 0) > (tierSize[cur.tier] ?? 0))) out.set(b.suite, b);
  }
  return out;
}

/** Speed from the subject's latest complete run that has each figure. */
function speedOf(runs: Run[]): Record<string, SpeedFigure | null> {
  const out: Record<string, SpeedFigure | null> = { prefill: null, decode: null, ttft: null, latency: null };
  for (const r of runs) {
    if (r.status !== 'complete') continue;
    const hw = r.hardware?.label ?? 'provider-hosted';
    if (!out.prefill && r.kind === 'embeddings' && r.throughput) out.prefill = { value: r.throughput.engine_tokens_per_s, what: 'input tokens/s, engine time', hardware: hw };
    if (!out.latency && r.latency_ms) {
      out.latency = { value: r.latency_ms.p50, what: r.kind === 'embeddings' ? 'per batch of 32 texts' : 'per request', hardware: hw };
    }
  }
  return out;
}

/**
 * Bucket score: the mean of the subject's suite headlines in that bucket.
 * Index (within one group only): for each bucket the subject has, its score as a share of
 * the best score in that bucket (best = 100), averaged over those buckets. It rewards being
 * near the top of what a subject runs and says nothing about what it does not run;
 * `coverage` says how much that is.
 */
export function overall(runs: Run[], boards: Board[], categoryOf: (suite: string) => string | null): OverallGroup[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const chosen = boardPerSuite(boards);
  const latestFirst = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));

  return GROUPS.map((g) => {
    const buckets: Bucket[] = g.buckets.map((b) => {
      const suites = [...chosen.values()].filter((x) => b.matches(x.suite, categoryOf(x.suite)));
      return { id: b.id, label: b.label, note: b.note, suites: suites.map((x) => x.suite), boards: suites.map((x) => x.id) };
    });
    const rows = new Map<string, OverallRow>();

    for (const b of buckets) {
      const perSubject = new Map<string, Map<string, number>>(); // subject -> suite -> best headline
      const runIds = new Map<string, string[]>();
      for (const boardId of b.boards) {
        for (const entry of boards.find((x) => x.id === boardId)?.rows ?? []) {
          const run = byId.get(entry.run);
          const h = run ? headline(run) : null;
          if (!run || h === null || !g.owns(run)) continue;
          const suites = perSubject.get(run.subject) ?? new Map<string, number>();
          // A subject with several modes on one suite (e.g. two gateway modes) keeps its best.
          if ((suites.get(run.suite) ?? -Infinity) < h) {
            suites.set(run.suite, h);
            runIds.set(`${run.subject}|${run.suite}`, [run.id]);
          }
          perSubject.set(run.subject, suites);
        }
      }
      for (const [subject, suites] of perSubject) {
        const row = rows.get(subject) ?? { subject, buckets: {}, index: null, coverage: 0, speed: {}, last_run: '' };
        const scores = [...suites.values()];
        row.buckets[b.id] = { score: scores.reduce((x, y) => x + y, 0) / scores.length, runs: [...suites.keys()].flatMap((s) => runIds.get(`${subject}|${s}`) ?? []) };
        rows.set(subject, row);
      }
    }

    for (const row of rows.values()) {
      const mine = latestFirst.filter((r) => r.subject === row.subject && g.owns(r));
      row.speed = speedOf(mine);
      row.last_run = mine[0]?.started_at ?? '';
    }

    const best = new Map(buckets.map((b) => [b.id, Math.max(0, ...[...rows.values()].map((r) => r.buckets[b.id]?.score ?? 0))]));
    for (const r of rows.values()) {
      const shares = Object.entries(r.buckets).flatMap(([id, v]) => (v && (best.get(id) ?? 0) > 0 ? [(v.score / (best.get(id) ?? 1)) * 100] : []));
      r.coverage = shares.length;
      r.index = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
    }
    return { id: g.id, label: g.label, description: g.description, buckets, speed: g.speed, rows: [...rows.values()] };
  });
}
