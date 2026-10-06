import { z } from 'zod';
import { modelIds, models as cerebrasModels } from '@decision/gateway/models';
// Jev price supplied by the account owner on 2026-09-17: $0.04/M input, free output.
export const models = { ...cerebrasModels, 'jev-latest': { label: 'Jev · TypeSafe', input: 0.04, output: 0 },
  'needle-3': { label: 'Needle 3 · Local', input: 0, output: 0 },
  'qwen-2.5-1.5b-rlcd': { label: 'Qwen 2.5 1.5B · RLCD Local', input: 0, output: 0 } };

export const demoModel = z.enum([...modelIds, 'jev-latest', 'needle-3', 'qwen-2.5-1.5b-rlcd']);
export type DemoModel = z.infer<typeof demoModel>;
export const defaultModel = 'qwen-3.8-27b' satisfies DemoModel;
export function providerName(model: DemoModel) {
  return model === 'needle-3' ? 'CACTUS / LOCAL'
    : model === 'qwen-2.5-1.5b-rlcd' ? 'RLCD / LOCAL'
    : model === 'jev-latest' ? 'TYPESAFE' : 'CEREBRAS';
}
export function priceLabel(model: DemoModel) {
  return model === 'needle-3' || model === 'qwen-2.5-1.5b-rlcd'
    ? '$0 API fees · local compute excluded'
    : `$${models[model].input} input / $${models[model].output} output · per 1M tokens`;
}
