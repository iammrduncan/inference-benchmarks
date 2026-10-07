import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineFamily } from '../scripts/engines.ts';
import { bootstrapMean, rankBands } from '../scripts/stats.ts';

test('rank bands: overlapping intervals share a range; separated ones do not', () => {
  const iv = (low: number, high: number) => ({ value: (low + high) / 2, low, high, n: 100 });
  // A is clearly best; B and C overlap each other but not A; D is clearly worst.
  const bands = rankBands([iv(0.9, 0.95), iv(0.7, 0.8), iv(0.75, 0.85), iv(0.1, 0.2)]);
  assert.deepEqual(bands, [{ low: 1, high: 1 }, { low: 2, high: 3 }, { low: 2, high: 3 }, { low: 4, high: 4 }]);
});

test('rank bands: lower-is-better metrics invert the comparison', () => {
  const iv = (low: number, high: number) => ({ value: (low + high) / 2, low, high, n: 1 });
  assert.deepEqual(rankBands([iv(0.1, 0.2), iv(0.5, 0.6)], false), [{ low: 1, high: 1 }, { low: 2, high: 2 }]);
});

test('bootstrap mean is deterministic, brackets the mean, and collapses for constant data', () => {
  const xs = [0.2, 0.4, 0.6, 0.8, 1.0];
  const a = bootstrapMean(xs);
  assert.deepEqual(a, bootstrapMean(xs), 'same seed, same interval');
  assert.ok(a.low <= a.value && a.value <= a.high);
  assert.equal(a.n, 5);
  const flat = bootstrapMean([0.5, 0.5, 0.5]);
  assert.equal(flat.low, 0.5);
  assert.equal(flat.high, 0.5);
  assert.throws(() => bootstrapMean([]));
});

test('engine family drops the device, so one variant lines up across machines', () => {
  assert.equal(engineFamily('sentence-transformers-torch-cuda'), 'sentence-transformers');
  assert.equal(engineFamily('sentence-transformers-torch-mps'), 'sentence-transformers');
  assert.equal(engineFamily('onnxruntime-cuda'), 'onnxruntime');
  assert.equal(engineFamily('onnxruntime-cpu'), 'onnxruntime');
  assert.equal(engineFamily('vllm'), 'vllm');
});
