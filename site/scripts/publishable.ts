// Every file in a run folder is published on the site under /results/, so run records must
// read like anything else the lab shows in public: machines by alias, no home directories,
// no private addresses or internal domains. This is a gate, not a scrubber. A record that
// fails is fixed in the record (or in the runner that wrote it), never rewritten here.

/** Names a public record may use for a lab machine: aliases only, never the real host names. */
export const PUBLIC_HOST = /^(?:(?:gpu|cpu)-host-\d+|macbook)$/;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const INTERNAL_SUFFIX = /\.(?:local|lan|internal|localdomain|home\.arpa|ts\.net|corp)$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const URL_HOST = /\bhttps?:\/\/(\[[^\]\s]+\]|[^/\s"'\\:?#]+)/gi;
const HOME_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+/g;

/** Why a URL host can't be published, or null when it can. */
function hostProblem(host: string): string | null {
  const h = host.toLowerCase();
  if (LOOPBACK.has(h)) return null;
  if (IPV4.test(h) || h.startsWith('[')) return 'an IP address';
  if (INTERNAL_SUFFIX.test(h)) return 'an internal domain';
  if (!h.includes('.') && !PUBLIC_HOST.test(h)) return 'a host name that is not an alias';
  return null;
}

/** What in a published file's text would expose the lab: one line per distinct finding. */
export function textProblems(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_HOST)) {
    const host = m[1] ?? '';
    const why = hostProblem(host);
    if (why) found.add(`URL host "${host}" is ${why}`);
  }
  for (const m of text.matchAll(HOME_PATH)) found.add(`home directory path "${m[0]}"`);
  return [...found];
}

/** run.json hardware: the host and every placement's host must be an alias (or absent). */
export function hardwareHostProblems(run: Record<string, unknown>): string[] {
  const hw = run.hardware;
  if (!hw || typeof hw !== 'object') return [];
  const h = hw as { host?: unknown; placements?: unknown };
  const placements = Array.isArray(h.placements) ? (h.placements as { host?: unknown }[]) : [];
  const hosts = [h.host, ...placements.map((p) => p.host)].filter((x) => x !== null && x !== undefined);
  return [...new Set(hosts.map(String))].filter((x) => !PUBLIC_HOST.test(x)).map((x) => `hardware host "${x}" is not an alias`);
}
