// Number and date formatting shared by pages.
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const fixed = (v: number, digits = 3) => v.toFixed(digits);
export const signed = (v: number, digits = 3) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
export const int = (v: number) => Math.round(v).toLocaleString('en-US');
export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
export const usd = (v: number) => (v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
export const date = (iso: string) => iso.slice(0, 10);
export function duration(startIso: string, endIso: string): string {
  const s = (Date.parse(endIso) - Date.parse(startIso)) / 1000;
  if (!Number.isFinite(s) || s < 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
export const rankText = (r: { low: number; high: number }) => (r.low === r.high ? `${r.low}` : `${r.low}–${r.high}`);
