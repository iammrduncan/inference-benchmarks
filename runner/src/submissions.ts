// Who submitted each run, and whether the commit that added it carries a signature GitHub
// verified. Recorded after merge, by .github/workflows/record-submissions.yml, into
// submissions/<run id>.json. A pull request never writes these files: the PR check
// refuses any change under submissions/.
//
// The contributor's own commit is the one that counts. A squash merge lands on main as a
// new commit signed by GitHub's merge key, so for a squash merge we look inside the pull
// request for the commit that added the run. Node built-ins only, so the workflow needs no
// npm install.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Signature = { verified: boolean; reason: string; type: 'ssh' | 'gpg' | 'x509' | null };

export type Submission = {
  schema: 1;
  /** `<subject key>/<suite>/<run_id>`, the folder under results/. */
  run: string;
  /** GitHub login of whoever submitted the run: the pull request's author, or the commit's author for a direct push. */
  submitted_by: string | null;
  pr: number | null;
  /** The contributor's commit that added the run, and GitHub's verdict on its signature. */
  commit: { sha: string; author: string | null; signature: Signature };
  /** The commit on main that brought the run in (a squash merge, a merge, or the commit itself). */
  landed_in: string;
  recorded_at: string;
};

/** GET a GitHub REST path (e.g. `repos/o/r/commits/abc`) and return the parsed JSON. */
export type GitHub = (path: string) => unknown;
/** Run git in the repository and return stdout. */
export type Git = (args: string[]) => string;

type ApiCommit = {
  sha: string;
  author: { login: string } | null;
  committer: { login: string } | null;
  commit: { verification?: { verified: boolean; reason: string; signature: string | null } };
  files?: { filename: string }[];
};
type ApiPull = { number: number; user: { login: string } | null; merge_commit_sha: string | null; merged_at: string | null };

export function signatureOf(c: ApiCommit): Signature {
  const v = c.commit.verification;
  const armor = v?.signature ?? '';
  const type = armor.includes('BEGIN SSH SIGNATURE') ? 'ssh' : armor.includes('BEGIN PGP SIGNATURE') ? 'gpg' : armor.includes('BEGIN SIGNED MESSAGE') ? 'x509' : null;
  return { verified: v?.verified === true, reason: v?.reason ?? 'unknown', type };
}

/** Every run folder (one holding run.json), as a path relative to results/. */
export function runIds(root: string): string[] {
  const results = join(root, 'results');
  const walk = (rel: string): string[] => {
    const dir = join(results, rel);
    if (existsSync(join(dir, 'run.json'))) return [rel];
    return readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isDirectory()).flatMap((n) => walk(rel ? `${rel}/${n}` : n));
  };
  return existsSync(results) ? walk('').sort() : [];
}

/** Work out who submitted one run. `added` is the commit on main where its run.json first appeared at this path. */
export function submissionFor(run: string, added: string, api: GitHub, now: string): Submission {
  const path = `results/${run}/run.json`;
  const landed = api(`commit:${added}`) as ApiCommit;
  const pulls = api(`pulls-of:${added}`) as ApiPull[];
  // The commit on main is the result of merging a pull request (squash or rebase): the
  // contributor's original commit is inside that pull request.
  const mergedAs = pulls.find((p) => p.merge_commit_sha === added);
  if (mergedAs) {
    const shas = (api(`pr-commits:${mergedAs.number}`) as { sha: string }[]).map((c) => c.sha);
    const commits = shas.map((s) => api(`commit:${s}`) as ApiCommit);
    const own = commits.find((c) => (c.files ?? []).some((f) => f.filename === path)) ?? commits.at(-1) ?? landed;
    return {
      schema: 1, run, submitted_by: mergedAs.user?.login ?? own.author?.login ?? null, pr: mergedAs.number,
      commit: { sha: own.sha, author: own.author?.login ?? null, signature: signatureOf(own) }, landed_in: added, recorded_at: now,
    };
  }
  // The commit itself is on main (a direct push, a fast-forward or a merge commit).
  const pr = pulls.find((p) => p.merged_at !== null) ?? null;
  return {
    schema: 1, run, submitted_by: pr?.user?.login ?? landed.author?.login ?? null, pr: pr?.number ?? null,
    commit: { sha: landed.sha, author: landed.author?.login ?? null, signature: signatureOf(landed) }, landed_in: added, recorded_at: now,
  };
}

/**
 * Write submissions/<run>.json for every run that doesn't have one yet; existing records are
 * never rewritten. `api` takes the logical keys used above (`commit:<sha>`,
 * `pulls-of:<sha>`, `pr-commits:<n>`); `githubApi` maps them to REST paths.
 */
export function recordSubmissions(o: { root: string; api: GitHub; git: Git; now?: string }): string[] {
  const now = o.now ?? new Date().toISOString();
  const written: string[] = [];
  for (const run of runIds(o.root)) {
    const file = join(o.root, 'submissions', `${run}.json`);
    if (existsSync(file)) continue;
    // --no-renames: a run moved into this path counts as added where it now lives.
    const added = o.git(['log', '--no-renames', '--diff-filter=A', '--format=%H', '--', `results/${run}/run.json`]).trim().split('\n')[0];
    if (!added) continue; // not committed yet
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(submissionFor(run, added, o.api, now), null, 2) + '\n');
    written.push(run);
  }
  return written;
}

/** Map the logical keys to GitHub REST paths for `repo`, with a cache: many runs share a commit. */
export function githubApi(repo: string, get: (path: string) => unknown): GitHub {
  const cache = new Map<string, unknown>();
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const [kind, arg] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const path = kind === 'commit' ? `repos/${repo}/commits/${arg}`
      : kind === 'pulls-of' ? `repos/${repo}/commits/${arg}/pulls`
      : kind === 'pr-commits' ? `repos/${repo}/pulls/${arg}/commits?per_page=100`
      : null;
    if (!path) throw new Error(`unknown GitHub lookup ${key}`);
    const value = get(path);
    cache.set(key, value);
    return value;
  };
}
