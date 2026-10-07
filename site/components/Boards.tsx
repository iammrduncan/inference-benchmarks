import Link from 'next/link';
import { run as getRun, runHref, subject as getSubject } from '../lib/data.ts';
import { fixed, int, ms, pct, rankText, usd } from '../lib/format.ts';
import type { Board, ConformanceRun, DecisionsRun, EmbeddingsRun, Run } from '../lib/types.ts';
import { DeltaCell, IntervalBar, Labels, SubjectName, VerdictPill } from './ui.tsx';

function scale(values: { low: number; high: number }[]): { min: number; max: number } {
  const lo = Math.min(...values.map((v) => v.low));
  const hi = Math.max(...values.map((v) => v.high));
  const pad = (hi - lo) * 0.08 || 0.01;
  return { min: lo - pad, max: hi + pad };
}

export function BoardTable({ board }: { board: Board }) {
  const runs = board.rows.map((r) => ({ row: r, run: getRun(r.run) }));
  const first = runs[0]?.run;
  if (!first) return null;
  switch (first.kind) {
    case 'decisions': return <DecisionsBoard rows={runs as { row: Board['rows'][number]; run: DecisionsRun }[]} />;
    case 'embeddings': return <EmbeddingsBoard rows={runs as { row: Board['rows'][number]; run: EmbeddingsRun }[]} />;
    case 'conformance': return <ConformanceBoard runs={runs.map((r) => r.run as ConformanceRun)} />;
  }
}

