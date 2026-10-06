import Fastify, { LogController } from 'fastify';
import type { FastifyRequest } from 'fastify';
import bearerAuth from '@fastify/bearer-auth';
import { randomUUID } from 'node:crypto';
import { Fault, invalid } from './errors.js';
import { limits, parseJson, record } from './json.js';
import { answer, chatRequest, parseSystemOne, questionJob, resolveModel } from './contracts.js';
import type { Model } from './contracts.js';
import { compileSchema } from './schema.js';
import { Evaluator } from './evaluate.js';
import type { ProviderMetric } from './metrics.js';

export type ServerOptions = { apiKey: string; proxyKey: string; model?: Model;
  providerEndpoint?: string; deadlineMs?: number; concurrency?: number; queueLimit?: number;
  onMetric?: (metric: ProviderMetric) => void;
  logLevel?: 'silent' | 'error' | 'info' | 'debug' };
export async function createServer(options: ServerOptions) {
  if (!options.apiKey || options.proxyKey.length < 16 || options.apiKey === options.proxyKey) throw new Error('Distinct provider and proxy credentials are required; proxy key must have at least 16 characters.');
  const deadlineMs = options.deadlineMs ?? limits.deadlineMs;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new Error('Invalid deadline');
  const app = Fastify({ bodyLimit: limits.bodyBytes, requestTimeout: deadlineMs,
    connectionTimeout: deadlineMs + 1000, logController: new LogController({ disableRequestLogging: true }),
    logger: { level: options.logLevel ?? 'silent' }, genReqId: () => randomUUID() });
  const evaluator = new Evaluator({ apiKey: options.apiKey, ...(options.onMetric ? { onMetric: options.onMetric } : {}), ...(options.providerEndpoint ? { endpoint: options.providerEndpoint } : {}) },
    options.concurrency ?? limits.concurrency, options.queueLimit ?? limits.queue);
  const contexts = new WeakMap<FastifyRequest, { abort: AbortController; timer: NodeJS.Timeout; started: number; cleanup: () => void }>();
  const controllers = new Set<AbortController>();
  const isChat = (request: FastifyRequest) => request.url.split('?')[0] !== '/v1/systemone';
  app.setErrorHandler((error, request, reply) => {
    let fault = error instanceof Fault ? error : new Fault('internal_error', 500);
    if (record(error) && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') fault = new Fault('request_too_large', 413);
    if (record(error) && error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') fault = new Fault('unsupported_media_type', 415);
    if (record(error) && error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') fault = new Fault('invalid_json', 400);
    const chat = isChat(request);
    const status = chat && fault.status === 422 ? 400 : chat && fault.status === 529 ? 503 : fault.status;
    const type = status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error'
      : status >= 500 ? 'server_error' : 'invalid_request_error';
    reply.code(status).header('x-request-id', request.id).send({ error: chat
      ? { message: fault.message, type, param: null, code: fault.code }
      : { message: fault.message, code: fault.code, request_id: request.id } });
  });
  app.addHook('onRequest', async (request, reply) => {
    const abort = new AbortController();
    const close = () => { if (!reply.raw.writableFinished) contexts.get(request)?.cleanup(); };
    const aborted = () => abort.abort();
    reply.raw.on('close', close);
    request.raw.on('aborted', aborted);
    const timer = setTimeout(() => {
      abort.abort();
      if (!reply.sent && !reply.raw.destroyed) void reply.send(new Fault('deadline_exceeded', 504));
    }, deadlineMs);
    timer.unref();
    controllers.add(abort);
    contexts.set(request, { abort, timer, started: performance.now(), cleanup() {
      clearTimeout(timer); abort.abort(); controllers.delete(abort);
      reply.raw.off('close', close); request.raw.off('aborted', aborted);
    } });
    reply.header('x-request-id', request.id);
  });
  await app.register(bearerAuth, { keys: new Set([options.proxyKey]), addHook: false, verifyErrorLogLevel: 'silent' });
  app.addHook('onRequest', (request, reply, done) => {
    const verify = app.verifyBearerAuth;
    if (!verify) return done(new Fault('internal_error', 500));
    verify(request, reply, error => done(error ? new Fault('unauthorized', 401) : undefined));
  });
  app.addHook('onRequest', async (request) => {
    if (request.method === 'POST' && (request.headers['content-encoding'] !== undefined || !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))) throw new Fault('unsupported_media_type', 415);
  });
  app.addHook('onResponse', async (request, reply) => {
    const context = contexts.get(request);
    context?.cleanup();
    app.log.info({ requestId: request.id, status: reply.statusCode,
      durationMs: context ? performance.now() - context.started : 0 }, 'request completed');
  });
  app.addHook('preClose', async () => { for (const controller of controllers) controller.abort(); });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, text, done) => {
    try { if (typeof text !== 'string') throw new Fault('invalid_json', 400); done(null, parseJson(text)); }
    catch (error) { done(error instanceof Fault ? error : new Fault('invalid_json', 400)); }
  });
  const signal = (request: FastifyRequest) => {
    const context = contexts.get(request);
    if (!context || context.abort.signal.aborted) throw new Fault('deadline_exceeded', 504);
    return context.abort.signal;
  };
  const serialize = (value: unknown) => {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > limits.responseBytes) throw new Fault('internal_error', 500);
    return text;
  };
  app.post('/v1/systemone', async (request, reply) => {
    const input = parseSystemOne(request.body, options.model ?? 'qwen-3.8-27b');
    const result = await evaluator.evaluate(input.model, input.messages, input.questions.map(q => questionJob(q.question)), signal(request), request.id);
    signal(request);
    const answers = Object.fromEntries(input.questions.map(({ id, question }, index) => {
      const values = result.results[index]?.values;
      if (!values) throw new Fault('internal_error', 500);
      return [id, answer(question, values)];
    }));
    app.log.info({ requestId: request.id, model: input.model, calls: input.questions.length, usage: result.usage }, 'judgments validated');
    return reply.type('application/json').send(serialize({ model: input.model, answers, usage: result.usage }));
  });
  app.post('/v1/chat/completions', async (request, reply) => {
    const parsed = chatRequest.safeParse(request.body);
    if (!parsed.success || !parsed.data.messages.some(m => m.role === 'user')) return invalid();
    const input = parsed.data;
    const model = resolveModel(input.model, options.model ?? 'qwen-3.8-27b');
    const compiled = compileSchema(input.response_format.json_schema.schema, input.response_format.json_schema.description);
    const result = await evaluator.evaluate(model, input.messages, [compiled.job], signal(request), request.id);
    signal(request);
    const values = result.results[0]?.values;
    if (!values) throw new Fault('internal_error', 500);
    const content = JSON.stringify(compiled.decode(values));
    const response = { id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop', logprobs: null }],
      usage: { prompt_tokens: result.usage.input_tokens, completion_tokens: result.usage.output_tokens,
        total_tokens: result.usage.input_tokens + result.usage.output_tokens } };
    app.log.info({ requestId: request.id, model, calls: compiled.job.slots.length ? 1 : 0, usage: result.usage }, 'structured output validated');
    return reply.type('application/json').send(serialize(response));
  });
  app.setNotFoundHandler((_request, reply) => reply.send(new Fault('not_found', 404)));
  return app;
}
