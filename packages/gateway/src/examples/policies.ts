import { z } from 'zod';
const bounded = z.number().finite().min(0).max(1);
const choice = z.object({ type: z.literal('choice'), choice: z.string(), confidence: bounded });
const noul = z.object({ type: z.literal('noul'), noul: bounded });
const score = z.object({ type: z.literal('score'), score: z.number().finite() });
const answers = z.object({ answers: z.record(z.string(), z.unknown()) });

// Caller policies are deliberately separate from the HTTP response. No provider
// text is executed; these functions only select local, synthetic demo behavior.
export function decide(id: string, data: unknown): unknown {
  if (id === 'E4') {
    const value = z.object({ action: z.enum(['list', 'summarize', 'chart']), series: z.enum(['A', 'B']), window: z.enum(['day', 'week']), volume: z.boolean() }).parse(data);
    const samples = value.series === 'A' ? [10, 12, 11, 13] : [20, 18, 21, 22];
    if (value.action === 'list') return { action: 'list', available: ['A', 'B'] };
    if (value.action === 'summarize') return { action: 'summarize', mean: samples.reduce((a, b) => a + b, 0) / samples.length };
    return { action: 'chart_preview', series: value.series, window: value.window, volume: value.volume, samples };
  }
  if (id === 'E7') return z.object({ department: z.enum(['billing', 'technical', 'other']), refund_requested: bounded }).parse(data);
  const parsed = answers.parse(data).answers;
  if (id === 'E1') {
    const route = choice.parse(parsed.department);
    const refund = noul.parse(parsed.refund_requested);
    if (!['billing', 'other', 'technical'].includes(route.choice)) throw new Error('Unknown route');
    return { action: route.confidence >= 0.8 ? 'route_to_team' : 'human_review', team: route.choice, refundReview: refund.noul >= 0.7 };
  }
  if (id === 'E2') {
    const compound = noul.parse(parsed.compound);
    if (compound.noul >= 0.5) return { action: 'decomposition_stub' };
    const intent = choice.parse(parsed.intent);
    if (intent.confidence < 0.8) return { action: 'clarify' };
    if (intent.choice === 'conversation') return { action: 'conversation_stub' };
    const scope = choice.parse(parsed.scope), device = choice.parse(parsed.device), action = choice.parse(parsed.action);
    if (intent.choice !== 'command' || device.choice !== 'lights' || !['all', 'kitchen'].includes(scope.choice)
      || !['on', 'off'].includes(action.choice) || [scope, device, action].some(v => v.confidence < 0.8)) return { action: 'clarify' };
    return { action: 'simulated_lights', kitchen: action.choice, hall: scope.choice === 'all' ? action.choice : 'unchanged' };
  }
  if (id === 'E3') {
    const checks = Array.from({ length: 8 }, (_, i) => noul.parse(parsed[`check_${i}`]).noul);
    return { statementsSupported: checks.filter(p => p >= 0.7).length, totalStatements: 8, review: checks.some(p => p > 0.3 && p < 0.7) };
  }
  if (id === 'E5') {
    const hazards = ['override', 'secret_request', 'format_attack', 'forced_values'].map(k => noul.parse(parsed[k]).noul);
    const severity = score.parse(parsed.severity).score;
    if (severity < 0 || severity > 2) throw new Error('Invalid severity');
    return { action: hazards.some(p => p >= 0.7) || severity >= 1.5 ? 'block' : hazards.some(p => p >= 0.35) ? 'review' : 'pass' };
  }
  if (id === 'E6') return { customer: choice.parse(parsed.customer).choice, invoiceMatches: noul.parse(parsed.invoice_matches).noul >= 0.7, terms: score.parse(parsed.terms).score };
  throw new Error('Unknown example');
}
