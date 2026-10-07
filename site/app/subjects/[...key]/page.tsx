import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findSubject, manifest, modelHref, run as getRun, runHref, suiteHref } from '../../../lib/data.ts';
import { date, fixed, pct } from '../../../lib/format.ts';
import { DeltaCell, KeyValues, Labels, Section, VerdictPill } from '../../../components/ui.tsx';

export const dynamicParams = false;
export function generateStaticParams() {
  return manifest.subjects.map((s) => ({ key: s.key.split('/') }));
}

type Props = { params: Promise<{ key: string[] }> };

const decode = (parts: string[]) => parts.map((p) => decodeURIComponent(p)).join('/');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: decode(key) };
}

export default async function SubjectPage({ params }: Props) {
  const { key } = await params;
  const s = findSubject(decode(key));
  if (!s) notFound();
  const runs = s.runs.map(getRun);
  const recipe = runs.find((r) => r.recipe)?.recipe ?? null;
  const hasMatrix = manifest.matrices.some((m) => m.model === s.model);
  const kv = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return (
    <>
      <div className="crumbs"><Link href="/subjects/">Subjects</Link> / {hasMatrix ? <Link href={modelHref(s.model)}>{s.model}</Link> : s.model} /</div>
      <div className="page-title">
        <h1 className="mono" style={{ fontSize: 22 }}>{s.key}</h1>
        <Labels subject={s} />
      </div>

      <Section title="Identity">
        <KeyValues rows={[
          ['Model', s.model],
          ['Checkpoint', s.checkpoint.hf ? <><a href={`https://huggingface.co/${s.checkpoint.hf}/tree/${s.checkpoint.revision}`}>{s.checkpoint.hf}</a> <span className="mono small muted">@{s.checkpoint.revision}</span></> : kv(s.checkpoint)],
          ['Quant', s.quant.repo ? <>{s.quant.format} by {s.quant.producer} · <a href={`https://huggingface.co/${s.quant.repo}/tree/${s.quant.revision}`}>{s.quant.repo}</a> <span className="mono small muted">@{s.quant.revision?.slice(0, 12)}</span></> : kv(s.quant)],
          ['Engine', <span key="e" className="mono">{s.engine.name} {s.engine.version}</span>],
          ['Engine code', s.engine_visibility === 'private' ? 'private: scores published, not reproducible by others' : recipe ? <a href={`${recipe.repo}/tree/${recipe.commit}`}>inference-engines @ {recipe.commit.slice(0, 7)}</a> : s.target === 'cloud' ? 'hosted by the provider' : '—'],
          ['Target', s.target === 'recipe' && recipe ? <>recipe <a href={`${recipe.repo}/tree/${recipe.commit}`} className="mono">{recipe.id}</a></> : s.target],
          ['Identity', s.verified_identity ? 'verified by the runner' : 'self-declared (unverified)'],
        ]} />
      </Section>

      <Section title="Runs" aside={`${runs.length} published`}>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Run</th><th>Suite</th><th>Tier · profile</th><th>Mode</th><th>Hardware</th><th className="num">Headline</th><th>Status</th><th className="num">Date</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={runHref(r.id)} className="mono small">{r.run_id}</Link></td>
                  <td><Link href={suiteHref(r.suite)}>{r.suite}</Link></td>
                  <td className="small">{r.tier} · {r.profile}</td>
                  <td className="mono small">{r.mode}</td>
                  <td className="small">{r.hardware?.label ?? '—'}</td>
                  <td className="num">
                    {r.kind === 'decisions' && <>{pct(r.metrics.accuracy.value)} accuracy</>}
                    {r.kind === 'conformance' && <>{r.metrics.passed}/{r.metrics.total} checks</>}
                    {r.kind === 'embeddings' && r.dims[0] && <>{fixed(r.dims[0].score.value * 100, 2)} <DeltaCell d={r.dims[0].delta} /> {r.dims[0].fidelity && <VerdictPill verdict={r.dims[0].fidelity.verdict} />}</>}
                  </td>
                  <td className="small">{r.status}</td>
                  <td className="num small">{date(r.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