function DecisionsBoard({ rows }: { rows: { row: Board['rows'][number]; run: DecisionsRun }[] }) {
  const s = scale(rows.map((r) => r.run.metrics.accuracy));
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rank</th><th>Subject</th><th>Mode</th><th>Accuracy (95% interval)</th>
              <th className="num" title="KL divergence from the gold distribution. Lower is better.">KL ↓</th>
              <th className="num" title="Brier score. Lower is better.">Brier ↓</th>
              <th className="num" title="Expected calibration error, 10-bin top-label. Lower is better.">ECE ↓</th>
              <th className="num">Valid</th><th className="num">p50</th><th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, run }) => {
              const m = run.metrics;
              return (
                <tr key={run.id}>
                  <td className="rank">{rankText(row.rank)}</td>
                  <td><SubjectName k={run.subject} /> <Labels subject={getSubject(run.subject)} run={run} /></td>
                  <td><span className="mono small">{run.mode}</span></td>
                  <td><Link href={runHref(run.id)}><IntervalBar v={m.accuracy} min={s.min} max={s.max} format={(x) => pct(x)} /></Link></td>
                  <td className="num">{fixed(m.kl_from_gold.value, 2)}</td>
                  <td className="num">{fixed(m.brier.value)}</td>
                  <td className="num">{fixed(m.ece)}</td>
                  <td className="num">{int(m.valid)}/{int(m.decisions)}</td>
                  <td className="num">{run.latency_ms ? ms(run.latency_ms.p50) : '—'}</td>
                  <td className="num">{run.usage ? usd(run.usage.cost_usd) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">Ranks are bands: rows whose accuracy intervals overlap share a range. Accuracy counts every dispatched decision, so invalid outputs count as wrong; calibration columns use valid decisions only.</p>
    </>
  );
}

function EmbeddingsBoard({ rows }: { rows: { row: Board['rows'][number]; run: EmbeddingsRun }[] }) {
  const dims = [...new Set(rows.flatMap((r) => r.run.dims.map((d) => d.dim)))].sort((a, b) => b - a);
  const top = dims[0] ?? 768;
  const s = scale(rows.flatMap((r) => r.run.dims.filter((d) => d.dim === top).map((d) => d.score)));
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rank</th><th>Subject</th><th>Score at {top}</th>
              <th className="num" title="Points vs the reference subject, paired task by task, with a bootstrap interval">Δ vs ref</th>
              {dims.slice(1).map((d) => <th key={d} className="num">At {d}</th>)}
              <th>Fidelity at {top}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, run }) => {
              const full = run.dims.find((d) => d.dim === top);
              return (
                <tr key={run.id}>
                  <td className="rank">{rankText(row.rank)}</td>
                  <td><SubjectName k={run.subject} showModel={false} /><span className="hw">{run.hardware?.label ?? '—'}</span><Labels subject={getSubject(run.subject)} run={run} /></td>
                  <td>{full && <Link href={runHref(run.id)}><IntervalBar v={full.score} min={s.min} max={s.max} format={(x) => fixed(x * 100, 2)} showRange={false} /></Link>}</td>
                  <td className="num">{full ? <DeltaCell d={full.delta} /> : '—'}</td>
                  {dims.slice(1).map((d) => {
                    const x = run.dims.find((y) => y.dim === d);
                    return <td key={d} className="num">{x ? <><span>{fixed(x.score.value * 100, 2)}</span><br /><DeltaCell d={x.delta} compact /></> : '—'}</td>;
                  })}
                  <td>{full?.fidelity ? <FidelitySummary f={full.fidelity} /> : <span className="muted small">reference</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Scores are the mean MTEB main score ×100 over the tier&apos;s tasks; the bar is its 95% interval (hover for values). That interval resamples tasks, so it is wide and every row overlaps:
        what separates these subjects is the paired <b>Δ vs reference</b>, where a colored value means the interval excludes zero (hover a smaller-dimension Δ for its interval).
      </p>
    </>
  );
}

export function FidelitySummary({ f }: { f: NonNullable<EmbeddingsRun['dims'][number]['fidelity']> }) {
  return (
    <span className="small" title={`mean cosine ${f.mean_cosine}, p1 ${f.p1_cosine}, min ${f.min_cosine}; top-10 neighbor overlap ${f.top10_overlap} over ${f.queries} queries × ${f.documents} documents`}>
      <VerdictPill verdict={f.verdict} />
      <span className="hw">cos {fixed(f.mean_cosine, 4)} · top-10 {fixed(f.top10_overlap, 2)}</span>
    </span>
  );
}

/**
 * Speed per hardware class. Only subjects whose fidelity passed (faithful or lossless) are
 * ranked for speed; the rest are listed underneath, marked, never hidden.
 */
export function EmbeddingsSpeed({ runs }: { runs: EmbeddingsRun[] }) {
  const classes = [...new Set(runs.map((r) => r.hardware?.label ?? 'unknown hardware'))].sort();
  return (
    <>
      {classes.map((hw) => {
        const group = runs.filter((r) => (r.hardware?.label ?? 'unknown hardware') === hw && r.throughput);
        const passed = (r: EmbeddingsRun) => {
          const f = r.dims[0]?.fidelity;
          return r.is_reference || f?.verdict === 'faithful' || f?.verdict === 'lossless';
        };
        const sorted = [...group].sort((a, b) => Number(passed(b)) - Number(passed(a)) || (b.throughput?.engine_tokens_per_s ?? 0) - (a.throughput?.engine_tokens_per_s ?? 0));
        const max = Math.max(...group.map((r) => r.throughput?.engine_tokens_per_s ?? 0));
        return (
          <div key={hw} style={{ marginBottom: 20 }}>
            <h3>{hw}</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Subject</th><th>Prefill tokens/s (engine)</th><th className="num">Prefill tokens/s (wall)</th><th className="num">Texts/s</th><th className="num">Batch p50</th><th className="num">Batch p95</th><th>Fidelity</th></tr></thead>
                <tbody>
                  {sorted.map((r) => {
                    const t = r.throughput;
                    const f = r.dims[0]?.fidelity;
                    return (
                      <tr key={r.id} className={passed(r) ? '' : 'below'}>
                        <td><SubjectName k={r.subject} showModel={false} /></td>
                        <td>{t && <SpeedBar value={t.engine_tokens_per_s} max={max} />}</td>
                        <td className="num">{t ? int(t.tokens_per_s) : '—'}</td>
                        <td className="num">{t ? t.texts_per_s.toFixed(1) : '—'}</td>
                        <td className="num">{r.latency_ms ? ms(r.latency_ms.p50) : '—'}</td>
                        <td className="num">{r.latency_ms ? ms(r.latency_ms.p95) : '—'}</td>
                        <td>{f ? <VerdictPill verdict={f.verdict} /> : <span className="muted small">reference</span>}{!passed(r) && <span className="small muted"> not ranked for speed</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="table-note">
        Embedding is prefill only: input tokens through the model, no decode. Engine time is the server&apos;s own forward passes; wall time adds HTTP and base64 on the client. Batches of 32 texts,
        longest first, one request at a time. A <b>degraded</b> subject is listed but not ranked for speed: being fast is not a win if the vectors moved.
      </p>
    </>
  );
}

function SpeedBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="ibar" style={{ gridTemplateColumns: '5em 180px' }}>
      <span className="ibar-value">{int(value)}</span>
      <span className="ibar-track" aria-hidden="true"><span className="ibar-range" style={{ left: 0, width: `${(value / (max || 1)) * 100}%` }} /></span>
    </span>
  );
}

function ConformanceBoard({ runs }: { runs: ConformanceRun[] }) {
  const checks = [...new Set(runs.flatMap((r) => Object.keys(r.metrics.checks)))];
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Subject</th><th className="num">Passed</th>{checks.map((c) => <th key={c} className="num">{c.replaceAll('_', ' ')}</th>)}</tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><SubjectName k={r.subject} /> <Labels subject={getSubject(r.subject)} run={r} /></td>
                <td className="num"><Link href={runHref(r.id)}><b>{r.metrics.passed}/{r.metrics.total}</b></Link></td>
                {checks.map((c) => {
                  const x = r.metrics.checks[c];
                  return <td key={c} className="num">{x ? <span className={x.passed === x.total ? '' : 'delta neg'}>{x.passed}/{x.total}</span> : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-note">Conformance is pass/fail per check, so it is listed, not ranked. Failures are named on each run&apos;s page.</p>
    </>
  );
}

export const isEmbeddings = (r: Run): r is EmbeddingsRun => r.kind === 'embeddings';
