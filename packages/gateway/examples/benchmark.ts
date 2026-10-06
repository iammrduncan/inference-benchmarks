import { randomBytes } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { z } from 'zod';
import { createServer } from '../src/http.js';
import { estimatedCost, percentiles, prices } from '../src/metrics.js';
import type { ProviderMetric } from '../src/metrics.js';
import type { Model, Usage } from '../src/contracts.js';
import { parseSystemOne, questionJob, chatRequest } from '../src/contracts.js';
import { providerBody } from '../src/cerebras.js';
import { compileSchema } from '../src/schema.js';
import { limits, parseJson } from '../src/json.js';

const live = process.argv.includes('--live');
const option = (key: string, fallback: string) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const samples = z.coerce.number().int().min(1).max(live ? 32 : 1000).parse(option('samples', live ? '12' : '100'));
const warmup = z.coerce.number().int().min(0).max(10).parse(option('warmup', '1'));
const concurrency = z.coerce.number().int().min(1).max(4).parse(option('concurrency', '1'));
const model: Model = z.enum(['qwen-3.8-27b', 'gpt-oss-120b']).parse(option('model', 'qwen-3.8-27b'));
const providerKey = live ? process.env.CEREBRAS_API_KEY : 'synthetic-benchmark-key';
if (!providerKey) throw new Error('CEREBRAS_API_KEY required');
const proxyKey = randomBytes(24).toString('hex');
const systemone = { model, state: 'Please refund the duplicate charge.', questions: {
  refund: { type: 'noul', instructions: 'Does the customer request money back?' },
} };
const chat = { model, messages: [{ role: 'user', content: 'Please refund the duplicate charge.' }],
  response_format: { type: 'json_schema', json_schema: { name: 'judgment', strict: true, schema: {
    type: 'object', properties: { refund: { type: 'number', minimum: 0, maximum: 1, description: 'Probability the customer asks for money back.' } },
    required: ['refund'], additionalProperties: false,
  } } } };
const payloads = [{ route: '/v1/systemone', value: systemone }, { route: '/v1/chat/completions', value: chat }];
const tsInput = parseSystemOne(systemone, model);
const tsQuestion = tsInput.questions[0]; if (!tsQuestion) throw new Error('Missing benchmark question');
const chatInput = chatRequest.parse(chat);
const providerBodies = [providerBody(model, tsInput.messages, questionJob(tsQuestion.question)),
  providerBody(model, chatInput.messages, compileSchema(chatInput.response_format.json_schema.schema).job)];
const largestPromptBytes = Math.max(...providerBodies.map(body => Buffer.byteLength(JSON.stringify(body)) + 1024));
const conservativeCostUsd = estimatedCost(model, { input_tokens: largestPromptBytes * (samples + warmup), output_tokens: limits.completionTokens * (samples + warmup) });
if (live && (samples + warmup > 32 || conservativeCostUsd > 1)) throw new Error('Live benchmark exceeds 32 calls or $1 conservative ceiling');

const upstream = live ? undefined : Fastify({ logger: false });
let endpoint: string | undefined;
if (upstream) {
  upstream.post('/v1/chat/completions', async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"p":[0.95]}', tool_calls: null } }],
    usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  endpoint = `${await upstream.listen({ host: '127.0.0.1', port: 0 })}/v1/chat/completions`;
}
const metrics: ProviderMetric[] = [];
const app = await createServer({ apiKey: providerKey, proxyKey, model,
  ...(endpoint ? { providerEndpoint: endpoint } : {}), onMetric: metric => metrics.push(metric) });
