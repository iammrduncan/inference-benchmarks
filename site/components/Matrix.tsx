import Link from 'next/link';
import { findRun, runHref } from '../lib/data.ts';
import { fixed, int } from '../lib/format.ts';
import type { Matrix } from '../lib/types.ts';
import { DeltaCell, VerdictPill } from './ui.tsx';

/** Rows are variants (quant × engine family), columns are hardware; each cell is one run. */
export function MatrixTable({ m, compact = false }: { m: Matrix; compact?: boolean }) {
  return (
    <div className="table-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="corner">Variant \ Hardware</th>
            {m.hardware.map((h) => <th key={h.class} className="col">{h.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {m.variants.map((v) => (
            <tr key={v.key}>
              <th className="rowh">{v.quant}<span className="rowh-engine">{v.family}</span></th>
              {m.hardware.map((h) => {
                const cell = m.cells[v.key]?.[h.class];
                const run = cell ? findRun(cell.run) : undefined;
                if (!cell || !run || run.kind !== 'embeddings') return <td key={h.class}><span className="cell-empty">not run</span></td>;
                const top = run.dims[0];
                return (
                  <td key={h.class}>
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
                      <span className="cell-engine mono">{cell.engine}</span>
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
