// Test helpers: a tiny HTTP server that plays a subject. Offline; no provider keys.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type Handler = (path: string, body: unknown, req: IncomingMessage, res: ServerResponse) => void;

export async function fakeServer(handler: Handler): Promise<{ url: string; requests: { path: string; body: unknown; headers: IncomingMessage['headers'] }[]; close: () => Promise<void> }> {
  const requests: { path: string; body: unknown; headers: IncomingMessage['headers'] }[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => {
      const body: unknown = data ? JSON.parse(data) : undefined;
      requests.push({ path: req.url ?? '', body, headers: req.headers });
      handler(req.url ?? '', body, req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

type Q = { type: string; criteria?: unknown };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A well-behaved decision answer for every question: deterministic, valid distributions. */
export function answerAll(body: unknown): unknown {
  const questions = rec(rec(body).questions) as Record<string, Q>;
  const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    if (q.type === 'noul') return [id, { type: 'noul', noul: 0.8 }];
    const keys = q.type === 'choice' ? Object.keys(rec(q.criteria)).sort() : (Array.isArray(q.criteria) ? q.criteria : []).map((_, i) => String(i));
    const probs = Object.fromEntries(keys.map((k, i) => [k, i === keys.length - 1 ? 0.7 : 0.3 / (keys.length - 1)]));
    if (q.type === 'choice') return [id, { type: 'choice', choice: keys[keys.length - 1], probabilities: probs, confidence: 0.5 }];
    const score = keys.reduce((s, k, i) => s + i * (probs[k] ?? 0), 0);
    return [id, { type: 'score', score, legend: {}, probabilities: probs, confidence: 0.5 }];
  }));
  return { model: 'fake-decider-1', answers, usage: { input_tokens: 100, output_tokens: 10 } };
}
