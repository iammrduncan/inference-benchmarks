import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, applyDecision } from './contracts.js';
import { jevPlan, decodeJev } from './jev.js';
import { scenes, workItem, type SceneId } from './scenes/data.js';
import { DrivingEngine } from './scenes/driving.js';

// The package is shared by the theater and the bench runner, so its public surface
// (scene list, request contracts, Jev mapping) must not drift silently.
const ids = ['dispatch', 'navigate', 'drive', 'screen', 'approve', 'judge', 'home'] as const;

function context(scene: SceneId) {
  return scene === 'navigate' ? { position: 20, target: 4, visited: [20] }
    : scene === 'drive' ? new DrivingEngine().state : workItem(scene, 0).context;
}

test('scene list and order are stable', () => {
  assert.deepEqual(scenes.map(s => s.id), ids);
});

test('every scene builds a strict JSON-schema request, and work items are deterministic', () => {
  for (const scene of ids) {
    const text = JSON.stringify(context(scene));
    const first = prepare({ id: scene, text });
    assert.deepEqual(prepare({ id: scene, text }), first, scene);
    assert.equal(first.route, '/v1/chat/completions', scene);
    const format = first.payload.response_format.json_schema;
    assert.equal(format.strict, true, scene);
    assert.equal(format.schema.additionalProperties, false, scene);
    if (scene !== 'navigate' && scene !== 'drive') assert.deepEqual(workItem(scene, 0), workItem(scene, 0), scene);
  }
});

test('the Jev mapping asks one native question per schema field and decodes a full answer', () => {
  for (const scene of ids) {
    const input = { id: scene, model: 'jev-latest' as const, text: JSON.stringify(context(scene)) };
    const plan = jevPlan(input);
    assert.equal(plan.payload.model, 'jev-latest');
    const fields = Object.keys(prepare(input).payload.response_format.json_schema.schema.properties);
    const mapped = new Set(Object.values(plan.mappings).map(m => m.field));
    assert.deepEqual([...mapped].sort(), [...fields].sort(), scene);
    const answers = Object.fromEntries(Object.entries(plan.payload.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { type: 'noul', noul: 0.9 }];
      const choices = Object.keys(q.criteria);
      return [id, { type: 'choice', choice: choices[0], confidence: 1,
        probabilities: Object.fromEntries(choices.map((key, i) => [key, i === 0 ? 1 : 0])) }];
    }));
    const { result } = decodeJev(plan, { model: 'jev-1.13.0', answers, usage: { input_tokens: 1, output_tokens: 1 } });
    assert.doesNotThrow(() => applyDecision(input, result), scene);
  }
});
