import Link from 'next/link';
import { findRun, manifest, runHref, subjectHref } from '../lib/data.ts';
import { fixed, ms, pct } from '../lib/format.ts';
import type { ConformanceRun, DecisionsRun, Matrix } from '../lib/types.ts';
import { MatrixTable } from './Matrix.tsx';
import { IntervalBar, Section } from './ui.tsx';

/** The model page for a decision checkpoint: typed-decisions (core tier) per variant and machine. */
export function DecisionModel({ m }: { m: Matrix }) {
  const runs = Object.values(m.cells).flatMap((row) => Object.values(row)).map((c) => findRun(c.run)).filter((r): r is DecisionsRun => r?.kind === 'decisions');
  const ordered = [...runs].sort((a, b) => Number(b.subject === m.reference) - Number(a.subject === m.reference) || b.metrics.accuracy.value - a.metrics.accuracy.value);
  const lo = Math.min(...ordered.map((r) => r.metrics.accuracy.low)) - 0.02;
  const hi = Math.max(...ordered.map((r) => r.metrics.accuracy.high)) + 0.02;
  const types = [...new Set(ordered.flatMap((r) => Object.keys(r.metrics.accuracy_by_type)))];
  const conformance = (subject: string) => manifest.runs.filter((r): r is ConformanceRun => r.kind === 'conformance' && r.subject === subject && r.status === 'complete')[0];
  const label = (r: DecisionsRun) => `${r.subject.split('/')[2]} · ${r.hardware?.label ?? '?'}`;
  return (
    <>
      <div className="page-title">
        <h1>{m.model}</h1>
        <p className="lede">
          Checkpoint <span className="mono">{m.checkpoint}</span>. Reference:{' '}
          {m.reference ? <Link href={subjectHref(m.reference)} className="mono small">{m.reference.split('/').slice(2).join('/')}</Link> : 'none set'}.
          Scored on typed-decisions, core tier: 400 cases × 5 questions = 2,000 decisions per run. Δ is accuracy minus the reference&apos;s, in points.
        </p>
      </div>
      <Section title="Accuracy by variant and machine">
        <MatrixTable m={m} />
        <p className="table-note">Accuracy counts every dispatched decision. The interval (CI) is Wilson 95%; differences smaller than the intervals&apos; overlap are not resolved by 2,000 decisions.</p>
      </Section>
      <Section title="All runs" aside="lower is better for KL, Brier and ECE">
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Variant · machine</th><th>Accuracy (95% interval)</th><th className="num">KL ↓</th><th className="num">Brier ↓</th><th className="num">ECE ↓</th>
                {types.map((t) => <th key={t} className="num">{t}</th>)}<th className="num">p50 / case</th><th className="num">Conformance</th></tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const c = conformance(r.subject);
                return (
                  <tr key={r.id}>
                    <td><Link href={runHref(r.id)} className="mono small">{label(r)}</Link>{r.subject === m.reference && <span className="badge badge-info" style={{ marginLeft: 6 }}>reference</span>}</td>
                    <td><IntervalBar v={r.metrics.accuracy} min={lo} max={hi} format={(x) => pct(x)} /></td>
                    <td className="num">{fixed(r.metrics.kl_from_gold.value, 2)}</td>
                    <td className="num">{fixed(r.metrics.brier.value)}</td>
                    <td className="num">{fixed(r.metrics.ece)}</td>
                    {types.map((t) => <td key={t} className="num">{r.metrics.accuracy_by_type[t] ? pct(r.metrics.accuracy_by_type[t].value) : '—'}</td>)}
                    <td className="num">{r.latency_ms ? ms(r.latency_ms.p50) : '—'}</td>
                    <td className="num">{c ? <Link href={runHref(c.id)}>{c.metrics.passed}/{c.metrics.total}</Link> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="table-note">Latency is per case (one request with all five questions), measured on the machine named, one request at a time.</p>
      </Section>
    </>
  );
}
