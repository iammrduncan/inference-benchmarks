// Subject identity: model x checkpoint x quant x engine. The runner resolves every
// field; nobody types a subject key by hand. See docs/organize/subjects-and-results.md.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export type Visibility = 'public' | 'private';
export type Target = 'cloud' | 'endpoint' | 'recipe' | 'hf';

export interface Identity {
  model: string;
  checkpoint: { hf?: string; revision?: string; provider?: string; model_id?: string; month?: string; adapter?: { hf: string; revision: string } };
  quant: { format: string; scheme?: string; producer?: string; repo?: string; revision?: string; sha256?: string };
  engine: { name: string; version: string; flags?: Record<string, string | number | boolean> };
}

export interface Subject extends Identity {
  key: string;
  target: Target;
  engine_visibility: Visibility;
  /** false when the identity is self-declared (bare endpoints) and cannot be checked. */
  verified_identity: boolean;
  label: string | null;
}

/** Folder- and URL-safe slug: lowercase, [a-z0-9._-]. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

const short = (rev: string | undefined) => (rev && /^[0-9a-f]{7,}$/.test(rev) ? rev.slice(0, 7) : slug(rev ?? 'unknown'));

/** The quality key: <model>/<checkpoint>/<quant>/<engine>. Hardware is added only for speed. */
export function subjectKey(id: Identity): string {
  const c = id.checkpoint;
  const checkpoint = c.provider ? `${slug(c.provider)}-${c.month ?? 'unknown'}` : `hf-${short(c.revision)}`;
  const quant = [id.quant.format, id.quant.scheme, id.quant.producer].filter((x): x is string => Boolean(x)).map(slug).join('-');
  const engine = `${slug(id.engine.name)}${id.engine.version && id.engine.version !== id.engine.name ? '-' + short(id.engine.version) : ''}`;
  return [slug(id.model), checkpoint, quant || 'unknown', engine].join('/');
}

/** UTC month of a date, YYYY-MM: providers change what serves a model id, so months are distinct subjects. */
export function month(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** A hosted model: checkpoint and quant are provider-opaque. */
export function cloudSubject(provider: string, modelId: string, at = new Date()): Subject {
  const id: Identity = {
    model: modelId,
    checkpoint: { provider, model_id: modelId, month: month(at) },
    quant: { format: 'opaque' },
    engine: { name: provider, version: provider },
  };
  return { ...id, key: subjectKey(id), target: 'cloud', engine_visibility: 'public', verified_identity: true, label: 'provider-opaque' };
}

/** A self-declared endpoint identity (from --identity). Never a reference subject. */
export function endpointSubject(id: Identity, visibility: Visibility = 'public'): Subject {
  return {
    ...id, key: subjectKey(id), target: 'endpoint', engine_visibility: visibility, verified_identity: false,
    label: visibility === 'private' ? 'private engine, not reproducible' : 'unverified identity',
  };
}

/** Resolve a Hugging Face revision (branch, tag or short sha) to its full commit. */
export async function resolveHubRevision(repo: string, revision = 'main', kind: 'models' | 'datasets' = 'models'): Promise<string> {
  const headers: Record<string, string> = process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
  const res = await fetch(`https://huggingface.co/api/${kind}/${repo}/revision/${encodeURIComponent(revision)}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`cannot resolve ${kind}/${repo}@${revision}: HTTP ${res.status}`);
  const sha = ((await res.json()) as { sha?: unknown }).sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no commit for ${kind}/${repo}@${revision}`);
  return sha;
}

/** SHA-256 of a file, streamed. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (b) => h.update(b)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}
