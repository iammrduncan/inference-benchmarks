import { scenes, workItem, type SceneId, type WorkItem } from './data';

// Shuffle before dispatch, not after receiving results. Exported events retain
// this exact order and every input, so an observed run can be inspected/replayed.
export function shuffledWorkload(scene: SceneId, random: () => number = Math.random): WorkItem[] {
  const items = Array.from({ length: scenes.find(s => s.id === scene)?.count ?? 0 }, (_, i) => workItem(scene, i));
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = items[i], b = items[j];
    if (!a || !b) throw new Error('Invalid shuffle index');
    items[i] = b; items[j] = a;
  }
  return items;
}

type MeasuredRequest = { data?: { usage: { input_tokens: number; output_tokens: number } | null; estimatedCostUsd: number | null } };
export function requestTotals(events: readonly MeasuredRequest[]) {
  let input = 0, output = 0, cost = 0, measuredRequests = 0, pricedRequests = 0, unmeasuredRequests = 0;
  for (const { data } of events) {
    if (!data) continue;
    if (data.usage) { input += data.usage.input_tokens; output += data.usage.output_tokens; measuredRequests++; }
    else unmeasuredRequests++;
    if (data.estimatedCostUsd !== null) { cost += data.estimatedCostUsd; pricedRequests++; }
  }
  return { input, output, cost, measuredRequests, unmeasuredRequests, pricedRequests,
    unpricedRequests: measuredRequests + unmeasuredRequests - pricedRequests, averageCostUsd: pricedRequests ? cost / pricedRequests : null };
}
