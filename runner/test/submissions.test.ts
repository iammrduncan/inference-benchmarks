// Who submitted a run: the contributor's own commit counts, even after a squash merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordSubmissions, signatureOf, submissionFor, type GitHub } from '../src/submissions.ts';

const SSH = '-----BEGIN SSH SIGNATURE-----\nU1NI\n-----END SSH SIGNATURE-----';
const commit = (sha: string, login: string | null, sig: { verified: boolean; reason: string; signature: string | null }, files: string[] = [], committer = login) =>
  ({ sha, author: login ? { login } : null, committer: committer ? { login: committer } : null, commit: { verification: sig }, files: files.map((filename) => ({ filename })) });
const unsigned = { verified: false, reason: 'unsigned', signature: null };
const RUN = 'm/hf-1/bf16/eng/typed-decisions/2026-10-17-quick-p-abc123';
const PATH = `results/${RUN}/run.json`;

function fakeApi(table: Record<string, unknown>): GitHub {
  return (key) => { if (!(key in table)) throw new Error(`unexpected lookup ${key}`); return table[key]; };
}

test('a squash-merged pull request credits its author and their own signed commit', () => {
  const api = fakeApi({
    'commit:main1': commit('main1', 'alice', { verified: true, reason: 'valid', signature: '-----BEGIN PGP SIGNATURE-----' }, [PATH], 'web-flow'),
    'pulls-of:main1': [{ number: 12, user: { login: 'alice' }, merge_commit_sha: 'main1', merged_at: '2026-10-17T00:00:00Z' }],
    'pr-commits:12': [{ sha: 'c1' }, { sha: 'c2' }],
    'commit:c1': commit('c1', 'alice', unsigned, ['README.md']),
    'commit:c2': commit('c2', 'alice', { verified: true, reason: 'valid', signature: SSH }, [PATH]),
  });
  const s = submissionFor(RUN, 'main1', api, 'now');
  assert.equal(s.submitted_by, 'alice');
  assert.equal(s.pr, 12);
  assert.equal(s.commit.sha, 'c2', 'the commit that added the run, not the squash commit GitHub signed');
  assert.deepEqual(s.commit.signature, { verified: true, reason: 'valid', type: 'ssh' });
  assert.equal(s.landed_in, 'main1');
});

test('a direct push credits the commit author; an unsigned commit says so', () => {
  const api = fakeApi({ 'commit:d1': commit('d1', 'owner', unsigned, [PATH]), 'pulls-of:d1': [] });
  const s = submissionFor(RUN, 'd1', api, 'now');
  assert.deepEqual([s.submitted_by, s.pr, s.commit.sha], ['owner', null, 'd1']);
  assert.deepEqual(s.commit.signature, { verified: false, reason: 'unsigned', type: null });
});

test('a commit that reached main inside a merged pull request names that pull request', () => {
  const api = fakeApi({
    'commit:f1': commit('f1', 'bob', unsigned, [PATH]),
    'pulls-of:f1': [{ number: 3, user: { login: 'bob' }, merge_commit_sha: 'm9', merged_at: '2026-10-17T00:00:00Z' }],
  });
  assert.deepEqual([submissionFor(RUN, 'f1', api, 'now').submitted_by, submissionFor(RUN, 'f1', api, 'now').pr], ['bob', 3]);
});

test('signature types come from the armor; anything else is null', () => {
  assert.equal(signatureOf(commit('x', null, { verified: true, reason: 'valid', signature: SSH })).type, 'ssh');
  assert.equal(signatureOf(commit('x', null, { verified: true, reason: 'valid', signature: '-----BEGIN PGP SIGNATURE-----' })).type, 'gpg');
  assert.equal(signatureOf(commit('x', null, { verified: false, reason: 'bad_email', signature: '-----BEGIN SIGNED MESSAGE-----' })).type, 'x509');
  assert.equal(signatureOf(commit('x', null, unsigned)).type, null);
});

test('records are written once, never rewritten, and uncommitted runs are skipped', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-subs-'));
  for (const run of [RUN, 'n/hf-2/bf16/eng/embeddings/new-run']) { mkdirSync(join(root, 'results', run), { recursive: true }); writeFileSync(join(root, 'results', run, 'run.json'), '{}'); }
  const existing = join(root, 'submissions', `${RUN}.json`);
  mkdirSync(join(root, 'submissions', RUN, '..'), { recursive: true });
  writeFileSync(existing, '{"kept":true}\n');
  const git = (args: string[]) => (args.at(-1) === `results/${RUN}/run.json` ? 'd1\n' : '');
  const written = recordSubmissions({ root, api: fakeApi({}), git, now: 'now' });
  assert.deepEqual(written, []);
  assert.equal(readFileSync(existing, 'utf8'), '{"kept":true}\n');
  assert.ok(!existsSync(join(root, 'submissions', 'n')), 'a run with no commit yet gets no record');
});
