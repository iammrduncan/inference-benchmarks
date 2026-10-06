// USD per million tokens, provider price snapshot from 2026-09-16.
export const modelIds = ['qwen-3.8-27b', 'gpt-oss-120b'] as const;
export type Model = typeof modelIds[number];
export const models = {
  'qwen-3.8-27b': { label: 'Qwen 27B', input: 0.99, output: 1.49 },
  'gpt-oss-120b': { label: 'GPT OSS 120B', input: 0.35, output: 0.75 },
} as const satisfies Record<Model, { label: string; input: number; output: number }>;
