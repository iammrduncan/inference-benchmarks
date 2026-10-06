import { Fault } from './errors.js';
import { limits } from './json.js';
import { infer, providerBody } from './cerebras.js';
import type { ProviderConfig } from './cerebras.js';
import type { Job, Message, Model, Usage } from './contracts.js';

type Task = { execute: () => Promise<void>; cancel: () => void };
export class Evaluator {
  private active = 0;
  private queue: Task[] = [];
  constructor(private config: ProviderConfig, private concurrency = limits.concurrency, private queueLimit = limits.queue) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(queueLimit) || queueLimit < 0) throw new Error('Invalid work limits');
  }
  get pending() { return this.queue.length; }
  get running() { return this.active; }
  private drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (!task) break;
      this.active++;
      void task.execute().finally(() => { this.active--; this.drain(); });
    }
  }
  async evaluate(model: Model, messages: Message[], jobs: Job[], signal: AbortSignal, requestId?: string) {
    // Preflight every job before admission, so late validation cannot spend early tokens.
    jobs.forEach(job => providerBody(model, messages, job));
    if (signal.aborted) throw new Fault('deadline_exceeded', 504);
    if (this.active + this.queue.length + jobs.length > this.concurrency + this.queueLimit) throw new Fault('overloaded', 529);
    const siblings = new AbortController();
    const combined = AbortSignal.any([signal, siblings.signal]);
    const promises = jobs.map(job => new Promise<{ values: number[]; usage: Usage }>((resolve, reject) => {
      const queuedAt = performance.now();
      const onAbort = () => {
        const index = this.queue.indexOf(task);
        if (index !== -1) { this.queue.splice(index, 1); task.cancel(); }
      };
      const task: Task = {
        cancel: () => { combined.removeEventListener('abort', onAbort); reject(new Fault('deadline_exceeded', 504)); },
        execute: async () => {
          combined.removeEventListener('abort', onAbort);
          try { resolve(await infer({ ...this.config, onMetric: metric => this.config.onMetric?.({ ...metric, ...(requestId ? { requestId } : {}) }) }, model, messages, job, combined, performance.now() - queuedAt)); }
          catch (error) { reject(error); siblings.abort(); }
        },
      };
      combined.addEventListener('abort', onAbort, { once: true });
      this.queue.push(task);
    }));
    this.drain();
    try {
      const results = await Promise.all(promises);
      const usage = results.reduce((sum, result) => ({ input_tokens: sum.input_tokens + result.usage.input_tokens,
        output_tokens: sum.output_tokens + result.usage.output_tokens }), { input_tokens: 0, output_tokens: 0 });
      if (!Number.isSafeInteger(usage.input_tokens + usage.output_tokens)) throw new Fault('invalid_provider_output', 502);
      return { results, usage };
    } catch (error) { siblings.abort(); throw error; }
  }
}
