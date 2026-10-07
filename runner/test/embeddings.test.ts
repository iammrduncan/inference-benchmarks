import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeVector, embeddingsSuite, writeNpy } from '../src/embeddings.ts';
import type { RawRow } from '../src/suite.ts';

test('vectors are written as NumPy .npy (v1.0, little-endian float32, C order, 64-byte aligned header)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-npy-'));
  const data = Float32Array.from({ length: 2 * 768 }, (_, i) => i / 1000);
  const path = join(dir, 'v.npy');
  const hash = writeNpy(path, data, 2, 768);
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 6).toString('latin1'), '\x93NUMPY');
  assert.deepEqual([buf[6], buf[7]], [1, 0]);
  const headerLen = buf.readUInt16LE(8);
  assert.equal((10 + headerLen) % 64, 0, 'data starts on a 64-byte boundary');
  const header = buf.subarray(10, 10 + headerLen).toString('latin1');
  assert.match(header, /'descr': '<f4', 'fortran_order': False, 'shape': \(2, 768\)/);
  const body = new Float32Array(buf.buffer.slice(buf.byteOffset + 10 + headerLen, buf.byteOffset + buf.byteLength));
  assert.equal(body.length, 1536);
  assert.equal(body[1535], data[1535]);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('throughput comes from successful batches only', () => {
  const row = (ok: boolean, inputs: number, tokens: number, ms: number): RawRow => ({ index: 0, item_id: 'b', ok, status: ok ? 200 : 500, latency_ms: ms,
    request: { url: 'u', body: { inputs } }, response: { engine_ms: ms / 2 }, usage: { input_tokens: tokens, output_tokens: 0 }, cost_usd: 0 });
  const s = embeddingsSuite.summarize([row(true, 32, 1000, 500), row(true, 32, 3000, 1500), row(false, 32, 0, 10)]) as { throughput: { texts: number; tokens_per_s: number; engine_tokens_per_s: number } };
  assert.equal(s.throughput.texts, 64);
  assert.equal(s.throughput.tokens_per_s, 2000);
  assert.equal(s.throughput.engine_tokens_per_s, 4000);
});

test('base64 vectors decode to exactly their own bytes (regression: pooled Buffers)', () => {
  // Small Buffers share an 8 KB+ pool; decoding must not read the whole pool.
  Buffer.from('warm the pool');
  const v = Float32Array.from({ length: 768 }, (_, i) => i * 0.5);
  const b64 = Buffer.from(v.buffer).toString('base64');
  const out = decodeVector(b64);
  assert.equal(out.length, 768);
  assert.equal(out[767], 383.5);
  assert.equal(decodeVector(Buffer.from([1, 2, 3]).toString('base64')).length, 0, 'a partial float is rejected');
});
