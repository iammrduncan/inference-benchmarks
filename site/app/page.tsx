import Link from 'next/link';
import { keyParts, manifest, modelHref, subject } from '../lib/data.ts';
import { date } from '../lib/format.ts';
import { Section } from '../components/ui.tsx';
import { MatrixTable } from '../components/Matrix.tsx';
import { OverallTables } from '../components/OverallTable.tsx';
import { RunsTable } from '../components/RunsTable.tsx';

const RECENT = 25;

export default function Home() {
  const rows = manifest.overall.flatMap((g) => g.rows);
  // Display names for the client table: model on top, the varying parts of the key below.
  const labels = Object.fromEntries(rows.map((r) => {
    const s = subject(r.subject);
    const p = keyParts(r.subject);
    const badges = [s.engine_visibility === 'private' ? 'private engine' : null, s.label === 'provider-opaque' ? 'provider-opaque' : null].filter((x): x is string => x !== null);
    return [r.subject, { model: p.model, variant: `${p.quant} · ${p.engine}`, badges }];
  }));
  // The matrix holding the most recent run.
  const latestMatrix = manifest.runs
    .map((r) => manifest.matrices.find((m) => Object.values(m.cells).some((row) => Object.values(row).some((c) => c.run === r.id))))
    .find((m) => m !== undefined);
  const machines = new Set(manifest.runs.map((r) => r.hardware?.label ?? 'provider-hosted')).size;
  const suites = new Set(manifest.runs.map((r) => r.suite)).size;
  const latest = manifest.runs[0];

  return (
    <>
      <section className="home-hero">
        <div className="eyebrow">Open benchmarks for local and hosted inference</div>
        <h1>A score is never just the model&apos;s.</h1>
        <p className="lede">
          It belongs to the model, the exact version you ran, and the engine that served it, on stated hardware.
          We vary those three and hold the harness constant, so when two numbers differ you can see which one moved.
        </p>
        <div className="equation" aria-label="Model times version times engine gives the score; the harness is held constant">
          <div className="term"><span className="term-name">Model</span><span className="term-sub">family and size</span></div>
          <span className="op">×</span>
          <div className="term"><span className="term-name">Version</span><span className="term-sub">checkpoint · quant</span></div>
          <span className="op">×</span>
          <div className="term"><span className="term-name">Engine</span><span className="term-sub">runtime · flags · hardware</span></div>
          <span className="op">=</span>
          <div className="term term-score"><span className="term-name">Score</span><span className="term-sub">with its interval</span></div>
        </div>
        <p className="held">Measured by one harness, held constant: <code>bench</code> sends every request, records every byte and scores offline. <Link href="/methodology/">How it works →</Link></p>
        <dl className="stats">
          <div><dt>Runs</dt><dd>{manifest.runs.length}</dd></div>
          <div><dt>Subjects</dt><dd>{manifest.subjects.length}</dd></div>
          <div><dt>Suites</dt><dd>{suites}</dd></div>
          <div><dt>Machines</dt><dd>{machines}</dd></div>
          {latest && <div><dt>Latest run</dt><dd>{date(latest.started_at)}</dd></div>}
        </dl>
      </section>

      <Section title="Top subjects" aside={<Link href="/suites/">All leaderboards →</Link>}>
        <p className="muted">One row per subject (a model at one version on one engine), one column per category, one table per kind of model. Sort by any column; the Index combines the categories a subject ran.</p>
        <OverallTables groups={manifest.overall} labels={labels} limit={10} />
      </Section>

      {latestMatrix && (
        <Section title={`Latest matrix: ${latestMatrix.model}`} aside={<Link href={modelHref(latestMatrix.model)}>Chart, per-task scores and speed →</Link>}>
          <p className="muted">One checkpoint: each row is a variant (a quant served by an engine), each column a machine. Each cell shows the quality change against the reference, how far its vectors moved, and speed.</p>
          <MatrixTable m={latestMatrix} compact />
        </Section>
      )}

      <Section title="Latest runs" aside={manifest.runs.length > RECENT ? <Link href="/runs/">View all {manifest.runs.length} runs →</Link> : <Link href="/runs/">All runs →</Link>}>
        <RunsTable runs={manifest.runs.slice(0, RECENT)} />
        {manifest.runs.length > RECENT && <p className="more"><Link href="/runs/" className="button">View all {manifest.runs.length} runs</Link></p>}
      </Section>
    </>
  );
}
