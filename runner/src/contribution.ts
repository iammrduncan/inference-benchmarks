// Baseline rules for every pull request. Cheap by design: nothing is rerun. The
// `contribution rules` check (.github/workflows/check.yml) runs these, and the ruleset on
// main blocks a merge while any fails. Records validating and summaries recomputing are
// the other check's job (`npm run check`, `bench summarize --check`).
//
// A pull request that adds results:
// - changes only results/ and subjects/, so it's judged by the checks and scorers already on main;
// - adds new run folders and never changes, renames or deletes an existing run file;
// - brings complete run folders: run.json, summary.json and raw.jsonl (raw data behind a
//   raw.pointer.json isn't in the pull request, so nobody could check it);
// - was made by a published, unmodified bench: harness.commit is in main's history and
//   harness.dirty is false;
// - names a subject that has subjects/<key>/subject.yaml;
// - comes in commits whose signatures GitHub verified.
// No pull request may touch submissions/: the record-submissions workflow writes it after merge.

/** One line of `git diff --name-status --no-renames base head`. */
export type Change = { status: 'A' | 'M' | 'D' | 'T'; path: string };
export type PrCommit = { sha: string; touchesResults: boolean; verified: boolean; reason: string };

export type Inputs = {
  changes: Change[];
  /** A file's contents in the pull request's tree, or null if it doesn't exist there. */
  read: (path: string) => string | null;
  /** True when `commit` is in main's history (an ancestor of the base). */
  inMain: (commit: string) => boolean;
  commits: PrCommit[];
};

const RUN_FILES = ['run.json', 'summary.json', 'raw.jsonl'];
const under = (dir: string) => (c: Change) => c.path.startsWith(`${dir}/`);
const list = (paths: string[]) => paths.slice(0, 5).join(', ') + (paths.length > 5 ? ` and ${paths.length - 5} more` : '');

export function contributionProblems(i: Inputs): string[] {
  const problems: string[] = [];
  const submissions = i.changes.filter(under('submissions'));
  if (submissions.length) problems.push(`submissions/ is written after merge by the record-submissions workflow; remove these changes: ${list(submissions.map((c) => c.path))}`);

  const results = i.changes.filter(under('results'));
  if (!results.length) return problems;

  const elsewhere = i.changes.filter((c) => !under('results')(c) && !under('subjects')(c) && !under('submissions')(c));
  if (elsewhere.length) problems.push(`a pull request that adds results changes only results/ and subjects/; send other changes separately: ${list(elsewhere.map((c) => c.path))}`);

  const touched = results.filter((c) => c.status !== 'A');
  if (touched.length) problems.push(`existing run files are never changed, renamed or deleted: ${list(touched.map((c) => `${c.status} ${c.path}`))}`);

  const added = results.filter((c) => c.status === 'A').map((c) => c.path);
  const runDirs = added.filter((p) => p.endsWith('/run.json')).map((p) => p.slice(0, -'/run.json'.length));
  const stray = added.filter((p) => !runDirs.some((d) => p.startsWith(`${d}/`)));
  if (stray.length) problems.push(`these files aren't inside a new run folder (one with its own run.json): ${list(stray)}`);

  for (const dir of runDirs) {
    const missing = RUN_FILES.filter((f) => !added.includes(`${dir}/${f}`));
    if (missing.length) problems.push(`${dir}: missing ${missing.join(', ')}${added.includes(`${dir}/raw.pointer.json`) ? ' (raw data must be in the pull request as raw.jsonl, not behind raw.pointer.json)' : ''}`);
    let run: { harness?: { commit?: unknown; dirty?: unknown }; subject?: { key?: unknown } };
    try { run = JSON.parse(i.read(`${dir}/run.json`) ?? 'null') ?? {}; } catch { problems.push(`${dir}/run.json: not valid JSON`); continue; }
    const commit = run.harness?.commit;
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) problems.push(`${dir}: run.json harness.commit is missing`);
    else if (!i.inMain(commit)) problems.push(`${dir}: made by bench at ${commit.slice(0, 7)}, which isn't in main's history; run a published bench (pull main, then rerun)`);
    if (run.harness?.dirty !== false) problems.push(`${dir}: made by a bench with local changes (harness.dirty); rerun from a clean checkout`);
    const key = run.subject?.key;
    if (typeof key !== 'string' || i.read(`subjects/${key}/subject.yaml`) === null) problems.push(`${dir}: its subject needs subjects/${String(key)}/subject.yaml (bench writes it; commit it too)`);
  }

  for (const c of i.commits.filter((x) => x.touchesResults && !x.verified)) {
    problems.push(`commit ${c.sha.slice(0, 7)} adds results but GitHub didn't verify a signature (${c.reason}); see CONTRIBUTING.md, "Sign your commits"`);
  }
  return problems;
}

/** Parse `git diff --name-status --no-renames` output. */
export function parseChanges(text: string): Change[] {
  return text.split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    const s = (status ?? '').charAt(0);
    return { status: (s === 'A' || s === 'D' || s === 'T' ? s : 'M') as Change['status'], path: rest.join('\t') };
  });
}
