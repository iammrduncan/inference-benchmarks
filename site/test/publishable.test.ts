import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardwareHostProblems, textProblems } from '../scripts/publishable.ts';

test('public records may name loopback engines, public domains and aliases', () => {
  const ok = [
    '{"url":"http://127.0.0.1:41234/v1/embeddings"}',
    '{"url":"http://localhost:8000/v1/models"}',
    '{"endpoint":"http://gpu-host-2/v1/systemone"}',
    '{"repo":"https://github.com/iammrduncan/inference-engines","hf":"https://huggingface.co/x/y"}',
    '{"note":"authenticated from IP 10.0.4.15"}', // workload text, not an address the harness used
  ];
  for (const text of ok) assert.deepEqual(textProblems(text), [], text);
});

test('public records may not name a lab machine, a private address, an internal domain or a home path', () => {
  const bad: [string, RegExp][] = [
    ['{"url":"http://labbox07:8000/v1/embeddings"}', /"labbox07" is a host name that is not an alias/],
    ['{"url":"http://10.0.0.12:8000/v1"}', /"10\.0\.0\.12" is an IP address/],
    ['{"url":"https://engine.lan/v1"}', /internal domain/],
    ['{"url":"http://box.tailnet-x.ts.net:9000"}', /internal domain/],
    ['{"repo":"/home/someone/.cache/mirror.git"}', /home directory path "\/home\/someone"/],
    ['{"reference":"/Users/someone/src/results/x"}', /home directory path "\/Users\/someone"/],
  ];
  for (const [text, why] of bad) {
    const problems = textProblems(text);
    assert.equal(problems.length, 1, text);
    assert.match(problems[0] ?? '', why);
  }
});

test('run.json hardware hosts must be aliases', () => {
  assert.deepEqual(hardwareHostProblems({ hardware: { host: 'gpu-host-2', placements: [{ host: 'gpu-host-2' }] } }), []);
  assert.deepEqual(hardwareHostProblems({ hardware: null }), []);
  assert.deepEqual(hardwareHostProblems({ hardware: { host: null, placements: [] } }), []);
  assert.deepEqual(hardwareHostProblems({ hardware: { host: 'labbox07', placements: [{ host: 'labbox07' }] } }), ['hardware host "labbox07" is not an alias']);
});
