// Intervals for summaries. Everything here is deterministic, so `bench summarize`
// reproduces summary.json byte for byte from the same raw data.

export type Interval = { value: number; low: number; high: number; n: number };

const Z95 = 1.959963984540054;

/** Wilson score interval for a proportion (successes may be fractional). */
export function wilson(successes: number, n: number): Interval {
  if (n === 0) return { value: 0, low: 0, high: 0, n: 0 };
  const p = successes / n;
  const z2 = Z95 * Z95;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z95 / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // The bounds are exactly 0 and 1 at the extremes; pin them against float rounding.
  return { value: p, low: successes <= 0 ? 0 : Math.max(0, center - half), high: successes >= n ? 1 : Math.min(1, center + half), n };
}

/** Small seeded PRNG (mulberry32), so bootstrap intervals are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap interval of the mean, resampling items with a fixed seed. */
export function bootstrapMean(values: number[], resamples = 2000, seed = 20261006): Interval {
  const n = values.length;
  if (n === 0) return { value: 0, low: 0, high: 0, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const next = rng(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(next() * n)] ?? 0;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))] ?? mean;
  return { value: mean, low: at(0.025), high: at(0.975), n };
}

/** Nearest-rank percentile, as the existing theater summaries use. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null;
}

/** Round for stable JSON output; summaries never carry float noise beyond 6 decimals. */
export function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function roundInterval(i: Interval): Interval {
  return { value: round6(i.value), low: round6(i.low), high: round6(i.high), n: i.n };
}
