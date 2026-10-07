// The recipe target: bench never starts engines itself. It drives the inference-engines
// launcher through its JSON interface (describe / up --detach --json / down --json).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { subjectKey, type Identity, type Subject } from './identity.ts';
import { REPO_ROOT } from './record.ts';

/** `source` is a mirror of the pinned commit (a path the target host can clone); the launcher still records the pin. */
export type RecipeTarget = { recipe: string; profile?: string; params?: string[]; on?: string; inventory?: string; source?: string };

export type UpResult = {
  id: string; run_id: string; run_dir: string; url: string; base_url: string;
  endpoint: { protocol: string; port: number | null; model: string | null };
  identity: Identity & { engine_visibility: 'public' | 'private' };
  engine_visibility: 'public' | 'private'; label: string | null;
  params: Record<string, unknown>; profile: string | null; source: unknown; acknowledgments: unknown[];
  /** Per placement: host, the inventory's device facts and, where probed, what the machine reports. */
  hardware?: { host: string; devices: Record<string, unknown>[]; observed?: Record<string, unknown> }[];
};

export function enginesDir(): string {
  const dir = resolve(process.env.INFERENCE_ENGINES_DIR ?? join(REPO_ROOT, '..', 'inference-engines'));
  if (!existsSync(join(dir, 'launcher', 'src', 'cli.ts'))) throw new Error(`no inference-engines checkout at ${dir}; set INFERENCE_ENGINES_DIR`);
  return dir;
}

function launcher(args: string[], inherit = false): string {
  return execFileSync(process.execPath, [join(enginesDir(), 'launcher', 'src', 'cli.ts'), ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', inherit ? 'inherit' : 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

function common(t: RecipeTarget): string[] {
  return [...(t.profile ? ['--profile', t.profile] : []), ...(t.params ?? []).flatMap((p) => ['--param', p]),
    ...(t.on ? ['--on', t.on] : []), ...(t.inventory ? ['--inventory', t.inventory] : []), ...(t.source ? ['--source', t.source] : [])];
}

/** Bring the recipe up and wait for health; the launcher's own logs go to stderr. */
export function recipeUp(t: RecipeTarget): UpResult {
  return JSON.parse(launcher(['up', t.recipe, '--detach', '--json', '--yes', '--quiet', '--timeout', '1800', ...common(t)], true)) as UpResult;
}

export function recipeDown(id: string): void {
  launcher(['down', id, '--json']);
}

/** A recipe subject: identity declared by the recipe, resolved for this profile. Verified, unlike bare endpoints. */
export function recipeSubject(u: UpResult): Subject {
  const { engine_visibility, ...identity } = u.identity;
  return {
    ...identity, key: subjectKey(identity), target: 'recipe', engine_visibility, verified_identity: true,
    label: engine_visibility === 'private' ? 'private engine, not reproducible' : null,
  };
}
