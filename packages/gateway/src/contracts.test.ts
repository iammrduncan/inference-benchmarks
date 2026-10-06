import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, distribution, parseSystemOne, questionJob } from './contracts.js';
import { compileSchema } from './schema.js';
import { parseJson } from './json.js';
import { providerBody } from './cerebras.js';
import { noulRequest } from './test-support.js';
import { z } from 'zod';

test('provider selection indices are explicit and agree with decoding, including reversed enums', () => {
  for (const labels of [['allow', 'block'], ['block', 'allow']]) {
    const compiled = compileSchema({ type: 'object', description: 'Root evaluation criteria', properties: {
      decision: { type: 'string', enum: labels }, valid: { type: 'boolean' },
    }, required: ['decision', 'valid'], additionalProperties: false });
    const rubric = z.object({fields:z.array(z.object({allowedSelections:z.array(z.object({index:z.number(),value:z.union([z.string(),z.boolean()])}))}))}).parse(compiled.job.rubric);
    assert.deepEqual(rubric.fields.map(f=>f.allowedSelections), [labels.map((value,index)=>({index,value})), [{index:0,value:false},{index:1,value:true}]]);
    for (const index of [0, 1]) assert.deepEqual(compiled.decode([index,index]), {decision:labels[index],valid:index===1});

  }
});

test('duplicate keys, escaped duplicates, nonfinite JSON and depth are rejected', () => {
  for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":1e999}', '{"x":1,}', '{/*comment*/"x":1}', '['.repeat(33) + '0' + ']'.repeat(33)]) assert.throws(() => parseJson(text));
});
test('distribution math is bounded and ties are stable', () => {
  const q = { type: 'choice', instructions: 'Pick.', criteria: { z: null, a: null } } as const;
  assert.deepEqual(answer(q, [0.5, 0.5]), { type: 'choice', choice: 'a', probabilities: { a: 0.5, z: 0.5 }, confidence: 0 });
  const score = answer({ type: 'score', instructions: 'Rate.', criteria: ['a', 'b', 'c'] }, [0.1, 0.7, 0.2]);
  assert.equal(score.type, 'score');
  if (score.type === 'score') assert.equal(score.score, 1.1);
  assert.equal(distribution([0.5000001, 0.5]).reduce((a, b) => a + b), 1);
  for (const p of [[0, 0], [0.4, 0.4], [1.1, -0.1], [NaN, 1], [Infinity, 0]]) assert.throws(() => distribution(p));
});
test('TypeSafe IDs are never inference context and structured descriptions work', () => {
  const original = parseSystemOne(noulRequest, 'qwen-3.8-27b');
  const renamed = parseSystemOne({ ...noulRequest, questions: { SECRET_ID: noulRequest.questions.refund } }, 'qwen-3.8-27b');
  const q1 = original.questions[0], q2 = renamed.questions[0];
  assert.ok(q1 && q2);
  const a = providerBody(original.model, original.messages, questionJob(q1.question));
  const b = providerBody(renamed.model, renamed.messages, questionJob(q2.question));
  assert.deepEqual(a, b);
  assert.ok(!JSON.stringify(b).includes('SECRET_ID'));
  assert.doesNotThrow(() => parseSystemOne({ ...noulRequest, questions: { a: { type: 'score', instructions: { question: 'Rate.' }, criteria: [{ level: 0 }, ['high']] } } }, 'qwen-3.8-27b'));
});
test('arbitrary generated strings and open-ended structures have no codec', () => {
  for (const schema of [
    { type: 'string' },
    { type: 'object', properties: { explanation: { type: 'string' } }, required: ['explanation'], additionalProperties: false },
    { type: 'object', properties: {}, required: [], additionalProperties: true },
    { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false },
    { type: 'object', properties: { n: { type: 'number', minimum: 1, maximum: 2, pattern: '.*' } }, required: ['n'], additionalProperties: false },
    { type: 'object', properties: {}, required: [], additionalProperties: false, $ref: 'https://evil.test' },
    { type: 'object', properties: { n: { type: 'integer', minimum: 0.1, maximum: 0.2 } }, required: ['n'], additionalProperties: false },
  ]) assert.throws(() => compileSchema(schema));
});
test('numeric codec rebuilds ONLY declared literals, bounds and fixed shapes', () => {
  const schema = { type: 'object', properties: {
    choice: { type: 'string', enum: ['allow', 'deny'] }, count: { type: 'integer', minimum: 0, maximum: 3 },
    certain: { type: 'boolean' }, constant: { type: 'string', const: 'fixed' }, empty: { type: 'null' },
    tuple: { type: 'array', prefixItems: [{ type: 'number', minimum: 0, maximum: 1 }], items: false },
  }, required: ['choice', 'count', 'certain', 'constant', 'empty', 'tuple'], additionalProperties: false };
  const compiled = compileSchema(schema);
  assert.deepEqual(compiled.decode([1, 2, 1, 0.75]), { choice: 'deny', count: 2, certain: true, constant: 'fixed', empty: null, tuple: [0.75] });
  for (const values of [[2, 2, 1, 0.5], [0.5, 2, 1, 0.5], [1, 4, 1, 0.5], [1, 2, 1, 2], [1, 2, 1], [1, 2, 1, 0.5, 999]]) assert.throws(() => compiled.decode(values));
});
test('prototype-like output keys and option labels round trip without mutation', () => {
  const schema = parseJson('{"type":"object","properties":{"__proto__":{"type":"string","enum":["safe"]}},"required":["__proto__"],"additionalProperties":false}');
  const output = compileSchema(schema).decode([0]);
  assert.equal(JSON.stringify(output), '{"__proto__":"safe"}');
  const input = parseSystemOne(parseJson('{"state":"x","model":"jev-latest","questions":{"__proto__":{"type":"choice","instructions":"Pick","criteria":{"__proto__":null,"constructor":null}}}}'), 'qwen-3.8-27b');
  const q = input.questions[0]; assert.ok(q);
  const result = answer(q.question, [1, 0]);
  assert.ok(JSON.stringify(result).includes('"__proto__":1'));
});

test('contract boundaries accept 255 choices and ten score levels only', () => {
  const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`option_${i}`, null]));
  const request = { ...noulRequest, questions: { select: { type: 'choice', instructions: 'Pick', criteria } } };
  const parsed = parseSystemOne(request, 'qwen-3.8-27b');
  const first = parsed.questions[0]; assert.ok(first);
  assert.equal(questionJob(first.question).slots.length, 255);
  assert.throws(() => parseSystemOne({ ...request, questions: { select: { ...request.questions.select, criteria: { ...criteria, extra: null } } } }, 'qwen-3.8-27b'));
  for (const size of [1, 2, 10, 11]) {
    const run = () => parseSystemOne({ ...noulRequest, questions: { s: { type: 'score', instructions: null, criteria: Array.from({ length: size }, () => null) } } }, 'qwen-3.8-27b');
    if (size === 2 || size === 10) assert.doesNotThrow(run); else assert.throws(run);
  }
});
test('root and enclosing schema descriptions remain part of the rubric', () => {
  const compiled = compileSchema({ type: 'object', description: 'Root rubric', properties: {
    result: { type: 'object', description: 'Nested rubric', properties: { approved: { type: 'boolean', description: 'Leaf rubric' } }, required: ['approved'], additionalProperties: false },
  }, required: ['result'], additionalProperties: false }, 'Envelope rubric');
  for (const description of ['Root rubric', 'Nested rubric', 'Leaf rubric', 'Envelope rubric']) assert.ok(JSON.stringify(compiled.job.rubric).includes(description));
});
