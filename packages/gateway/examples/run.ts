import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { z } from 'zod';
import { createServer } from '../src/http.js';
import { parseSystemOne, questionJob, chatRequest } from '../src/contracts.js';
import { compileSchema } from '../src/schema.js';
import { providerBody } from '../src/cerebras.js';
import { limits, parseJson, record } from '../src/json.js';
import { examples } from '../src/examples/fixtures.js';
import { decide } from '../src/examples/policies.js';

const live = process.argv.includes('--live');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const selected = only ? examples.filter(e => e.id === only) : examples;
if (!selected.length) throw new Error('Unknown example ID');
const providerKey = live ? process.env.CEREBRAS_API_KEY : 'synthetic-provider-key';
if (!providerKey) throw new Error('CEREBRAS_API_KEY is required for live examples.');
const proxyKey = randomBytes(24).toString('hex');
const fixtures = new Map<string, number[]>();
let plannedCalls = 0;
let conservativeCostUsd = 0;
for (const example of selected) {
  const plan = example.route === '/v1/systemone' ? (() => {
    const parsed = parseSystemOne(example.payload, 'qwen-3.8-27b');
    return { messages: parsed.messages, jobs: parsed.questions.map(q => questionJob(q.question)) };
  })() : (() => {
    const parsed = chatRequest.parse(example.payload);
    return { messages: parsed.messages, jobs: [compileSchema(parsed.response_format.json_schema.schema, parsed.response_format.json_schema.description).job] };
  })();
  plan.jobs.forEach((job, index) => {
    const body = providerBody('qwen-3.8-27b', plan.messages, job);
    const inputByteBound = Buffer.byteLength(JSON.stringify(body)) + 1024;
    if (inputByteBound > 16_000) throw new Error('Live example input budget exceeded');
    plannedCalls++;
    // Qwen list pricing checked 2026-09-16. Conservatively treat each input byte
    // as a token and reserve the full output cap. No retries or dynamic workloads.
    conservativeCostUsd += (inputByteBound * 0.99 + limits.completionTokens * 1.49) / 1e6;
    const output = example.outputs[index];
    if (!output) throw new Error('Missing synthetic stub result');
    fixtures.set(JSON.stringify(body), output);
  });
}
if (plannedCalls > 32 || conservativeCostUsd > 1) throw new Error('Example run exceeds 32-call / $1 budget');
const upstream = live ? undefined : Fastify({ logger: false });
let providerEndpoint: string | undefined;
if (upstream) {
  upstream.post('/v1/chat/completions', async request => {
    const p = fixtures.get(JSON.stringify(request.body));
    if (!p) throw new Error('Unexpected stub request');
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ p }), reasoning: 'SECRET_STUB_REASONING' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 } };
  });
  providerEndpoint = `${await upstream.listen({ host: '127.0.0.1', port: 0 })}/v1/chat/completions`;
}
const server = await createServer({ apiKey: providerKey, proxyKey, ...(providerEndpoint ? { providerEndpoint } : {}) });
const report: { mode: string; model: string; generatedAt: string; plannedCalls: number; conservativeCostUsd: number; results: unknown[] } = {
  mode: live ? 'live' : 'synthetic-stub', model: 'qwen-3.8-27b', generatedAt: new Date().toISOString(), plannedCalls, conservativeCostUsd, results: [],
};
try {
  for (const example of selected) {
    const start = performance.now();
    const response = await server.inject({ method: 'POST', url: example.route,
      headers: { authorization: `Bearer ${proxyKey}`, 'content-type': 'application/json' }, payload: JSON.stringify(example.payload) });
    const data = parseJson(response.body);
    const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
    if (response.body.includes('SECRET_DEMO_CANARY') || response.body.includes('SECRET_STUB_REASONING')) throw new Error('Output containment failed');
    let result: unknown = data;
    if (example.route === '/v1/chat/completions' && response.statusCode === 200) {
      const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).length(1) }).parse(data);
      const first = parsed.choices[0]; if (!first) throw new Error('Missing output');
      result = parseJson(first.message.content);
    }
    const usage = record(data) ? data.usage : undefined;
    const decision = response.statusCode === 200 ? decide(example.id, result) : { action: 'error_no_action' };
    report.results.push({ id: example.id, name: example.name, status: response.statusCode, elapsedMs, result, decision, usage });
    console.log(JSON.stringify({ id: example.id, mode: report.mode, status: response.statusCode, elapsedMs, result, decision }));
    if (response.statusCode !== 200) process.exitCode = 1;
  }
  const reportPath = live ? new URL('../../../docs/live-results.json', import.meta.url) : '/tmp/typesafe-examples-stub-results.json';
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${reportPath}. Planned provider calls: ${plannedCalls}; conservative cost ceiling: $${conservativeCostUsd.toFixed(3)}.`);
} finally { await server.close(); await upstream?.close(); }
