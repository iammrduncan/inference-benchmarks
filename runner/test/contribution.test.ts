// The contribution rules: what a pull request may change, and what a new run must carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionProblems, parseChanges, type Change, type Inputs } from '../src/contribution.ts';

const RUN = 'results/m/hf-1/bf16/eng/typed-decisions/2026-10-17-quick-p-abc123';
const KEY = 'm/hf-1/bf16/eng';
const MAIN = 'a'.repeat(40);
const runJson = (over: Record<string, unknown> = {}) => JSON.stringify({ harness: { commit: MAIN, dirty: false }, subject: { key: KEY }, ...over });
const add = (...paths: string[]): Change[] => paths.map((path) => ({ status: 'A', path }));
const complete = add(`${RUN}/run.json`, `${RUN}/summary.json`, `${RUN}/raw.jsonl`);
const signed = [{ sha: 'c'.repeat(40), touchesResults: true, verified: true, reason: 'valid' }];

function inputs(over: Partial<Inputs> = {}, files: Record<string, string> = {}): Inputs {
  const tree: Record<string, string> = { [`${RUN}/run.json`]: runJson(), [`subjects/${KEY}/subject.yaml`]: 'key: x\n', ...files };
  return { changes: complete, read: (p) => tree[p] ?? null, inMain: (c) => c === MAIN, commits: signed, ...over };
}

test('a complete, signed run from a published bench passes', () => {
  assert.deepEqual(contributionProblems(inputs()), []);
  assert.deepEqual(contributionProblems(inputs({ changes: [...complete, ...add(`${RUN}/harness/scores.json`, `subjects/${KEY}/subject.yaml`)] })), []);
});

test('pull requests without results only have to leave submissions/ alone', () => {
  assert.deepEqual(contributionProblems(inputs({ changes: [{ status: 'M', path: 'site/app/page.tsx' }], commits: [] })), []);
  const p = contributionProblems(inputs({ changes: [{ status: 'A', path: 'submissions/x/run.json' }], commits: [] }));
  assert.equal(p.length, 1);
  assert.match(p[0] ?? '', /submissions\/ is written after merge/);
});

test('results come alone: no code, suites or workflows in the same pull request', () => {
  const p = contributionProblems(inputs({ changes: [...complete, { status: 'M', path: 'runner/src/run.ts' }, { status: 'M', path: '.github/workflows/check.yml' }] }));
  assert.deepEqual(p.length, 1);
  assert.match(p[0] ?? '', /changes only results\/ and subjects\/.*runner\/src\/run\.ts, \.github\/workflows\/check\.yml/);
});

test('existing run files are never changed, renamed or deleted', () => {
  const p = contributionProblems(inputs({ changes: [...complete, { status: 'M', path: 'results/old/run/summary.json' }, { status: 'D', path: 'results/old/run/raw.jsonl' }] }));
  assert.match(p.join('\n'), /never changed.*M results\/old\/run\/summary\.json, D results\/old\/run\/raw\.jsonl/);
});

test('a new run folder is complete, and its raw data is in the pull request', () => {
  const p = contributionProblems(inputs({ changes: add(`${RUN}/run.json`, `${RUN}/summary.json`, `${RUN}/raw.pointer.json`) }));
  assert.match(p.join('\n'), /missing raw\.jsonl \(raw data must be in the pull request/);
  assert.match(contributionProblems(inputs({ changes: add('results/loose.json') })).join('\n'), /aren't inside a new run folder .*: results\/loose\.json/);
});

test('the run was made by a published, unmodified bench', () => {
  assert.match(contributionProblems(inputs({}, { [`${RUN}/run.json`]: runJson({ harness: { commit: 'b'.repeat(40), dirty: false } }) })).join('\n'), /bbbbbbb, which isn't in main's history/);
  assert.match(contributionProblems(inputs({}, { [`${RUN}/run.json`]: runJson({ harness: { commit: MAIN, dirty: true } }) })).join('\n'), /local changes \(harness\.dirty\)/);
  assert.match(contributionProblems(inputs({}, { [`${RUN}/run.json`]: '{not json' })).join('\n'), /not valid JSON/);
});

test("the run's subject has a subject.yaml", () => {
  const p = contributionProblems({ ...inputs(), read: (path) => (path.endsWith('run.json') ? runJson() : null) });
  assert.match(p.join('\n'), /needs subjects\/m\/hf-1\/bf16\/eng\/subject\.yaml/);
});

test('every commit that adds results is signed and verified', () => {
  const p = contributionProblems(inputs({ commits: [...signed, { sha: 'd'.repeat(40), touchesResults: true, verified: false, reason: 'unsigned' }, { sha: 'e'.repeat(40), touchesResults: false, verified: false, reason: 'unsigned' }] }));
  assert.deepEqual(p.length, 1);
  assert.match(p[0] ?? '', /commit ddddddd adds results but GitHub didn't verify a signature \(unsigned\)/);
});

test('git name-status lines parse, with renames off', () => {
  assert.deepEqual(parseChanges('A\tresults/x/run.json\nM\tREADME.md\nD\told.txt\n'), [
    { status: 'A', path: 'results/x/run.json' }, { status: 'M', path: 'README.md' }, { status: 'D', path: 'old.txt' }]);
});
