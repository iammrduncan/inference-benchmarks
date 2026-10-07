import Link from 'next/link';
import { runHref, subject as getSubject, suiteHref } from '../lib/data.ts';
import { date, fixed, pct } from '../lib/format.ts';
import type { Run } from '../lib/types.ts';
import { DeltaCell, Labels, SubjectName, VerdictPill } from './ui.tsx';

function Headline({ r }: { r: Run }) {
  switch (r.kind) {
    case 'decisions': return <>{pct(r.metrics.accuracy.value)} <span className="muted small">accuracy</span></>;
    case 'conformance': return <>{r.metrics.passed}/{r.metrics.total} <span className="muted small">checks</span></>;
    case 'embeddings': {
      const d = r.dims[0];
      if (!d) return <>—</>;
      return <>{fixed(d.score.value * 100, 2)} {d.delta ? <DeltaCell d={d.delta} compact /> : <span className="badge badge-info">reference</span>} {d.fidelity && <VerdictPill verdict={d.fidelity.verdict} />}</>;
    }
  }
}

/** Runs, newest first: what ran, where, and its headline number. */
export function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Date</th><th>Subject</th><th>Suite</th><th>Hardware</th><th className="num">Headline</th><th></th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="small nowrap">{date(r.started_at)}</td>
              <td><SubjectName k={r.subject} /> <Labels subject={getSubject(r.subject)} run={r} /></td>
              <td className="small nowrap"><Link href={suiteHref(r.suite)}>{r.suite}</Link><span className="muted"> · {r.tier}</span></td>
              <td className="small">{r.hardware?.label ?? <span className="muted">provider-hosted</span>}</td>
              <td className="num nowrap">{<Headline r={r} />}</td>
              <td className="num"><Link href={runHref(r.id)} className="small">View →</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
