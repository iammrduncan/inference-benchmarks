'use client';
// The home page's top subjects, sortable by any column. Client-side only for sorting; the
// rows and every number come from the static manifest.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { Bucket, OverallRow } from '../lib/types.ts';

type Labels = Record<string, { model: string; variant: string; badges: string[] }>;
type SortKey = 'index' | `bucket:${string}` | 'tokens_per_s' | 'latency' | 'ttft';

const fmt1 = (v: number) => v.toFixed(1);

function value(r: OverallRow, key: SortKey): number | null {
  if (key === 'index') return r.index;
  if (key === 'tokens_per_s') return r.tokens_per_s?.value ?? null;
  if (key === 'latency') return r.latency_p50_ms?.value ?? null;
  if (key === 'ttft') return r.ttft_ms?.value ?? null;
  return r.buckets[key.slice('bucket:'.length)]?.score ?? null;
}

/** Latency and TTFT sort ascending (lower is better); everything else descending. */
const ascending = (key: SortKey) => key === 'latency' || key === 'ttft';

export function OverallTable({ rows, buckets, labels, limit = 10 }: { rows: OverallRow[]; buckets: Bucket[]; labels: Labels; limit?: number }) {
  const [key, setKey] = useState<SortKey>('index');
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, key);
    const y = value(b, key);
    if (x === null && y === null) return (b.index ?? 0) - (a.index ?? 0);
    if (x === null) return 1; // missing is never ranked above a measurement
    if (y === null) return -1;
    return ascending(key) ? x - y : y - x;
  });
  const measured = sorted.filter((r) => value(r, key) !== null).length;
  const shown = sorted.slice(0, limit);

  const sorters: { key: SortKey; label: string }[] = [
    { key: 'index', label: 'Index' },
    ...buckets.filter((b) => b.suites.length > 0).map((b) => ({ key: `bucket:${b.id}` as SortKey, label: b.label })),
    { key: 'tokens_per_s', label: 'Tok/s' },
    { key: 'latency', label: 'Latency' },
    { key: 'ttft', label: 'TTFT' },
  ];

  const Th = ({ k, children, title, className = 'num' }: { k: SortKey; children: ReactNode; title?: string; className?: string }) => (
    <th className={`${className} sortable${key === k ? ' sorted' : ''}`} title={title} aria-sort={key === k ? (ascending(k) ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setKey(k)}>{children}{key === k ? (ascending(k) ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );

  return (
    <>
      <div className="sorters" role="group" aria-label="Sort by">
        <span className="sorters-label">Sort by</span>
        {sorters.map((s) => (
          <button key={s.key} type="button" className={`chip${key === s.key ? ' chip-on' : ''}`} onClick={() => setKey(s.key)}>{s.label}</button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="overall">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Subject</th>
              <Th k="index" title="Per category: score as a share of the best subject's (best = 100), averaged over the categories this subject ran. See Methodology.">Index</Th>
              {buckets.map((b) => (
                b.suites.length > 0
                  ? <Th key={b.id} k={`bucket:${b.id}`} title={`${b.label}: mean of ${b.suites.join(', ')}${b.note ? ` (${b.note})` : ''}`}>{b.label}</Th>
                  : <th key={b.id} className="num empty-col" title={`${b.label}: no ranked suite yet${b.note ? ` (${b.note})` : ''}`}>{b.label}</th>
              ))}
              <Th k="tokens_per_s" title="Throughput on the subject's latest run, with the hardware it ran on">Tok/s</Th>
              <Th k="latency" title="p50 latency on the subject's latest run. Per request for decisions; per batch of 32 texts for embeddings">Latency p50</Th>
              <Th k="ttft" title="Time to first token. Not measured yet: it needs the streaming suites">TTFT</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const l = labels[r.subject];
              const v = value(r, key);
              return (
                <tr key={r.subject}>
                  <td className="num rank">{v === null ? '—' : i + 1}</td>
                  <td className="subj">
                    <Link href={`/subjects/${r.subject}/`} className="subject-name">
                      <span className="subject-model">{l?.model ?? r.subject}</span>
                      <span className="subject-variant">{l?.variant}</span>
                    </Link>
                    {l?.badges.map((b) => <span key={b} className="badge" style={{ marginLeft: 6 }}>{b}</span>)}
                  </td>
                  <td className="num">
                    {r.index === null ? <span className="na">—</span> : <><b>{fmt1(r.index)}</b><span className="coverage" title={`${r.coverage} of ${buckets.filter((b) => b.suites.length > 0).length} categories with results`}>{r.coverage}/{buckets.filter((b) => b.suites.length > 0).length}</span></>}
                  </td>
                  {buckets.map((b) => {
                    const x = r.buckets[b.id];
                    return <td key={b.id} className={`num${b.suites.length === 0 ? ' empty-col' : ''}`}>{x ? fmt1(x.score) : <span className="na">—</span>}</td>;
                  })}
                  <td className="num">{r.tokens_per_s ? <span title={`${r.tokens_per_s.what}${r.tokens_per_s.hardware ? `, ${r.tokens_per_s.hardware}` : ''}`}>{Math.round(r.tokens_per_s.value).toLocaleString('en-US')}<span className="unit-hw">{r.tokens_per_s.hardware}</span></span> : <span className="na">—</span>}</td>
                  <td className="num">{r.latency_p50_ms ? <span title={`${r.latency_p50_ms.what}, ${r.latency_p50_ms.hardware ?? ''}`}>{Math.round(r.latency_p50_ms.value)} ms{r.latency_p50_ms.what !== 'per request' ? '*' : ''}</span> : <span className="na">—</span>}</td>
                  <td className="num"><span className="na" title="Not measured yet">—</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Showing {shown.length} of {rows.length} subjects{key !== 'index' ? `; ${measured} have this measurement, the rest sort last` : ''}. Category scores are each suite&apos;s headline on a 0–100 scale
        (decision accuracy, mean MTEB score) and compare only within a column. <b>—</b> means not run, never zero. Faded columns have no ranked suite yet. Latency is per request; * marks embeddings, where it is per batch of 32 texts.
      </p>
    </>
  );
}
