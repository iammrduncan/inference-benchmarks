// Subjects the runner can talk to. Keys come only from the environment (op run);
// they are sent as headers and never captured. No retries, no fallbacks.
import { randomBytes } from 'node:crypto';
import { createServer } from '@decision/gateway/http';
import { models as gatewayPrices, modelIds as gatewayModels, type Model as GatewayModel } from '@decision/gateway/models';
import { models as decisionPrices } from '@decision/decisions/models';
import { chat, postJson, postJsonReachable, type Captured, type ChatResult } from './client.ts';
import type { Usage } from './suite.ts';

/** USD per million tokens. Sources: the gateway's Cerebras snapshot and the decisions package's Jev price. */
export type Price = { input: number; output: number; source: string };

export function priceFor(provider: string, model: string): Price | undefined {
  if (provider === 'cerebras' && (gatewayModels as readonly string[]).includes(model)) {
    const p = gatewayPrices[model as GatewayModel];
    return { input: p.input, output: p.output, source: 'packages/gateway/src/models.ts (Cerebras, 2026-09-16)' };
  }
  if (provider === 'typesafe' && model === 'jev-latest') {
    const p = decisionPrices['jev-latest'];
    return { input: p.input, output: p.output, source: 'packages/decisions/src/models.ts (TypeSafe, 2026-09-17)' };
  }
  return undefined;
}

export const cost = (usage: Usage | undefined, price: Price | undefined) =>
  usage && price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1e6 : 0;

export interface DecisionProvider {
  /** What appears in run.json: endpoint and mode, never credentials. */
  describe: { endpoint: string; mode: string; model: string };
  call(body: Record<string, unknown>): Promise<Captured>;
  close(): Promise<void>;
}

function key(...names: string[]): string {
  for (const n of names) { const v = process.env[n]; if (v) return v; }
  throw new Error(`missing ${names.join(' or ')}; run under \`op run --env-file=benchmarks.env.op --\``);
}

/** TypeSafe's native decision API. */
export function typesafe(model: string, endpoint = 'https://api.typesafe.ai/v1/systemone'): DecisionProvider {
  const auth = { authorization: `Bearer ${key('JEV_KEY', 'TYPESAFE_API_KEY')}` };
  return {
    describe: { endpoint, mode: 'native', model },
    call: (body) => postJson(endpoint, { ...body, model }, auth),
    close: async () => {},
  };
}

/** Any endpoint that speaks the decision protocol (self-declared identity). */
export function decisionEndpoint(url: string, model: string, keyEnv?: string): DecisionProvider {
  const auth: Record<string, string> = keyEnv ? { authorization: `Bearer ${key(keyEnv)}` } : {};
  const endpoint = url.endsWith('/v1/systemone') ? url : `${url.replace(/\/$/, '')}/v1/systemone`;
  return { describe: { endpoint, mode: 'native', model }, call: (body) => postJsonReachable(endpoint, { ...body, model }, auth), close: async () => {} };
}

/**
 * A chat model behind packages/gateway in its json-schema mode: the gateway receives the
 * whole case and asks the model for one strict-schema distribution per question.
 * It runs in-process on a loopback port with a random per-run proxy key.
 */
export async function gatewayJsonSchema(model: string): Promise<DecisionProvider> {
  if (!(gatewayModels as readonly string[]).includes(model)) throw new Error(`the gateway serves ${gatewayModels.join(', ')}, not ${model}`);
  const proxyKey = randomBytes(24).toString('hex');
  const app = await createServer({ apiKey: key('CEREBRAS_API_KEY'), proxyKey, model: model as GatewayModel, logLevel: 'silent' });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const endpoint = `${address}/v1/systemone`;
  return {
    describe: { endpoint: 'in-process packages/gateway -> https://api.cerebras.ai', mode: 'gateway:json-schema', model },
    call: (body) => postJson(endpoint, { ...body, model }, { authorization: `Bearer ${proxyKey}` }),
    close: async () => { await app.close(); },
  };
}

/** OpenAI-compatible chat (vLLM, llama.cpp, SGLang, Cerebras, OpenRouter). */
export function openaiChat(baseUrl: string, keyEnv?: string) {
  const headers: Record<string, string> = keyEnv ? { authorization: `Bearer ${key(keyEnv)}` } : {};
  return (body: Record<string, unknown>): Promise<ChatResult> => chat(baseUrl.replace(/\/v1\/?$/, ''), body, headers);
}

/** Anthropic Messages API. */
export function anthropicMessages(endpoint = 'https://api.anthropic.com/v1/messages') {
  const headers = { 'x-api-key': key('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' };
  return (body: Record<string, unknown>): Promise<Captured> => postJson(endpoint, body, headers);
}
