import Link from 'next/link';
import { findRun, runHref } from '../lib/data.ts';
import { fixed, int } from '../lib/format.ts';
import type { Matrix } from '../lib/types.ts';
import { DeltaCell, VerdictPill } from './ui.tsx';

/** Rows are quants, columns are engines on their hardware; each cell is one run. */
export function MatrixTable({ m, compact = false }: { m: Matrix; compact?: boolean }) {
  return (
    <div className="table-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="corner">Quant \ Engine</th>
            {m.engines.map((e) => (
              <th key={e.key} className="col"><span className="mono">{e.engine}</span><span className="muted">{e.hardware}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.quants.map((q) => (
            <tr key={q}>
              <th className="rowh">{q}</th>
              {m.engines.map((e) => {
                const cell = m.cells[q]?.[e.key];
                const run = cell ? findRun(cell.run) : undefined;
                if (!cell || !run || run.kind !== 'embeddings') return <td key={e.key}><span className="cell-empty">not run</span></td>;
                const top = run.dims[0];
                return (
                  <td key={e.key}>
                    <Link href={runHref(run.id)} className="cell">
                      <span className="cell-score">{top ? fixed(top.score.value * 100, 2) : '—'}</span>
                      <span className="cell-line">
                        {run.is_reference ? <span className="badge badge-info">reference</span> : <DeltaCell d={top?.delta ?? null} />}
                      </span>
                      <span className="cell-line">
                        {top?.fidelity && <VerdictPill verdict={top.fidelity.verdict} />}
                        {!compact && top?.fidelity && <span>cos {fixed(top.fidelity.mean_cosine, 4)}</span>}
                      </span>
                      {run.throughput && <span className="cell-line">{int(run.throughput.engine_tokens_per_s)} tok/s</span>}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
