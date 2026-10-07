// Statistics the site derives from committed summaries. Deterministic: the same records
// always build the same site.
import type { Interval } from '../lib/types.ts';

/** mulberry32: a small seeded PRNG, so bootstrap intervals are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(sorted: readonly number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const a = sorted[lo] ?? NaN;
  const b = sorted[hi] ?? NaN;
  return a + (b - a) * (i - lo);
}

/**
 * Percentile bootstrap (95%) of the mean over `xs`. For embeddings the resampled unit is
 * the task, so the interval says how much the average depends on which tasks were chosen.
 */
export function bootstrapMean(xs: readonly number[], iterations = 2000, seed = 1): Interval {
  if (xs.length === 0) throw new Error('bootstrapMean needs at least one value');
  const next = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(next() * xs.length)] ?? NaN;
    means.push(sum / xs.length);
  }
  means.sort((a, b) => a - b);
  return { value: mean(xs), low: quantile(means, 0.025), high: quantile(means, 0.975), n: xs.length };
}

/**
 * Rank bands (D9): a row's rank is the range of positions it could hold given the
 * intervals. Its best rank counts rows that are certainly better (their low is above our
 * high); its worst rank counts every row that is not certainly worse. Overlapping rows tie.
 */
export function rankBands(intervals: readonly Interval[], higherIsBetter = true): { low: number; high: number }[] {
  return intervals.map((me, i) => {
    let better = 0;
    let notWorse = 0;
    intervals.forEach((other, j) => {
      if (i === j) return;
      const certainlyBetter = higherIsBetter ? other.low > me.high : other.high < me.low;
      const certainlyWorse = higherIsBetter ? other.high < me.low : other.low > me.high;
      if (certainlyBetter) better++;
      if (!certainlyWorse) notWorse++;
    });
    return { low: better + 1, high: notWorse + 1 };
  });
}
