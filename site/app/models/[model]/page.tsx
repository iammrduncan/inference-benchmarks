import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findRun, manifest, runHref, subjectHref } from '../../../lib/data.ts';
import { fixed } from '../../../lib/format.ts';
import type { EmbeddingsRun } from '../../../lib/types.ts';
import { MatrixTable } from '../../../components/Matrix.tsx';
import { DimChart, runLabel } from '../../../components/DimChart.tsx';
import { EmbeddingsSpeed } from '../../../components/Boards.tsx';
import { DeltaCell, Section, SubjectName } from '../../../components/ui.tsx';

export const dynamicParams = false;
export function generateStaticParams() {
  return manifest.matrices.map((m) => ({ model: m.model }));
}

type Props = { params: Promise<{ model: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { model } = await params;
  return { title: `${model} model matrix` };
}

export default async function ModelPage({ params }: Props) {
  const { model } = await params;
  const m = manifest.matrices.find((x) => x.model === model);
  if (!m) notFound();
  const runs = Object.values(m.cells).flatMap((row) => Object.values(row)).map((c) => findRun(c.run)).filter((r): r is EmbeddingsRun => r?.kind === 'embeddings');
  const ordered = [...runs].sort((a, b) => Number(b.is_reference) - Number(a.is_reference) || (b.dims[0]?.score.value ?? 0) - (a.dims[0]?.score.value ?? 0));
  const tasks = Object.keys(ordered[0]?.dims[0]?.tasks ?? {});
  const top = ordered[0]?.dims[0]?.dim ?? 768;
  return (
    <>
      <div className="crumbs"><Link href="/models/">Model matrix</Link> /</div>
      <div className="page-title">
        <h1>{m.model}</h1>
        <p className="lede">
          Checkpoint <span className="mono">{m.checkpoint}</span>. Reference:{' '}
          {m.reference ? <Link href={subjectHref(m.reference)} className="mono small">{m.reference.split('/').slice(2).join('/')}</Link> : 'none set'}.
          Scores are the mean MTEB main score ×100 over the {tasks.length} quick-tier tasks; Δ is paired with the reference, task by task.
        </p>
      </div>

      <Section title={`Quality at ${top} dimensions`}>
        <MatrixTable m={m} />
        <p className="table-note">Fidelity compares each run&apos;s vectors with the reference&apos;s on the same 66,939 texts: lossless (cosine ≥ 0.999 and top-10 neighbor overlap ≥ 0.98), faithful, degraded (cosine &lt; 0.98 or overlap &lt; 0.80), broken.</p>
      </Section>

      <Section title="Output dimension (Matryoshka truncation)" aside="each line is one run: its own vectors truncated, then re-normalized">
        <DimChart runs={ordered} labels={runLabel} yLabel={`mean MTEB score ×100 (${tasks.length} tasks)`} />
      </Section>

      <Section title={`Per task at ${top} dimensions`} aside="MTEB main score ×100; Δ vs reference below">
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Task</th>{ordered.map((r) => <th key={r.id} className="num plain" style={{ whiteSpace: 'normal', minWidth: 120 }}><Link href={runHref(r.id)}>{runLabel(r)}</Link></th>)}</tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t}>
                  <td className="mono small">{t}</td>
                  {ordered.map((r) => {
                    const d = r.dims[0];
                    const v = d?.tasks[t];
                    const ref = r.reference ? findRun(r.reference) : undefined;
                    const base = ref?.kind === 'embeddings' ? ref.dims[0]?.tasks[t] : undefined;
                    const diff = v !== undefined && base !== undefined ? (v - base) * 100 : null;
                    return (
                      <td key={r.id} className="num">
                        {v !== undefined ? fixed(v * 100, 2) : '—'}
                        {diff !== null && <><br /><span className={`small ${Math.abs(diff) < 0.005 ? 'faint' : diff < 0 ? 'delta neg' : 'delta pos'}`}>{diff >= 0 ? '+' : '−'}{Math.abs(diff).toFixed(2)}</span></>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td><b>Mean</b></td>
                {ordered.map((r) => <td key={r.id} className="num"><b>{fixed((r.dims[0]?.score.value ?? 0) * 100, 2)}</b><br /><DeltaCell d={r.dims[0]?.delta ?? null} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Speed" aside="per hardware class, fidelity-gated">
        <EmbeddingsSpeed runs={ordered} />
      </Section>

      <Section title="Subjects">
        <ul className="list">
          {ordered.map((r) => <li key={r.id}><SubjectName k={r.subject} /><Link href={runHref(r.id)} className="small">{r.run_id}</Link></li>)}
        </ul>
      </Section>
    </>
  );
}
