import Link from 'next/link';
import type { ReactNode } from 'react';
import { keyParts, subjectHref } from '../lib/data.ts';
import type { Interval, Run, Subject, Verdict } from '../lib/types.ts';

export function Badge({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'warn' | 'bad' | 'good' | 'info'; title?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

/** Every label a subject or run carries. Never hidden: they qualify the numbers next to them. */
export function Labels({ subject, run }: { subject: Subject; run?: Run }) {
  return (
    <span className="labels">
      {subject.engine_visibility === 'private' && <Badge tone="warn" title="The engine's code is not public. Scores are published; nobody else can re-run them.">private engine, not reproducible</Badge>}
      {subject.label === 'provider-opaque' && <Badge title="A hosted API: the checkpoint, quant and engine are the provider's and are not visible.">provider-opaque</Badge>}
      {!subject.verified_identity && <Badge tone="bad" title="Self-declared identity from a bare endpoint.">unverified identity</Badge>}
      {run && run.status !== 'complete' && <Badge tone="bad" title="Stopped before every item ran. Published, never ranked.">{run.status}</Badge>}
      {run?.harness.dirty && <Badge tone="warn" title="bench ran with uncommitted changes; the commit alone does not reproduce it.">harness had local changes</Badge>}
    </span>
  );
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const tone = verdict === 'lossless' || verdict === 'faithful' ? 'good' : verdict === 'degraded' ? 'warn' : 'bad';
  return <Badge tone={tone}>{verdict}</Badge>;
}

/** A subject, shown by the parts of its key that vary: quant and engine, with the model on top. */
export function SubjectName({ k, showModel = true }: { k: string; showModel?: boolean }) {
  const p = keyParts(k);
  return (
    <Link href={subjectHref(k)} className="subject-name">
      {showModel && <span className="subject-model">{p.model}</span>}
      <span className="subject-variant">
        <span className="mono">{p.quant}</span>
        <span className="sep">·</span>
        <span className="mono">{p.engine}</span>
      </span>
    </Link>
  );
}

/**
 * A value with its 95% interval, drawn on a shared [min, max] scale so rows in one table
 * compare by eye. Overlapping bars are the rank bands made visible.
 */
export function IntervalBar({ v, min, max, format, showRange = true }: { v: Interval; min: number; max: number; format: (x: number) => string; showRange?: boolean }) {
  const span = max - min || 1;
  const x = (n: number) => `${Math.min(100, Math.max(0, ((n - min) / span) * 100))}%`;
  return (
    <span className={showRange ? 'ibar' : 'ibar ibar-short'} title={`${format(v.value)} (95% interval ${format(v.low)} to ${format(v.high)}, n=${v.n})`}>
      <span className="ibar-value">{format(v.value)}</span>
      <span className="ibar-track" aria-hidden="true">
        <span className="ibar-range" style={{ left: x(v.low), width: `calc(${x(v.high)} - ${x(v.low)})` }} />
        <span className="ibar-dot" style={{ left: x(v.value) }} />
      </span>
      {showRange && <span className="ibar-ci">{format(v.low)}–{format(v.high)}</span>}
    </span>
  );
}

export function DeltaCell({ d, compact = false }: { d: Interval | null; compact?: boolean }) {
  if (!d) return <span className="muted">reference</span>;
  const significant = d.high < 0 || d.low > 0;
  const cls = significant ? (d.value < 0 ? 'neg' : 'pos') : 'flat';
  const f = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(2)}`;
  return (
    <span className={`delta ${cls}`} title={`${f(d.value)} points vs reference (paired over ${d.n} tasks, 95% interval ${f(d.low)} to ${f(d.high)})`}>
      {f(d.value)}{!compact && <span className="delta-ci"> [{f(d.low)}, {f(d.high)}]</span>}
    </span>
  );
}

export function Code({ children }: { children: string }) {
  return <pre className="code"><code>{children}</code></pre>;
}

export function Section({ title, id, children, aside }: { title: string; id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section" id={id}>
      <div className="section-head">
        <h2>{title}</h2>
        {aside && <div className="section-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}
