import type { EmbeddingsRun } from '../lib/types.ts';
import { keyParts } from '../lib/data.ts';

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)'];

/**
 * Score against output dimension (Matryoshka truncation), one line per run. Static SVG:
 * the x axis is the dimension on a log scale, since 128→256 and 384→768 are the same step.
 */
export function DimChart({ runs, labels, yLabel }: { runs: EmbeddingsRun[]; labels: (r: EmbeddingsRun) => string; yLabel: string }) {
  const W = 960;
  const H = 360;
  const pad = { l: 84, r: 20, t: 16, b: 48 };
  const dims = [...new Set(runs.flatMap((r) => r.dims.map((d) => d.dim)))].sort((a, b) => a - b);
  const values = runs.flatMap((r) => r.dims.map((d) => d.score.value * 100));
  if (dims.length === 0 || values.length === 0) return null;
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  const lx = (d: number) => Math.log2(d);
  const x0 = lx(dims[0] ?? 1);
  const x1 = lx(dims[dims.length - 1] ?? 2);
  const x = (d: number) => pad.l + ((lx(d) - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((_, i, a) => a.length <= 8 || i % 2 === 0);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mean MTEB score ×100 by output dimension">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t.toFixed(0)}</text>
          </g>
        ))}
        {dims.map((d) => (
          <text key={d} x={x(d)} y={H - pad.b + 20} className="tick" textAnchor="middle">{d}</text>
        ))}
        <text x={(W + pad.l) / 2} y={H - 4} className="axis" textAnchor="middle">output dimension (vector length kept after truncation, log scale)</text>
        <text transform={`translate(18 ${(H - pad.b + pad.t) / 2}) rotate(-90)`} className="axis" textAnchor="middle">{yLabel}</text>
        {runs.map((r, i) => {
          const pts = [...r.dims].sort((a, b) => a.dim - b.dim);
          const color = COLORS[i % COLORS.length];
          return (
            <g key={r.id}>
              <polyline fill="none" stroke={color} strokeWidth={2} points={pts.map((p) => `${x(p.dim)},${y(p.score.value * 100)}`).join(' ')} />
              {pts.map((p) => <circle key={p.dim} cx={x(p.dim)} cy={y(p.score.value * 100)} r={4} fill={color}><title>{`${labels(r)}: ${(p.score.value * 100).toFixed(2)} at ${p.dim}`}</title></circle>)}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        {runs.map((r, i) => (
          <span key={r.id} className="legend-item"><span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />{labels(r)}</span>
        ))}
      </figcaption>
    </figure>
  );
}

/** `quant · engine family · hardware`: short enough for a legend or a column header. */
export const runLabel = (r: EmbeddingsRun) => {
  const p = keyParts(r.subject);
  const engine = p.engine.startsWith('sentence-transformers') ? 'sentence-transformers' : p.engine.split('-').slice(0, 2).join('-');
  return `${p.quant} · ${engine} · ${r.hardware?.class ?? '?'}`;
};
