import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractSnapshot, readContract } from '../lib/theater/contract-view';
import { createDemoRuntime } from '../lib/runtime';
import { prepare } from '../lib/contracts';
import { workItem, type SceneId } from '../lib/theater/data';
import { DrivingEngine } from '../lib/theater/driving';
import { navigationMoves } from '../lib/theater/navigation';
import { record } from '@decision/gateway/json';

test('all scene previews use the actual request builder and expose every output field', () => {
  const model = 'qwen-3.8-27b';
  for (const scene of ['dispatch', 'navigate', 'drive', 'screen', 'approve', 'judge', 'home'] satisfies SceneId[]) {
    const context = scene === 'navigate' ? { position: 6, target: 4, visited: [20, 15, 10, 5, 6] }
      : scene === 'drive' ? new DrivingEngine().state : workItem(scene, 0).context;
    const snapshot = contractSnapshot({ scene, model, context, scoreThreshold: 90 });
    assert.equal(snapshot.source, 'Scene preview');
    assert.deepEqual(snapshot.request, prepare({ id: scene, model, text: JSON.stringify(context) }).payload);
    const contract = readContract(snapshot.request); assert.ok(contract);
    assert.ok(contract.fields.length > 0);
    assert.ok(contract.fields.every(field => field.required && field.description));
    assert.equal(contract.schema.additionalProperties, false);
    assert.equal(contract.format.json_schema.strict, true);
    if (scene === 'screen' || scene === 'approve') assert.deepEqual(contract.fields[0]?.enum, ['allow', 'block']);
    if (scene === 'judge') {
      assert.equal(snapshot.scoreThreshold, 90);
      assert.equal(contract.fields[0]?.minimum, 0); assert.equal(contract.fields[0]?.maximum, 100);
      assert.equal(contract.fields[1]?.type, 'boolean');
    } else assert.equal(snapshot.scoreThreshold, undefined);
  }
});

test('recorded routing contract stays tied to its selected hop, including a closed road', async () => {
  const runtime = await createDemoRuntime({ stub: true });
  try {
    const model = 'gpt-oss-120b';
    const context = { position: 6, target: 4, visited: [20, 15, 10, 5, 6] };
    const result = await runtime.run({ id: 'navigate', model, text: JSON.stringify(context) }, new AbortController().signal);
    assert.equal(result.status, 200);
    assert.ok(record(result.body) && 'contract' in result.body);
    const calls = runtime.config().calls;
    // Later state/model changes must not replace the recorded request with a preview.
    const snapshot = contractSnapshot({ scene: 'navigate', model: 'qwen-3.8-27b',
      context: { position: 20, target: 4, visited: [20] }, requestId: 'HOP-5', recorded: result.body.contract });
    assert.equal(snapshot.source, 'Recorded request');
    assert.strictEqual(snapshot.request, result.body.contract);
    assert.equal(snapshot.requestId, 'HOP-5');
    const contract = readContract(snapshot.request); assert.ok(contract);
    assert.equal(contract.model, model);
    assert.deepEqual(contract.fields[0]?.enum, navigationMoves(6).map(move => move.move));
    assert.ok(!contract.fields[0]?.enum?.includes('east'));
    assert.equal(runtime.config().calls, calls);
  } finally { await runtime.close(); }
});

test('pending/failed requests reconstruct their own contract and unknown data has a raw-view fallback', () => {
  const snapshot = contractSnapshot({ scene: 'navigate', model: 'gpt-oss-120b',
    requestId: 'HOP-2', context: { position: 6, target: 4, visited: [20, 6] } });
  assert.equal(snapshot.source, 'Reconstructed request');
  assert.deepEqual(readContract(snapshot.request)?.fields[0]?.enum, navigationMoves(6).map(move => move.move));
  assert.equal(readContract({ unexpected: true }), undefined);
});
