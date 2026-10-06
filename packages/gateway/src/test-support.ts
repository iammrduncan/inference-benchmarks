import Fastify from 'fastify';
import { createServer } from './http.js';
import type { ServerOptions } from './http.js';

export const proxyKey = 'synthetic-proxy-key-for-tests';
export const headers = { authorization: `Bearer ${proxyKey}`, 'content-type': 'application/json' };
export const noulRequest = { model: 'jev-latest', state: 'Please refund the duplicate charge.',
  questions: { refund: { type: 'noul', instructions: 'Does the customer request a refund?' } } };
export function completion(content = '{"p":[0.9]}') {
  return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 100, completion_tokens: 10 } };
}
export const chatBody = (schema: unknown = { type: 'object', properties: { route: { type: 'string', enum: ['billing', 'other'] } },
  required: ['route'], additionalProperties: false }) => ({ model: 'qwen-3.8-27b',
    messages: [{ role: 'user', content: 'Please refund the duplicate charge.' }],
    response_format: { type: 'json_schema', json_schema: { name: 'judgment', strict: true, schema } } });
export async function harness(respond: (body: unknown) => unknown | Promise<unknown> = () => completion(), overrides: Partial<ServerOptions> = {}) {
  const received: unknown[] = [];
  const upstream = Fastify({ logger: false });
  upstream.post('/v1/chat/completions', async (request, reply) => {
    received.push(request.body);
    const result = await respond(request.body);
    if (typeof result === 'number') return reply.code(result).send({ error: { message: 'SECRET_UPSTREAM_ERROR' } });
    return reply.send(result);
  });
  const origin = await upstream.listen({ host: '127.0.0.1', port: 0 });
  const app = await createServer({ apiKey: 'synthetic-provider-key', proxyKey,
    providerEndpoint: `${origin}/v1/chat/completions`, ...overrides });
  await app.ready();
  return { app, received, async close() { await app.close(); await upstream.close(); } };
}
