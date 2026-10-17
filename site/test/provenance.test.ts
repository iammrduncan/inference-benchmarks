import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSubmission } from '../scripts/provenance.ts';

const RUN = 'm/hf-1/bf16/eng/typed-decisions/2026-10-17-quick-p-abc123';
function root(record?: unknown): string {
  const r = mkdtempSync(join(tmpdir(), 'site-subs-'));
  if (record !== undefined) {
    mkdirSync(join(r, 'submissions', RUN, '..'), { recursive: true });
    writeFileSync(join(r, 'submissions', `${RUN}.json`), JSON.stringify(record));
  }
  return r;
}
const sha = 'a'.repeat(40);

test('a recorded submission is read as who, PR, commit and signature', () => {
  const s = readSubmission(root({ submitted_by: 'alice', pr: 12, commit: { sha, author: 'alice', signature: { verified: true, reason: 'valid', type: 'ssh' } } }), RUN);
  assert.deepEqual(s, { by: 'alice', pr: 12, commit: sha, author: 'alice', signature: { verified: true, reason: 'valid', type: 'ssh' } });
});

test('a run without a record yet has no submission', () => {
  assert.equal(readSubmission(root(), RUN), null);
});

test('a malformed record fails the build; odd logins and types are dropped, not shown', () => {
  assert.throws(() => readSubmission(root({ submitted_by: 'alice', commit: { sha: 'short', signature: { verified: true, reason: 'valid' } } }), RUN), /commit\.sha/);
  const s = readSubmission(root({ submitted_by: '<script>', pr: 'x', commit: { sha, author: null, signature: { verified: false, reason: 'unsigned', type: 'weird' } } }), RUN);
  assert.deepEqual(s, { by: null, pr: null, commit: sha, author: null, signature: { verified: false, reason: 'unsigned', type: null } });
});
