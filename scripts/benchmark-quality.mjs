import assert from 'node:assert/strict';
import { fixtureValues } from '../apps/theater/lib/theater/data.ts';
import { fixtureDispatch, teams, priorities, actions } from '../apps/theater/lib/traffic.ts';
import { homeCases, homeDecision, applyHome, initialHome } from '../apps/theater/lib/theater/home.ts';

export function quality(run) {
  const accepted = run.events.filter(e => e.data);
  const mismatches = [];
  let state = { ...initialHome };
  for (const event of accepted) {
    const decision = event.data.decision;
    const index = Number(event.item.id.split('-').at(-1)) - 1;
    let expected;
    if (run.scene === 'dispatch') {
      const values = fixtureDispatch(JSON.stringify(event.item.context));
      assert.ok(values, 'Unknown ticket fixture');
      expected = { team: teams[values[0]], priority: priorities[values[1]], action: actions[values[2]], escalate: Boolean(values[3]) };
    } else if (run.scene === 'screen' || run.scene === 'approve') {
      expected = { decision: fixtureValues(run.scene, index)[0] ? 'block' : 'allow' };
    } else if (run.scene === 'judge') {
      const values = fixtureValues('judge', index);
      expected = { accuracy: values[0], valid: Boolean(values[1]) };
    } else if (run.scene === 'home') {
      assert.deepEqual(event.item.context.state, state, 'Home state continuity');
      expected = homeCases.find(c => c.command === event.item.context.command)?.expected;
      assert.ok(expected, 'Unknown home command');
      state = applyHome(state, homeDecision.parse(decision));
    }
    if (expected && Object.entries(expected).some(([key, value]) => decision[key] !== value)) {
      mismatches.push({ id: event.item.id, expected, actual: decision });
    }
  }
  if (run.scene === 'drive') return { car: run.car };
  if (run.scene === 'navigate') {
    const last = accepted.at(-1);
    return { reachedTarget: last?.data.decision.next === last?.item.context.target,
      hops: accepted.length, path: [run.events[0].item.context.position, ...accepted.map(e => e.data.decision.next)] };
  }
  return { exactFixtureMatches: accepted.length - mismatches.length, evaluated: accepted.length,
    mismatches, ...(run.scene === 'judge' ? { displayThreshold: 90,
      aboveThreshold: accepted.filter(e => e.data.decision.accuracy > 90).length } : {}) };
}
