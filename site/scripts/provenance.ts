// Who submitted each run, and the repository's star count for the header.
// submissions/<run>.json is written after merge by the record-submissions workflow
// (runner/src/submissions.ts); this reads it for the site.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Submission } from '../lib/types.ts';

const SIGNATURE_TYPES = new Set(['ssh', 'gpg', 'x509']);

/** The run's submission record, or null when the workflow hasn't recorded it yet (a run merged moments ago). */
export function readSubmission(root: string, run: string): Submission | null {
  const file = join(root, 'submissions', `${run}.json`);
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, 'utf8')) as {
    submitted_by?: unknown; pr?: unknown; commit?: { sha?: unknown; author?: unknown; signature?: { verified?: unknown; reason?: unknown; type?: unknown } };
  };
  const c = s.commit;
  const sig = c?.signature;
  const login = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9-]+(\[bot\])?$/.test(v) ? v : null);
  if (typeof c?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(c.sha) || typeof sig?.verified !== 'boolean' || typeof sig.reason !== 'string') {
    throw new Error(`submissions/${run}.json: expected commit.sha (40 hex) and commit.signature {verified, reason}`);
  }
  const type = typeof sig.type === 'string' && SIGNATURE_TYPES.has(sig.type) ? (sig.type as 'ssh' | 'gpg' | 'x509') : null;
  return {
    by: login(s.submitted_by), pr: typeof s.pr === 'number' && Number.isSafeInteger(s.pr) ? s.pr : null,
    commit: c.sha, author: login(c.author), signature: { verified: sig.verified, reason: sig.reason, type },
  };
}

/** The repository's GitHub stars; null when GitHub doesn't answer in time. Never fails the build. */
export async function fetchStars(repoUrl: string): Promise<number | null> {
  const name = repoUrl.replace(/^https:\/\/github\.com\//, '');
  try {
    const res = await fetch(`https://api.github.com/repos/${name}`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const stars = ((await res.json()) as { stargazers_count?: unknown }).stargazers_count;
    return typeof stars === 'number' && Number.isSafeInteger(stars) ? stars : null;
  } catch { return null; }
}
