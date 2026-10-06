// What a suite provides to the runner: pinned items to send, and a pure summary of
// the captured rows. Suites never call a subject themselves; the runner does.

export type Protocol = 'decision';
export type Tier = 'quick' | 'core';

export type SuiteItem = {
  id: string;
  /** Request body without `model`; the runner adds the subject's model id. */
  body: Record<string, unknown>;
  /** What the scorer needs (gold answers, probe metadata). Stored in raw.jsonl so summaries are offline. */
  expected?: unknown;
};

export type Usage = { input_tokens: number; output_tokens: number };

export type RawRow = {
  index: number; item_id: string; ok: boolean; status: number; latency_ms: number;
  request: { url: string; body: unknown };
  response?: unknown; error?: string;
  usage?: Usage; cost_usd: number; model?: string;
  expected?: unknown;
};

export interface SuiteModule {
  name: string;
  protocol: Protocol;
  scorer: { name: string; version: string };
  /** Repo-relative files whose content defines the suite (hashed into the suite version). */
  sourceFiles: string[];
  items(root: string, tier: Tier): Promise<SuiteItem[]>;
  summarize(rows: RawRow[]): Record<string, unknown>;
}
