import Link from 'next/link';
import { manifest, modelHref, runHref, subject, suite as getSuite, suiteHref } from '../lib/data.ts';
import { date } from '../lib/format.ts';
import { Labels, Section, SubjectName } from '../components/ui.tsx';
import { MatrixTable } from '../components/Matrix.tsx';

export default function Home() {
  const latest = manifest.runs.slice(0, 8);
  const featured = manifest.matrices[0];
  const suites = [...new Set(manifest.boards.map((b) => b.suite))];
  return (
    <>
      <div className="hero">
        <h1>A score is never just the model&apos;s.</h1>
        <p className="lede">
          It depends on the checkpoint and quant being run, on the engine running it, and on the harness measuring it.
          These benchmarks vary the first three and hold the harness constant, so the differences you see belong to
          the model, the version or the engine.
        </p>
        <div className="axes">
          <div><b>Model</b><span>family and size</span></div>
          <div><b>Version</b><span>checkpoint revision and quant</span></div>
          <div><b>Engine</b><span>runtime, version, flags, hardware</span></div>
          <div className="held"><b>Harness</b><span>held constant: <code>bench</code></span></div>
        </div>
      </div>

      {featured && (
        <Section title={`Model matrix: ${featured.model}`} aside={<Link href={modelHref(featured.model)}>Full matrix, chart and speed →</Link>}>
          <p className="muted">One checkpoint across quants (rows) and engines on their hardware (columns). Each cell: quality change against the reference, and how far its vectors moved.</p>
          <MatrixTable m={featured} compact />
        </Section>
      )}

      <Section title="Leaderboards">
        <div className="grid-3">
          {suites.map((name) => {
            const s = getSuite(name);
            const boards = manifest.boards.filter((b) => b.suite === name);
            return (
              <Link key={name} href={suiteHref(name)} className="card">
                <div className="card-kicker">{s?.category ?? s?.protocol ?? 'suite'}</div>
                <h3>{name}</h3>
                <p className="muted small">{s?.description.split('. ')[0]}.</p>
                <div className="small faint">{boards.map((b) => `${b.tier} · ${b.profile}`).join('  /  ')}</div>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section title="Latest runs" aside={`${manifest.runs.length} runs · ${manifest.subjects.length} subjects`}>
        <ul className="list">
          {latest.map((r) => (
            <li key={r.id}>
              <span><SubjectName k={r.subject} /> <Labels subject={subject(r.subject)} run={r} /></span>
              <span className="small muted">
                <Link href={runHref(r.id)}>{r.suite} · {r.tier}</Link>{r.hardware ? ` · ${r.hardware.label}` : ''} · {date(r.started_at)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
