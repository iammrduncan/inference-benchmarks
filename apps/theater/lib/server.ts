import 'server-only';
import { createDemoRuntime } from './runtime';
// Cache across Next dev reloads to reuse the provider runtime and connection pool.
const globalState = globalThis as typeof globalThis & { decisionRuntime?: ReturnType<typeof createDemoRuntime> };
export function getRuntime() {
  const jevApiKey = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
  globalState.decisionRuntime ??= createDemoRuntime({ stub: process.env.DEMO_MODE !== 'live',
    ...(process.env.NEEDLE_BINARY && process.env.NEEDLE_WEIGHTS ? { needle: { executable: process.env.NEEDLE_BINARY, weights: process.env.NEEDLE_WEIGHTS } } : {}),
    ...(process.env.RLCD_PYTHON && process.env.RLCD_WORKER && process.env.RLCD_SOURCE && process.env.RLCD_WEIGHTS
      ? { rlcd: { python: process.env.RLCD_PYTHON, worker: process.env.RLCD_WORKER,
        source: process.env.RLCD_SOURCE, weights: process.env.RLCD_WEIGHTS } } : {}),
    ...(jevApiKey ? { jevApiKey } : {}),
    ...(process.env.CEREBRAS_API_KEY ? { apiKey: process.env.CEREBRAS_API_KEY } : {}) }).catch(error => {
      delete globalState.decisionRuntime;
      throw error;
    });
  return globalState.decisionRuntime;
}
