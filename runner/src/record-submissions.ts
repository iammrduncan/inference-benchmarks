#!/usr/bin/env node
// Record who submitted each new run: `node runner/src/record-submissions.ts`.
// Uses the `gh` CLI for GitHub (GH_TOKEN in CI, your login locally) and git for history.
// Run by .github/workflows/record-submissions.yml after every push to main that adds results.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubApi, recordSubmissions } from './submissions.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const repo = process.env.GITHUB_REPOSITORY ?? 'iammrduncan/inference-benchmarks';
const get = (path: string): unknown => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const git = (args: string[]): string => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });

const written = recordSubmissions({ root: REPO_ROOT, api: githubApi(repo, get), git });
for (const run of written) console.log(`recorded submissions/${run}.json`);
console.log(`${written.length} new submission record(s)`);
