import { randomBytes } from 'node:crypto';
import { createServer } from '../src/http.js';
import { examples } from '../src/examples/fixtures.js';
import { parseJson, record } from '../src/json.js';
import { estimatedCost } from '../src/metrics.js';

// One fixed synthetic request, no retries. The 4096-token output cap keeps this
// small fixture below $0.02 at the dated Qwen list prices; no arbitrary inputs.
const apiKey = process.env.CEREBRAS_API_KEY;
if (!apiKey) throw new Error('CEREBRAS_API_KEY is required.');
const fixture = examples.find(example => example.id === 'E7');
if (!fixture) throw new Error('Missing demo fixture.');
const proxyKey = randomBytes(24).toString('hex');
const app = await createServer({ apiKey, proxyKey });
try {
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  console.log('LIVE Cerebras / qwen-3.8-27b / one request / no retries');
  console.log('POST /v1/chat/completions');
  console.log('Context: Please return the duplicate payment.');
  console.log('Contract: department enum + refund probability [0,1]');
  console.log('Request sent...');
  const started = performance.now();
  const response = await fetch(`${origin}${fixture.route}`, { method: 'POST',
    headers: { authorization: `Bearer ${proxyKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload) });
  const text = await response.text();
  const elapsedMs = performance.now() - started;
  if (response.status !== 200) {
    console.log(`HTTP ${response.status} / ${elapsedMs.toFixed(2)} ms / no result returned`);
    process.exitCode = 1;
  } else {
    const data = parseJson(text);
    if (!record(data) || !Array.isArray(data.choices) || !record(data.choices[0])
      || !record(data.choices[0].message) || typeof data.choices[0].message.content !== 'string'
      || !record(data.usage) || typeof data.usage.prompt_tokens !== 'number'
      || typeof data.usage.completion_tokens !== 'number') throw new Error('Unexpected response.');
    console.log(`HTTP 200 / ${elapsedMs.toFixed(2)} ms measured HTTP round trip`);
    console.log('Validated assistant content:');
    console.log(data.choices[0].message.content);
    console.log(`Tokens: ${data.usage.prompt_tokens} input / ${data.usage.completion_tokens} output`);
    const cost = estimatedCost('qwen-3.8-27b', { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens });
    console.log(`Estimated cost: $${cost.toFixed(8)} (dated list prices)`);
  }
} finally { await app.close(); }
