#!/usr/bin/env node
// The `contribution rules` check for a pull request: `node runner/src/check-contribution.ts`.
// Runs in a pull_request checkout with full history, where HEAD is GitHub's merge commit
// (HEAD^1 is main, HEAD^2 the pull request). Needs GH_TOKEN, PR and GITHUB_REPOSITORY.
// Node built-ins, git and gh only: it reads the pull request and never runs its code.
import { execFileSync } from 'node:child_process';
import { contributionProblems, parseChanges, type PrCommit } from './contribution.ts';

const repo = process.env.GITHUB_REPOSITORY;
const pr = process.env.PR;
if (!repo || !pr || !/^\d+$/.test(pr)) throw new Error('needs GITHUB_REPOSITORY and PR (the pull request number)');

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const gh = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const changes = parseChanges(git(['diff', '--name-status', '--no-renames', 'HEAD^1', 'HEAD']));
const read = (path: string): string | null => { try { return git(['show', `HEAD:${path}`]); } catch { return null; } };
const inMain = (commit: string): boolean => { try { git(['merge-base', '--is-ancestor', commit, 'HEAD^1']); return true; } catch { return false; } };

const shas = gh(['api', '--paginate', `repos/${repo}/pulls/${pr}/commits`, '--jq', '.[].sha']).split('\n').filter(Boolean);
const commits: PrCommit[] = shas.map((sha) => {
  const c = JSON.parse(gh(['api', `repos/${repo}/commits/${sha}`])) as { files?: { filename: string }[]; commit: { verification?: { verified: boolean; reason: string } } };
  return { sha, touchesResults: (c.files ?? []).some((f) => f.filename.startsWith('results/')), verified: c.commit.verification?.verified === true, reason: c.commit.verification?.reason ?? 'unknown' };
});

const problems = contributionProblems({ changes, read, inMain, commits });
const runs = changes.filter((c) => c.status === 'A' && c.path.startsWith('results/') && c.path.endsWith('/run.json')).length;
for (const p of problems) console.log(`::error::${p}`);
console.log(problems.length ? `${problems.length} problem(s)` : `contribution rules pass (${changes.length} changed file(s), ${runs} new run(s), ${commits.length} commit(s))`);
process.exit(problems.length ? 1 : 0);
