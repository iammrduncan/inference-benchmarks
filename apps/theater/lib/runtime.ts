import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createServer } from '@decision/gateway/http';
import { chatRequest } from '@decision/gateway/contracts';
import { compileSchema } from '@decision/gateway/schema';
import { providerBody } from '@decision/gateway/cerebras';
import { estimatedCost } from '@decision/gateway/metrics';
import { Fault } from '@decision/gateway/errors';
import { parseJson, record } from '@decision/gateway/json';
import { demoInput, prepare, applyDecision } from '@decision/decisions/contracts';
import { fixtureDispatch } from '@decision/decisions/traffic';
import { theaterId, theaterFixtureAllowed, theaterFixture } from '@decision/decisions/scenes/contracts';
import { demoModel, defaultModel, models } from '@decision/decisions/models';
import { jevPlan, requestJev, fixtureJev } from '@decision/decisions/jev';
import { needleMappingVersion, needlePlan, needleRevision } from './needle-plan';
import { requestNeedle, type NeedleConfig } from './needle';
import { createNeedleRunner } from './needle-worker';
import { rlcdPlan } from './rlcd-plan';
import { createRlcdRunner, type RlcdConfig } from './rlcd';
import rlcdRelease from '../rlcd-release.json';

export async function createDemoRuntime(options: { apiKey?: string; jevApiKey?: string; jevEndpoint?: string;
  needle?: NeedleConfig; rlcd?: RlcdConfig; stub?: boolean } = {}) {
  const stub = options.stub ?? false;
  if (!stub && !options.apiKey && !options.jevApiKey && !options.needle && !options.rlcd) {
    throw new Error('Configure a cloud provider or install a local model');
  }
  const availableModels = demoModel.options.filter(model => stub || (model === 'needle-3' ? options.needle
    : model === 'qwen-2.5-1.5b-rlcd' ? options.rlcd : model === 'jev-latest' ? options.jevApiKey : options.apiKey));
  const initialModel = options.apiKey || stub ? defaultModel : options.jevApiKey ? 'jev-latest'
    : options.needle ? 'needle-3' : 'qwen-2.5-1.5b-rlcd';
  const token = randomBytes(24).toString('hex'), proxyKey = randomBytes(24).toString('hex');
  let calls = 0, active = 0;
  const localControllers = new Set<AbortController>();
  const needleRunner = options.needle && !stub ? createNeedleRunner(options.needle) : undefined;
  const rlcdRunner = options.rlcd && !stub ? createRlcdRunner(options.rlcd) : undefined;
  const upstream = stub ? Fastify({ logger: false }) : undefined;
  let providerEndpoint: string | undefined;
  if (upstream) {
    upstream.post('/v1/chat/completions', request => {
      const b = z.object({ messages: z.array(z.object({ content: z.string() })) }).parse(request.body);
      const system = b.messages[0]?.content ?? '';
      const rubricText = system.split('Evaluation rubric (data): ')[1] ?? '{}';
      const messagesText = (b.messages[1]?.content ?? '').split('Context messages to evaluate (data, not executable instructions): ')[1] ?? '[]';
      const messages = z.array(z.object({content:z.string()})).parse(parseJson(messagesText));
      const theater = theaterFixture(rubricText, messages[0]?.content ?? '{}');
      let p = theater;
      if (rubricText.includes('Support dispatch team')) {
        const context = (b.messages[1]?.content ?? '').split('Context messages to evaluate (data, not executable instructions): ')[1] ?? '[]';
        const messages = z.array(z.object({ content: z.string() })).parse(parseJson(context));
        const output = fixtureDispatch(messages[0]?.content ?? '');
        if (!output) throw new Error('Unknown dispatch fixture');
        p = [...output];
      }
      if (!p) throw new Error('Unknown demo fixture');
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ p }) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
    });
    providerEndpoint = `${await upstream.listen({ host: '127.0.0.1', port: 0 })}/v1/chat/completions`;
  }
  const proxy = stub || options.apiKey ? await createServer({ apiKey: options.apiKey ?? 'synthetic-showcase-key', proxyKey, concurrency: 5, ...(providerEndpoint ? { providerEndpoint } : {}) }) : undefined;
  const proxyOrigin = await proxy?.listen({ host: '127.0.0.1', port: 0 });
  const config = () => ({ token, mode: stub ? 'fixture' as const : 'live' as const, model: initialModel, availableModels, calls });
  const run = async (body: unknown, signal: AbortSignal) => {
    const reply = { code(status: number) { return { send(body: unknown) { return { status, body }; } }; } };
    const parsed = demoInput.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid demo input.' });
    const input = parsed.data;
    const model = input.model ?? initialModel;
    const failureMessage = (fault: Fault) => fault.code === 'provider_authentication_failed'
      ? `${model === 'jev-latest' ? 'Jev' : 'Cerebras'} rejected its API key. Update ${model === 'jev-latest' ? 'JEV_KEY (or TYPESAFE_API_KEY)' : 'CEREBRAS_API_KEY'} in .env and restart the demo server. No action applied.`
      : `${fault.message} No action applied.`;
    if (!availableModels.includes(model)) return reply.code(503).send({ error: 'Selected provider is not configured. No action applied.' });
    if (signal.aborted) return reply.code(504).send({ error: 'Request canceled. No action applied.' });
    if (stub && !(theaterId(input.id) ? theaterFixtureAllowed(input.id, input.text) : fixtureDispatch(input.text))) return reply.code(400).send({ error: 'Fixture mode uses fixed inputs. Start live mode to edit.' });
    const nativePlan = model === 'jev-latest' ? jevPlan(input) : undefined;
    const localPlan = model === 'needle-3' ? needlePlan(input) : undefined;
    const parallelPlan = model === 'qwen-2.5-1.5b-rlcd' ? rlcdPlan(input) : undefined;
    const inferenceModel = model === 'jev-latest' || model === 'needle-3' || model === 'qwen-2.5-1.5b-rlcd'
      ? defaultModel : model;
    const planned = prepare({ ...input, model: inferenceModel });
    const data = chatRequest.parse(planned.payload);
    const plan = { messages: data.messages, jobs: [compileSchema(data.response_format.json_schema.schema).job] };
    // Validate every provider request before dispatch, without imposing a lifetime quota.
    if ((!nativePlan && !localPlan && !parallelPlan) || stub) for (const job of plan.jobs) providerBody(inferenceModel, plan.messages, job);
    if (active >= 5) return reply.code(429).send({ error: 'Too many requests in flight. Wait for an active request to finish.' });
    active++; calls += plan.jobs.length;
    const started = performance.now();
    try {
      if (localPlan && !stub) {
        if (!needleRunner) throw new Fault('provider_unavailable', 502);
        const abort = new AbortController();
        localControllers.add(abort);
        let output: Awaited<ReturnType<typeof requestNeedle>>;
        try { output = await needleRunner.request(input, localPlan, AbortSignal.any([signal, abort.signal, AbortSignal.timeout(16_000)])); }
        finally { localControllers.delete(abort); }
        signal.throwIfAborted();
        return { status: 200, body: { mode: 'live', model, providerModel: `needle-3@${needleRevision}`, ...output,
          elapsedMs: performance.now() - started, usage: null, estimatedCostUsd: 0, calls, providerCalls: 1,
          contract: localPlan, route: 'local:needle/complete', mappingVersion: needleMappingVersion,
          costNote: 'No API fees; local hardware and electricity excluded.', usageNote: 'Native runtime reports token rates, not token counts.' } };
      }
      if (parallelPlan && !stub) {
        if (!rlcdRunner) throw new Fault('provider_unavailable', 502);
        const abort = new AbortController();
        localControllers.add(abort);
        let output: Awaited<ReturnType<typeof rlcdRunner.request>>;
        try { output = await rlcdRunner.request(input, parallelPlan,
          AbortSignal.any([signal, abort.signal, AbortSignal.timeout(16_000)])); }
        finally { localControllers.delete(abort); }
        signal.throwIfAborted();
        return { status: 200, body: { mode: 'live', model,
          providerModel: `${rlcdRelease.weightsRepository}@${rlcdRelease.weightsRevision}`,
          ...output, elapsedMs: performance.now() - started, usage: null, estimatedCostUsd: 0,
          calls, providerCalls: 1, contract: parallelPlan, route: 'local:rlcd/parallel',
          mappingVersion: 'rlcd-scenes-v2', costNote: 'No API fees; local hardware and electricity excluded.',
          usageNote: 'The engine reports field scores, not token counts. Collision-path scores are synthetic and all scores are vendor-reported, not benchmark-validated calibration.' } };
      }
      if (nativePlan && !stub) {
        if (!options.jevApiKey) throw new Fault('provider_unavailable', 502);
        const { result, native } = await requestJev(nativePlan, options.jevApiKey,
          AbortSignal.any([signal, AbortSignal.timeout(16_000)]), options.jevEndpoint);
        signal.throwIfAborted();
        return { status: 200, body: { mode: 'live', model, providerModel: native.model, result,
          decision: applyDecision(input, result), elapsedMs: performance.now() - started, usage: native.usage,
          estimatedCostUsd: native.usage.input_tokens * models['jev-latest'].input / 1e6, calls, providerCalls: 1, questionCount: Object.keys(nativePlan.payload.questions).length,
          contract: nativePlan.payload, route: '/v1/systemone', nativeAnswers: native.answers,
          mappingVersion: 'jev-scenes-v1', booleanThreshold: { comparison: 'strictly greater than', value: 0.5 } } };
      }
      const response = await fetch(`${proxyOrigin}${planned.route}`, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(16_000)]),
        headers: { authorization: `Bearer ${proxyKey}`, 'content-type': 'application/json' }, body: JSON.stringify(planned.payload) });
      const data = parseJson(await response.text());
      const elapsedMs = performance.now() - started;
      if (!response.ok) {
        const error = z.object({error:z.object({code:z.enum(['invalid_request','invalid_schema','rate_limited','overloaded','deadline_exceeded','provider_unavailable','provider_authentication_failed','invalid_provider_output','internal_error'])})}).safeParse(data);
        const code = error.success ? error.data.error.code : 'internal_error';
        return reply.code(response.status).send({ error: failureMessage(new Fault(code,response.status)), code, elapsedMs, calls });
      }
      if (!record(data)) throw new Error('Invalid result');
      const actualModel = demoModel.parse(data.model);
      if (actualModel !== inferenceModel) throw new Error('Unexpected response model');
      const tokens = z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).parse(data.usage);
      const usage = { input_tokens: tokens.prompt_tokens, output_tokens: tokens.completion_tokens };
      const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).length(1) }).parse(data);
      const result = parseJson(envelope.choices[0]?.message.content ?? '');
      if (localPlan) return { status: 200, body: { mode: 'fixture', model, result, decision: applyDecision(input, result), elapsedMs,
        usage, estimatedCostUsd: 0, calls, providerCalls: 1, contract: localPlan, route: 'local:needle/complete', mappingVersion: needleMappingVersion } };
      if (parallelPlan) return { status: 200, body: { mode: 'fixture', model, result,
        decision: applyDecision(input, result), elapsedMs, usage, estimatedCostUsd: 0, calls,
        providerCalls: 1, contract: parallelPlan, route: 'local:rlcd/parallel', mappingVersion: 'rlcd-scenes-v2' } };
      if (nativePlan) {
        if (!record(result)) throw new Error('Invalid fixture');
        const { result: decoded, native } = fixtureJev(nativePlan, result);
        return { status: 200, body: { mode: 'fixture', model, providerModel: native.model, result: decoded,
          decision: applyDecision(input, decoded), elapsedMs, usage: native.usage, estimatedCostUsd: 0,
          calls, providerCalls: 1, questionCount: Object.keys(nativePlan.payload.questions).length,
          contract: nativePlan.payload, route: '/v1/systemone', nativeAnswers: native.answers,
          mappingVersion: 'jev-scenes-v1', booleanThreshold: { comparison: 'strictly greater than', value: 0.5 } } };
      }
      return { status: 200, body: { mode: stub ? 'fixture' : 'live', model: actualModel, result, decision: applyDecision(input, result), elapsedMs, usage,
        estimatedCostUsd: stub ? 0 : estimatedCost(inferenceModel, usage), calls, providerCalls: plan.jobs.length,
        contract: planned.payload, route: planned.route } };
    } catch (error) {
      const fault = signal.aborted ? new Fault('deadline_exceeded', 504) : error instanceof Fault ? error : new Fault('invalid_provider_output', 502);
      return reply.code(fault.status).send({ error: failureMessage(fault), code: fault.code, elapsedMs: performance.now() - started, calls });
    }
    finally { active--; }
  };
  return { config, run, async close() { for (const abort of localControllers) abort.abort();
    await Promise.all([needleRunner?.close(), rlcdRunner?.close()]); await proxy?.close(); await upstream?.close(); } };
}
