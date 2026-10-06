import { z } from 'zod';
import { createServer } from './http.js';

const configuration = z.object({
  CEREBRAS_API_KEY: z.string().min(1), PROXY_API_KEY: z.string().min(16),
  CEREBRAS_MODEL: z.enum(['qwen-3.8-27b', 'gpt-oss-120b']).default('qwen-3.8-27b'),
  HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['silent', 'error', 'info', 'debug']).default('info'),
}).safeParse(process.env);
if (!configuration.success) {
  console.error('Invalid configuration. Set CEREBRAS_API_KEY and a distinct PROXY_API_KEY (at least 16 characters); check HOST, PORT, CEREBRAS_MODEL, and LOG_LEVEL.');
  process.exitCode = 1;
} else {
  const env = configuration.data;
  try {
    const server = await createServer({ apiKey: env.CEREBRAS_API_KEY, proxyKey: env.PROXY_API_KEY,
      model: env.CEREBRAS_MODEL, logLevel: env.LOG_LEVEL });
    await server.listen({ host: env.HOST, port: env.PORT });
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { void server.close(); });
  } catch {
    console.error('Unable to start proxy. Check configuration and listening address.');
    process.exitCode = 1;
  }
}
