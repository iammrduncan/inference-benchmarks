// The home page's overall table: one row per subject, one column per category ("bucket"),
// plus speed and a combined Index. Pure functions over the manifest, so the rules are tested.
import type { Board, Bucket, OverallRow, Run } from '../lib/types.ts';

/**
 * Categories, in the core set's order (docs/design/core-set.md). A suite joins a bucket
 * through the `category` in its suite.yaml. Buckets with no ranked suite yet still show,
 * so the table says what is missing instead of hiding it.
 */
export const BUCKETS: { id: string; label: string; note: string | null }[] = [
  { id: 'decisions', label: 'Decisions', note: null },
  { id: 'taste', label: 'Taste', note: "owner's ranking" },
  { id: 'coding', label: 'Coding', note: null },
  { id: 'math', label: 'Math', note: null },
  { id: 'tool-calling', label: 'Tool calling', note: null },
  { id: 'knowledge', label: 'Knowledge', note: null },
  { id: 'embeddings', label: 'Embeddings', note: null },
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

/**
 * Bucket score: the mean of the subject's suite headlines in that bucket.
 * Index: for each bucket the subject has, its score as a share of the best score in that
 * bucket (best = 100), averaged over those buckets. It rewards being near the top of what a
 * subject runs and says nothing about what it does not run; `coverage` says how much that is.
 */
export function overall(runs: Run[], boards: Board[], categoryOf: (suite: string) => string | null): { buckets: Bucket[]; rows: OverallRow[] } {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const chosen = boardPerSuite(boards);
  const buckets: Bucket[] = BUCKETS.map((b) => {
    const suites = [...chosen.values()].filter((x) => categoryOf(x.suite) === b.id);
    return { ...b, suites: suites.map((x) => x.suite), boards: suites.map((x) => x.id) };
  });

  const rows = new Map<string, OverallRow>();
  const row = (subject: string): OverallRow => {
    let r = rows.get(subject);
    if (!r) {
      r = { subject, buckets: {}, index: null, coverage: 0, tokens_per_s: null, latency_p50_ms: null, ttft_ms: null, last_run: '' };
      rows.set(subject, r);
    }
    return r;
  };

  for (const b of buckets) {
    const perSubject = new Map<string, { sum: number; n: number; runs: string[] }>();
    for (const boardId of b.boards) {
      const board = boards.find((x) => x.id === boardId);
      for (const entry of board?.rows ?? []) {
        const run = byId.get(entry.run);
        const h = run ? headline(run) : null;
        if (!run || h === null) continue;
        const cur = perSubject.get(run.subject) ?? { sum: 0, n: 0, runs: [] };
        // A subject with several modes (e.g. two gateway modes) keeps its best on that suite.
        const sameSuite = cur.runs.findIndex((id) => byId.get(id)?.suite === run.suite);
        if (sameSuite >= 0) {
          const prev = byId.get(cur.runs[sameSuite] ?? '');
          const prevH = prev ? headline(prev) : null;
          if (prevH !== null && prevH >= h) continue;
          cur.sum -= prevH ?? 0;
          cur.n -= 1;
          cur.runs.splice(sameSuite, 1);
        }
        perSubject.set(run.subject, { sum: cur.sum + h, n: cur.n + 1, runs: [...cur.runs, run.id] });
      }
    }
    for (const [subject, v] of perSubject) row(subject).buckets[b.id] = { score: v.sum / v.n, runs: v.runs };
  }

  // Speed and recency from the subject's latest complete runs.
  for (const r of [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    if (r.status !== 'complete' || !rows.has(r.subject)) continue;
    const x = row(r.subject);
    if (!x.last_run) x.last_run = r.started_at;
    if (x.tokens_per_s === null && r.kind === 'embeddings' && r.throughput) {
      x.tokens_per_s = { value: r.throughput.engine_tokens_per_s, what: 'embedding input tokens/s (engine)', hardware: r.hardware?.label ?? null };
    }
    if (x.latency_p50_ms === null && r.latency_ms) {
      x.latency_p50_ms = { value: r.latency_ms.p50, what: r.kind === 'embeddings' ? 'per batch of 32 texts' : 'per request', hardware: r.hardware?.label ?? 'provider-hosted' };
    }
  }

  const best = new Map(buckets.map((b) => [b.id, Math.max(0, ...[...rows.values()].map((r) => r.buckets[b.id]?.score ?? 0))]));
  for (const r of rows.values()) {
    const shares = Object.entries(r.buckets).flatMap(([id, v]) => (v && (best.get(id) ?? 0) > 0 ? [(v.score / (best.get(id) ?? 1)) * 100] : []));
    r.coverage = shares.length;
    r.index = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
  }
  return { buckets, rows: [...rows.values()] };
}
