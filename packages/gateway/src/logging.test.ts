import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Capture the actual logger in a separate process, avoiding global stdout patches.
test('default logs exclude credentials, caller content and upstream error bodies', async () => {
  const script = `
    import Fastify from 'fastify';
    import { createServer } from './src/http.ts';
    const upstream = Fastify({ logger: false });
    let fail = false;
    upstream.post('/v1/chat/completions', async (_, reply) => fail
      ? reply.code(500).send({ error: 'CANARY_PROVIDER_ERROR' })
      : { choices: [{ finish_reason: 'stop', message: { content: '{"p":[0.9]}', reasoning: 'CANARY_REASONING' } }], usage: { prompt_tokens: 5, completion_tokens: 9 } });
    const endpoint = await upstream.listen({ host: '127.0.0.1', port: 0 });
    const app = await createServer({ apiKey: 'CANARY_PROVIDER_KEY', proxyKey: 'CANARY_PROXY_KEY_123456',
      providerEndpoint: endpoint + '/v1/chat/completions', logLevel: 'info' });
    const request = { method: 'POST', url: '/v1/systemone',
      headers: { authorization: 'Bearer CANARY_PROXY_KEY_123456', 'x-request-id': 'CANARY_CLIENT_ID' },
      payload: { model: 'jev-latest', state: 'CANARY_PRIVATE_STATE', questions: {
        CANARY_QUESTION_ID: { type: 'noul', instructions: 'CANARY_RUBRIC' }
      } } };
    try {
      if ((await app.inject(request)).statusCode !== 200) throw new Error('Success fixture failed');
      fail = true;
      if ((await app.inject(request)).statusCode !== 502) throw new Error('Failure fixture failed');
      if ((await app.inject({ ...request, headers: { authorization: 'Bearer CANARY_BAD_KEY' } })).statusCode !== 401) throw new Error('Auth fixture failed');
    } finally { await app.close(); await upstream.close(); }
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 10_000 });
  assert.ok(stdout.includes('request completed'));
  assert.ok(stdout.includes('judgments validated'));
  assert.ok(!stdout.includes('CANARY_'));
  assert.ok(!stderr.includes('CANARY_'));
});
