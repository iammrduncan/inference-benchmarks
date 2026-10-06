import { parseJson } from '@decision/gateway/json';
export function localRequest(request: Request, mutation = false, configuredHost = process.env.DEMO_HOST ?? '127.0.0.1', hostname = process.env.DEMO_HOSTNAME) {
  const host = request.headers.get('host') ?? '';
  const secureAlias = Boolean(hostname) && (host === hostname || host === `${hostname}:443`);
  return (secureAlias || /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || host === `${configuredHost}:3001` || (Boolean(hostname) && host === `${hostname}:3001`))
    && (!mutation || (request.headers.get('origin') === `${secureAlias ? 'https' : 'http'}://${host}`
      && request.headers.get('content-type')?.split(';')[0] === 'application/json'));
}
export async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 16_384) throw new Error('Body too large');
      parts.push(value);
    }
    return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
