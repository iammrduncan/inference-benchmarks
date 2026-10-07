import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findRun, manifest, runHref, subject as getSubject, subjectHref, suiteHref } from '../../../lib/data.ts';
import { duration, fixed, int, ms, pct, usd } from '../../../lib/format.ts';
import type { ConformanceRun, DecisionsRun, EmbeddingsRun } from '../../../lib/types.ts';
import { FidelitySummary } from '../../../components/Boards.tsx';
import { Code, DeltaCell, IntervalBar, KeyValues, Labels, Section } from '../../../components/ui.tsx';

export const dynamicParams = false;
export function generateStaticParams() {
  return manifest.runs.map((r) => ({ id: r.id.split('/') }));
}

type Props = { params: Promise<{ id: string[] }> };
const decode = (parts: string[]) => parts.map((p) => decodeURIComponent(p)).join('/');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = findRun(decode(id));
  return { title: r ? `${r.suite} run ${r.run_id}` : 'Run' };
}

export default async function RunPage({ params }: Props) {
  const { id } = await params;
  const r = findRun(decode(id));
  if (!r) notFound();
  const s = getSubject(r.subject);
  return (
    <>
      <div className="crumbs"><Link href={suiteHref(r.suite)}>{r.suite}</Link> / <Link href={subjectHref(r.subject)}>{r.subject}</Link> /</div>
      <div className="page-title">
        <h1 className="mono" style={{ fontSize: 22 }}>{r.run_id}</h1>
        <Labels subject={s} run={r} />
      </div>

      {r.kind === 'embeddings' && <EmbeddingsDetail r={r} />}
      {r.kind === 'decisions' && <DecisionsDetail r={r} />}
      {r.kind === 'conformance' && <ConformanceDetail r={r} />}

      <Section title="Run">
        <KeyValues rows={[
          ['Subject', <Link key="s" href={subjectHref(r.subject)} className="mono">{r.subject}</Link>],
          ['Suite', <span key="su">{r.suite} · {r.tier} tier · profile {r.profile} · mode <span className="mono">{r.mode}</span></span>],
          ['Items', `${int(r.items.succeeded)} succeeded of ${int(r.items.attempted)} attempted (${int(r.items.planned)} planned)${r.items.failed ? `, ${int(r.items.failed)} failed` : ''}`],
          ['When', `${r.started_at.replace('T', ' ').slice(0, 19)} UTC · ${duration(r.started_at, r.finished_at)}`],
          ['Hardware', r.hardware ? <span key="hw">{r.hardware.label} (host {r.hardware.host}){r.hardware.note && <><br /><span className="small muted">{r.hardware.note}</span></>}</span> : 'provider-hosted'],
          ['Harness', <span key="h"><a href={`${manifest.repo}/tree/${r.harness.commit}`} className="mono">bench @ {r.harness.commit.slice(0, 7)}</a>{r.harness.dirty ? ' (with local changes)' : ''} · scorer {r.harness.scorer}</span>],
          ['Suite hash', <span key="sh" className="mono small">{r.harness.suite_hash}</span>],
          ...(r.recipe ? [['Recipe', <span key="rc"><a href={`${r.recipe.repo}/tree/${r.recipe.commit}`} className="mono">{r.recipe.id}</a> · profile {r.recipe.profile ?? 'default'} · inference-engines @ {r.recipe.commit.slice(0, 7)}</span>] as [string, ReactNode]] : []),
          ...(r.latency_ms ? [['Latency', `p50 ${ms(r.latency_ms.p50)} · p95 ${ms(r.latency_ms.p95)} · p99 ${ms(r.latency_ms.p99)} (per request)`] as [string, ReactNode]] : []),
          ...(r.usage ? [['Usage', `${int(r.usage.input_tokens)} input tokens · ${int(r.usage.output_tokens)} output tokens · ${usd(r.usage.cost_usd)}`] as [string, ReactNode]] : []),
        ]} />
        {r.notes.length > 0 && <ul className="small muted" style={{ marginTop: 12 }}>{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </Section>

      <Section title="Reproduce">
        <Code>{r.reproduce}</Code>
      </Section>

      <Section title="Files" aside="exactly as committed under results/">
        <ul className="files">
          {r.files.map((f) => <li key={f}><a href={`/results/${r.id}/${f}`} download>{f}</a></li>)}
        </ul>
      </Section>
    </>
  );
}

function EmbeddingsDetail({ r }: { r: EmbeddingsRun }) {
  const top = r.dims[0];
  const tasks = Object.keys(top?.tasks ?? {});
  const all = r.dims.map((d) => d.score);
  const min = Math.min(...all.map((x) => x.low)) - 0.01;
  const max = Math.max(...all.map((x) => x.high)) + 0.01;
  return (
    <>
      {r.is_reference && <div className="callout"><b>Reference run.</b> Every other run of this checkpoint is measured against these vectors.</div>}
      <Section title="By output dimension">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Dims</th><th>Score (95% interval over tasks)</th><th className="num">Δ vs reference</th><th>Fidelity</th></tr></thead>
            <tbody>
              {r.dims.map((d) => (
                <tr key={d.dim}>
                  <td className="rank">{d.dim}</td>
                  <td><IntervalBar v={d.score} min={min} max={max} format={(x) => fixed(x * 100, 2)} /></td>
                  <td className="num"><DeltaCell d={d.delta} /></td>
                  <td>{d.fidelity ? <FidelitySummary f={d.fidelity} /> : <span className="muted small">reference</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.reference && <p className="table-note">Reference: <Link href={runHref(r.reference)} className="mono">{r.reference}</Link></p>}
      </Section>
      <Section title="Per task" aside="MTEB main score ×100">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Task</th>{r.dims.map((d) => <th key={d.dim} className="num">{d.dim}</th>)}</tr></thead>
            <tbody>
              {tasks.map((t) => <tr key={t}><td className="mono small">{t}</td>{r.dims.map((d) => <td key={d.dim} className="num">{d.tasks[t] !== undefined ? fixed((d.tasks[t] ?? 0) * 100, 2) : '—'}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </Section>
      {r.throughput && (
        <Section title="Throughput">
          <KeyValues rows={[
            ['Engine tokens/s', int(r.throughput.engine_tokens_per_s)],
            ['Wall tokens/s', `${int(r.throughput.tokens_per_s)} (includes HTTP and base64)`],
            ['Texts', `${int(r.throughput.texts)} texts · ${int(r.throughput.tokens)} tokens · ${r.throughput.texts_per_s.toFixed(1)} texts/s`],
            ...(r.engine_info ? [['Engine', <span key="ei" className="mono small">{Object.entries(r.engine_info).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`).join(' · ')}</span>] as [string, ReactNode]] : []),
          ]} />
        </Section>
      )}
    </>
  );
}

function DecisionsDetail({ r }: { r: DecisionsRun }) {
  const m = r.metrics;
  const groups: [string, Record<string, typeof m.accuracy>][] = [['By question type', m.accuracy_by_type], ['By workflow', m.accuracy_by_workflow]];
  return (
    <>
      <div className="grid-3" style={{ marginTop: 24 }}>
        <div className="card"><div className="card-kicker">Accuracy</div><div className="stat">{pct(m.accuracy.value)}</div><div className="small muted">95% {pct(m.accuracy.low)}–{pct(m.accuracy.high)} · n={int(m.accuracy.n)}</div></div>
        <div className="card"><div className="card-kicker">Brier ↓</div><div className="stat">{fixed(m.brier.value)}</div><div className="small muted">KL from gold {fixed(m.kl_from_gold.value, 2)} · ECE {fixed(m.ece)}</div></div>
        <div className="card"><div className="card-kicker">Valid decisions</div><div className="stat">{int(m.valid)}/{int(m.decisions)}</div><div className="small muted">{Object.entries(r.invalid_reasons).map(([k, v]) => `${v}× ${k}`).join(' · ') || 'no invalid outputs'}</div></div>
      </div>
      {groups.map(([title, g]) => {
        const vals = Object.values(g);
        const min = Math.min(...vals.map((v) => v.low)) - 0.02;
        const max = Math.max(...vals.map((v) => v.high)) + 0.02;
        return (
          <Section key={title} title={title}>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Group</th><th>Accuracy (95% interval)</th><th className="num">n</th></tr></thead>
                <tbody>{Object.entries(g).map(([k, v]) => <tr key={k}><td>{k.replaceAll('_', ' ')}</td><td><IntervalBar v={v} min={min} max={max} format={(x) => pct(x)} /></td><td className="num">{int(v.n)}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
        );
      })}
    </>
  );
}

function ConformanceDetail({ r }: { r: ConformanceRun }) {
  return (
    <Section title={`Checks: ${r.metrics.passed}/${r.metrics.total} passed`}>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Check</th><th className="num">Passed</th><th>Failures</th></tr></thead>
          <tbody>
            {Object.entries(r.metrics.checks).map(([k, c]) => (
              <tr key={k}><td>{k.replaceAll('_', ' ')}</td><td className="num">{c.passed}/{c.total}</td><td className="small">{c.failures.length ? c.failures.map((f) => <div key={f} className="mono">{f}</div>) : <span className="muted">none</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
