// HTTP clients for subjects. Ported from inference-engines/launcher/src/bench.ts
// (chat, parseProm) and extended to capture every exchange for raw.jsonl.
// Credentials are passed in headers and never captured.

export type Captured = {
  ok: boolean; status: number; latency_ms: number; ttft_ms?: number;
  request: { url: string; body: unknown };
  response?: unknown; error?: string;
  /** The request never got an HTTP response for a connection reason (refused, reset, DNS), not a timeout. */
  transport?: boolean;
  /** Earlier connection failures for this same request, in order, when it was retried (see postJsonReachable). */
  transport_failures?: string[];
};

const SECRET_HEADERS = new Set(['authorization', 'x-api-key', 'api-key']);

/** Headers safe to record: credential headers are dropped, never logged. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !SECRET_HEADERS.has(k.toLowerCase())));
}

/** POST JSON and capture the exchange. No retries: a failure is recorded as a failure. */
export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 600_000): Promise<Captured> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    const message = err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
    return { ok: false, status: 0, latency_ms: performance.now() - started, request: { url, body }, error: message, ...(timedOut ? {} : { transport: true }) };
  }
  const text = await res.text();
  const latency = performance.now() - started;
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return {
    ok: res.ok && json !== undefined, status: res.status, latency_ms: latency, request: { url, body },
    response: json ?? text.slice(0, 2000),
    ...(res.ok && json !== undefined ? {} : { error: json === undefined ? 'response is not JSON' : JSON.stringify((json as { error?: unknown }).error ?? json).slice(0, 500) }),
  };
}

/** Backoff before each retry of a request that never reached the server: about a minute in all. */
export const TRANSPORT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000];

/**
 * postJson, retried only while the request gets no HTTP response for a connection reason (the
 * server was unreachable, so the model never saw it). Any HTTP response, error or not, and any
 * timeout is final. Every failed attempt is kept on the result (transport_failures), so a retry is
 * never hidden. Used for engines the launcher started, reached over the network.
 */
export async function postJsonReachable(url: string, body: unknown, headers: Record<string, string>,
  backoffMs: readonly number[] = TRANSPORT_BACKOFF_MS, post: typeof postJson = postJson): Promise<Captured> {
  const failures: string[] = [];
  for (let attempt = 0; ; attempt++) {
    const c = await post(url, body, headers);
    const wait = backoffMs[attempt];
    if (!c.transport || wait === undefined) return failures.length ? { ...c, transport_failures: failures } : c;
    failures.push(c.error ?? 'no response');
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

export interface ChatResult {
  ok: boolean; status: number; latency_ms: number; ttft_ms?: number;
  content?: string; reasoning?: string; tool_calls?: { name: string; arguments: unknown }[]; finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string; system_fingerprint?: string;
  error?: string; raw?: unknown;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const parseArgs = (a: unknown) => { if (typeof a !== 'string') return a ?? {}; try { return JSON.parse(a || '{}'); } catch { return a; } };

/** OpenAI-compatible chat completion, streaming when asked and allowed. */
export async function chat(baseUrl: string, body: Record<string, unknown>, headers: Record<string, string> = {}, timeoutMs = 600_000): Promise<ChatResult> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 0, latency_ms: performance.now() - started, error: (e as Error).message };
  }
  const type = res.headers.get('content-type') ?? '';
  if (body.stream && type.includes('text/event-stream') && res.body) {
    let ttft: number | undefined;
    let content = '';
    let reasoning = '';
    let finish: string | undefined;
    let usage: ChatResult['usage'];
    let model: string | undefined;
    let fingerprint: string | undefined;
    const calls = new Map<number, { name: string; args: string }>();
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const ev = obj(JSON.parse(data));
        const choice = obj(arr(ev.choices)[0]);
        const delta = obj(choice.delta);
        if (ttft === undefined && (delta.content || delta.tool_calls || delta.reasoning_content)) ttft = performance.now() - started;
        content += str(delta.content) ?? '';
        reasoning += str(delta.reasoning_content) ?? '';
        for (const raw of arr(delta.tool_calls)) {
          const tc = obj(raw);
          const index = typeof tc.index === 'number' ? tc.index : 0;
          const cur = calls.get(index) ?? { name: '', args: '' };
          cur.name += str(obj(tc.function).name) ?? '';
          cur.args += str(obj(tc.function).arguments) ?? '';
          calls.set(index, cur);
        }
        finish = str(choice.finish_reason) ?? finish;
        model = str(ev.model) ?? model;
        fingerprint = str(ev.system_fingerprint) ?? fingerprint;
        if (ev.usage) usage = obj(ev.usage) as ChatResult['usage'];
      }
    }
    return {
      ok: res.ok, status: res.status, latency_ms: performance.now() - started, ...(ttft !== undefined ? { ttft_ms: ttft } : {}),
      content, ...(reasoning ? { reasoning } : {}), ...(finish ? { finish_reason: finish } : {}), ...(usage ? { usage } : {}),
      ...(model ? { model } : {}), ...(fingerprint ? { system_fingerprint: fingerprint } : {}),
      tool_calls: [...calls.values()].map((c) => ({ name: c.name, arguments: parseArgs(c.args) })),
    };
  }
  const text = await res.text();
  let json: Json;
  try { json = obj(JSON.parse(text)); } catch { json = { error: text.slice(0, 500) }; }
  const choice = obj(arr(json.choices)[0]);
  const msg = obj(choice.message);
  const content = str(msg.content);
  const reasoning = str(msg.reasoning_content);
  const finish = str(choice.finish_reason);
  const model = str(json.model);
  const fingerprint = str(json.system_fingerprint);
  return {
    ok: res.ok, status: res.status, latency_ms: performance.now() - started,
    ...(content !== undefined ? { content } : {}), ...(reasoning ? { reasoning } : {}), ...(finish ? { finish_reason: finish } : {}),
    ...(json.usage ? { usage: obj(json.usage) as NonNullable<ChatResult['usage']> } : {}), ...(model ? { model } : {}), ...(fingerprint ? { system_fingerprint: fingerprint } : {}),
    tool_calls: arr(msg.tool_calls).map((raw) => { const fn = obj(obj(raw).function); return { name: str(fn.name) ?? '', arguments: parseArgs(fn.arguments) }; }),
    ...(res.ok ? {} : { error: JSON.stringify(json.error ?? json).slice(0, 500) }), raw: json,
  };
}

/** Parse Prometheus text exposition into name{labels} -> value. */
export function parseProm(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+([-+0-9.eEinfNa]+)/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined) out[m[1]] = Number(m[2]);
  }
  return out;
}
