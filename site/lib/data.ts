// Read-only access to the generated manifest, for pages.
import raw from './manifest.generated.json';
import type { Manifest, Run, Subject, Suite } from './types.ts';

export const manifest = raw as unknown as Manifest;

const runs = new Map(manifest.runs.map((r) => [r.id, r]));
const subjects = new Map(manifest.subjects.map((s) => [s.key, s]));
const suites = new Map(manifest.suites.map((s) => [s.name, s]));

export function run(id: string): Run {
  const r = runs.get(id);
  if (!r) throw new Error(`unknown run ${id}`);
  return r;
}
export function subject(key: string): Subject {
  const s = subjects.get(key);
  if (!s) throw new Error(`unknown subject ${key}`);
  return s;
}
export const suite = (name: string): Suite | undefined => suites.get(name);
export const findRun = (id: string) => runs.get(id);
export const findSubject = (key: string) => subjects.get(key);

export const subjectHref = (key: string) => `/subjects/${key}/`;
export const runHref = (id: string) => `/runs/${id}/`;
export const suiteHref = (name: string) => `/suites/${name}/`;
export const modelHref = (model: string) => `/models/${model}/`;

/** The quality key's parts, for compact display. */
export function keyParts(key: string): { model: string; checkpoint: string; quant: string; engine: string } {
  const [model = key, checkpoint = '', quant = '', ...engine] = key.split('/');
  return { model, checkpoint, quant, engine: engine.join('/') };
}

/** Display names for the overall tables: model on top, the varying parts of the key below. */
export function subjectLabels(): Record<string, { model: string; variant: string; badges: string[] }> {
  return Object.fromEntries(manifest.subjects.map((s) => {
    const p = keyParts(s.key);
    const badges = [s.engine_visibility === 'private' ? 'private engine' : null, s.label === 'provider-opaque' ? 'provider-opaque' : null].filter((x): x is string => x !== null);
    return [s.key, { model: p.model, variant: `${p.quant} · ${p.engine}`, badges }];
  }));
}

/** Per model-type group: its suites with results, linking to their detail boards. */
export function groupSuites(): Record<string, { name: string; href: string; boards: number }[]> {
  const out: Record<string, { name: string; href: string; boards: number }[]> = {};
  for (const s of manifest.suites) {
    const g = manifest.suite_groups[s.name];
    const boards = manifest.boards.filter((b) => b.suite === s.name).length;
    if (!g || boards === 0) continue;
    (out[g] ??= []).push({ name: s.name, href: suiteHref(s.name), boards });
  }
  return out;
}
