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
