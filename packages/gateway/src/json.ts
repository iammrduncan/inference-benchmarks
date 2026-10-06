import { parseTree } from 'jsonc-parser';
import type { Node, ParseError } from 'jsonc-parser';
import { Fault } from './errors.js';

export const limits = { bodyBytes: 262_144, responseBytes: 524_288, upstreamBytes: 262_144,
  depth: 32, questions: 32, deadlineMs: 15_000, concurrency: 4, queue: 32,
  maxPromptBytes: 48_000, completionTokens: 4096 };

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseJson(text: string): unknown {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!root || errors.length) throw new Fault('invalid_json', 400);
  function visit(node: Node, depth: number): void {
    if (depth > limits.depth) throw new Fault('request_too_large', 413);
    if (node.type === 'number' && !Number.isFinite(node.value)) throw new Fault('invalid_json', 400);
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key: unknown = property.children?.[0]?.value;
        const child = property.children?.[1];
        if (typeof key !== 'string' || !child || keys.has(key)) throw new Fault('invalid_json', 400);
        keys.add(key); visit(child, depth + 1);
      }
    } else if (node.type === 'array') for (const child of node.children ?? []) visit(child, depth + 1);
  }
  visit(root, 1);
  const value: unknown = JSON.parse(text);
  return value;
}
export async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Fault('invalid_provider_output', 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limits.upstreamBytes) throw new Fault('invalid_provider_output', 502);
      chunks.push(value);
    }
    signal.throwIfAborted();
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