const origin = await app.listen({ host: '127.0.0.1', port: 0 });
const usage = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() });
const openaiUsage = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() });
type Row = { route: string; requestId: string | null; status: number; latencyMs: number; inputBytes: number; usage: Usage | null };
async function run(index: number): Promise<Row> {
  const payload = payloads[index % payloads.length]; if (!payload) throw new Error('Missing payload');
  const serialized = JSON.stringify(payload.value);
  const start = performance.now();
  const response = await fetch(`${origin}${payload.route}`, { method: 'POST', headers: { authorization: `Bearer ${proxyKey}`, 'content-type': 'application/json' }, body: serialized });
  const data = z.object({ usage: z.unknown().optional() }).parse(parseJson(await response.text()));
  const latencyMs = performance.now() - start;
  const ts = usage.safeParse(data.usage), oa = openaiUsage.safeParse(data.usage);
  const normalized = ts.success ? ts.data : oa.success ? { input_tokens: oa.data.prompt_tokens, output_tokens: oa.data.completion_tokens } : null;
  return { route: payload.route, requestId: response.headers.get('x-request-id'), status: response.status, latencyMs, inputBytes: Buffer.byteLength(serialized), usage: normalized };
}
const totalUsage = (events: ProviderMetric[]) => events.reduce((sum, m) => ({ input_tokens: sum.input_tokens + (m.usage?.input_tokens ?? 0),
  output_tokens: sum.output_tokens + (m.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 });
try {
  const warmupRows: Row[] = [];
  for (let i = 0; i < warmup; i++) warmupRows.push(await run(i));
  const warmupMetrics = metrics.splice(0);
  const rows: Row[] = [];
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < samples) { const index = next++; rows.push(await run(index)); }
  }));
  const durationMs = performance.now() - start;
  const good = rows.filter(row => row.status === 200);
  const measuredUsage = totalUsage(metrics);
  const allEvents = [...warmupMetrics, ...metrics];
  const knownTotal = totalUsage(allEvents);
  const unknownUsageCalls = allEvents.filter(m => !m.usage).length;
  const timed = metrics.filter(m => m.usage && m.timing && m.timing.completion_time > 0);
  const decodeSeconds = timed.reduce((sum, m) => sum + (m.timing?.completion_time ?? 0), 0);
  const timedOutput = timed.reduce((sum, m) => sum + (m.usage?.output_tokens ?? 0), 0);
  const successfulOutput = good.reduce((sum, row) => sum + (row.usage?.output_tokens ?? 0), 0);
  const successfulMs = good.reduce((sum, row) => sum + row.latencyMs, 0);
  const enriched = rows.map(row => {
    const call = metrics.find(m => m.requestId === row.requestId);
    return { ...row, upstreamRoundTripMs: call?.durationMs ?? null, localQueueWaitMs: call?.queueWaitMs ?? null,
      localAndLoopbackMs: call ? Math.max(0, row.latencyMs - call.durationMs - call.queueWaitMs) : null,
      estimatedCostUsd: row.usage ? live ? estimatedCost(model, row.usage) : 0 : null };
  });
  const report = { mode: live ? 'live' : 'local-stub', generatedAt: new Date().toISOString(), model,
    versions: { prompt: 'numeric-v1', codec: 'numeric-v1', node: process.version },
    environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' },
    workload: { samples, warmup, concurrency, questionsPerRequest: 1, optionsPerQuestion: 0, schema: 'bounded number [0,1]', durationMs,
      requestBytes: payloads.map(p => ({ route: p.route, bytes: Buffer.byteLength(JSON.stringify(p.value)) })),
      reasoningEffort: model === 'qwen-3.8-27b' ? 'none' : 'low', temperature: 0, maxCompletionTokens: limits.completionTokens },
    results: { successes: good.length, failures: rows.length - good.length, retries: 0,
      invalidOutputCalls: metrics.filter(m => m.outcome === 'invalid_provider_output').length,
      allRequestLatencyMs: percentiles(rows.map(r => r.latencyMs)), successfulRequestLatencyMs: percentiles(good.map(r => r.latencyMs)),
      byEndpoint: payloads.map(p => ({ route: p.route, samples: rows.filter(r => r.route === p.route).length,
        successfulLatencyMs: percentiles(good.filter(r => r.route === p.route).map(r => r.latencyMs)) })),
      successfulRequestsPerSecond: good.length / (durationMs / 1000),
      endToEndOutputTokensPerSecond: successfulMs ? successfulOutput / (successfulMs / 1000) : null,
      aggregateSuccessfulOutputTokensPerSecond: successfulOutput / (durationMs / 1000),
      providerDecodeTokensPerSecond: live && decodeSeconds ? timedOutput / decodeSeconds : null,
      providerTimingSampleCount: timed.length, usage: measuredUsage,
      estimatedMeasuredCostUsd: live ? estimatedCost(model, measuredUsage) : 0,
      listPriceEquivalentMeasuredCostUsd: estimatedCost(model, measuredUsage) },
    budget: { conservativeCostUsd, estimatedWholeRunCostUsd: live ? estimatedCost(model, knownTotal) : 0,
      usageIncludingWarmup: knownTotal, unknownUsageCalls, costComplete: unknownUsageCalls === 0,
      note: 'Costs are list-price estimates, not invoices; failed calls with missing usage may still be billable. Local-stub tokens are synthetic.' },
    pricing: { checked: '2026-09-16', usdPerMillionTokens: prices[model], source: model === 'qwen-3.8-27b'
      ? 'https://inference-docs.cerebras.ai/models/qwen-3.8-27b' : 'https://inference-docs.cerebras.ai/models/openai-oss' },
    limitations: ['Small samples do not establish a p99 SLA.', 'End-to-end tokens/s includes network and input processing; provider decode rate uses reported completion_time.',
      'Local-and-loopback time includes HTTP/client work; this is not an isolated CPU benchmark.', 'Only synthetic one-question workloads; no TypeSafe performance or calibration parity claim.'],
    warmupRows, warmupMetrics, rows: enriched, providerMetrics: metrics };
  await mkdir(new URL('../../../docs/benchmarks/', import.meta.url), { recursive: true });
  const path = new URL(`../../../docs/benchmarks/${live ? 'live' : 'local-stub'}.json`, import.meta.url);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: path, results: report.results, budget: report.budget }, null, 2));
  if (good.length !== rows.length || warmupRows.some(row => row.status !== 200)) process.exitCode = 1;
} finally { await app.close(); await upstream?.close(); }
