import Link from 'next/link';
import { findRun, runHref } from '../lib/data.ts';
import { fixed, int, pct } from '../lib/format.ts';
import type { DecisionsRun, EmbeddingsRun, Matrix } from '../lib/types.ts';
import { DeltaCell, VerdictPill } from './ui.tsx';

function EmbeddingCell({ run, compact }: { run: EmbeddingsRun; compact: boolean }) {
  const top = run.dims[0];
  return (
    <>
      <span className="cell-score">{top ? fixed(top.score.value * 100, 2) : '—'}</span>
      <span className="cell-line">{run.is_reference ? <span className="badge badge-info">reference</span> : <DeltaCell d={top?.delta ?? null} />}</span>
      <span className="cell-line">
        {top?.fidelity && <VerdictPill verdict={top.fidelity.verdict} />}
        {!compact && top?.fidelity && <span>cos {fixed(top.fidelity.mean_cosine, 4)}</span>}
      </span>
      {run.throughput && <span className="cell-line">{int(run.throughput.engine_tokens_per_s)} prefill tok/s</span>}
    </>
  );
}

function DecisionCell({ run, isReference }: { run: DecisionsRun; isReference: boolean }) {
  const m = run.metrics;
  const d = run.delta_accuracy;
  return (
    <>
      <span className="cell-score">{pct(m.accuracy.value)}</span>
      <span className="cell-line">
        {isReference ? <span className="badge badge-info">reference</span>
          : d === null ? <span className="muted">no reference</span>
            : <span className={`delta ${Math.abs(d) < 0.05 ? 'flat' : d < 0 ? 'neg' : 'pos'}`} title="accuracy minus the reference's, in points">{d >= 0 ? '+' : '−'}{Math.abs(d).toFixed(1)} pts</span>}
      </span>
      <span className="cell-line">Brier {fixed(m.brier.value)} · CI {pct(m.accuracy.low)}–{pct(m.accuracy.high)}</span>
      {run.throughput && <span className="cell-line">{run.throughput.decisions_per_s.toFixed(1)} decisions/s</span>}
    </>
  );
}

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
          {m.variants.map((v, i) => (
            <tr key={v.key}>
              <th className="rowh">{v.quant}<span className="rowh-engine">{v.family}</span></th>
              {m.hardware.map((h) => {
                const cell = m.cells[v.key]?.[h.class];
                const run = cell ? findRun(cell.run) : undefined;
                const reason = m.not_run[h.class];
                if (!cell || !run) {
                  return (
                    <td key={h.class}>
                      {reason && i === 0
                        ? <span className="cell-empty"><b>does not run here</b><br />{reason}</span>
                        : <span className="cell-empty">{reason ? '—' : 'not run'}</span>}
                    </td>
                  );
                }
                return (
                  <td key={h.class}>
                    <Link href={runHref(run.id)} className="cell">
                      {run.kind === 'embeddings' && <EmbeddingCell run={run} compact={compact} />}
                      {run.kind === 'decisions' && <DecisionCell run={run} isReference={run.subject === m.reference} />}
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
