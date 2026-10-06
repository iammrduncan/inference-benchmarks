// Pinned dataset files from the Hugging Face Hub, cached locally and checked by SHA-256.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { sha256File } from './identity.ts';

export interface PinnedFile { repo: string; revision: string; path: string; sha256: string }

export function cacheRoot(): string {
  return process.env.BENCH_CACHE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'inference-benchmarks');
}

/** Download a dataset file at a full commit, refusing anything whose hash differs from the pin. */
export async function fetchPinned(f: PinnedFile): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(f.revision)) throw new Error(`${f.repo}/${f.path}: revision must be a full commit`);
  const local = join(cacheRoot(), 'datasets', f.repo.replace('/', '__'), f.revision, f.path);
  if (existsSync(local)) {
    const have = await sha256File(local);
    if (have === f.sha256) return local;
    throw new Error(`${local}: cached file hash ${have} differs from the pin ${f.sha256}; delete it to re-download`);
  }
  const headers: Record<string, string> = process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
  const url = `https://huggingface.co/datasets/${f.repo}/resolve/${f.revision}/${f.path}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  mkdirSync(dirname(local), { recursive: true });
  const tmp = `${local}.partial`;
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  const got = await sha256File(tmp);
  if (got !== f.sha256) throw new Error(`${url}: downloaded hash ${got} differs from the pin ${f.sha256}`);
  renameSync(tmp, local);
  return local;
}

/** Read a Parquet file into plain objects (only the named columns). */
export async function readParquet(path: string, columns: string[]): Promise<Record<string, unknown>[]> {
  const file = await asyncBufferFromFile(path);
  return (await parquetReadObjects({ file, columns })) as Record<string, unknown>[];
}
