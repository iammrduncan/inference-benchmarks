import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(fileURLToPath(new URL('..', import.meta.url)), 'scripts', 'build-manifest.ts');

test('the committed records build a manifest (check only, nothing written)', () => {
  const out = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.match(out, /manifest: \d+ runs, \d+ subjects, \d+ leaderboards, \d+ model matrices \(check only\)/);
});
