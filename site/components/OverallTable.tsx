'use client';
// The home page's top subjects: one tab per model type, each with its own categories, speed
// columns and Index, sortable by any column. Client-side only for tabs and sorting; every
// number comes from the static manifest.
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { OverallGroup, OverallRow } from '../lib/types.ts';

type Labels = Record<string, { model: string; variant: string; badges: string[] }>;
/** 'index', `bucket:<id>` or `speed:<id>`. */
type SortKey = string;

const fmt1 = (v: number) => v.toFixed(1);

function value(r: OverallRow, key: SortKey): number | null {
  if (key === 'index') return r.index;
  if (key.startsWith('speed:')) return r.speed[key.slice('speed:'.length)]?.value ?? null;
  return r.buckets[key.slice('bucket:'.length)]?.score ?? null;
}

const lowerIsBetter = (g: OverallGroup, key: SortKey) => key.startsWith('speed:') && g.speed.find((s) => `speed:${s.id}` === key)?.lower_is_better === true;

function formatSpeed(id: string, v: number): string {
  if (id === 'ttft' || id === 'latency') return `${Math.round(v)} ms`;
  if (id === 'cost') return v < 0.1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
  if (id === 'per_image') return `${v.toFixed(1)} s`;
  if (id === 'decisions_per_s') return v.toFixed(1);
  return Math.round(v).toLocaleString('en-US');
}

/**
 * `limit` caps rows (the home page shows 10); `fullHref` links each tab to its full table.
 * `syncHash` keeps the open tab in the URL (#decision), so links can open a given table.
 */
export function OverallTables({ groups, labels, limit = Infinity, fullHref, syncHash = false, suites }: {
  groups: OverallGroup[]; labels: Labels; limit?: number; fullHref?: string; syncHash?: boolean;
  /** Per group: the suites whose detail boards to link under the table. */
  suites?: Record<string, { name: string; href: string; boards: number }[]>;
}) {
  const withRows = groups.filter((g) => g.rows.length > 0);
  const [tab, setTab] = useState(withRows[0]?.id ?? groups[0]?.id ?? '');
  useEffect(() => {
    if (!syncHash) return;
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (groups.some((g) => g.id === id)) setTab(id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [syncHash, groups]);
  const choose = (id: string) => {
    setTab(id);
    if (syncHash) window.history.replaceState(null, '', `#${id}`);
  };
  const g = groups.find((x) => x.id === tab) ?? groups[0];
  if (!g) return null;
  const linked = suites?.[g.id] ?? [];
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Model type">
        {groups.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === g.id} className={`tab${x.id === g.id ? ' tab-on' : ''}`} onClick={() => choose(x.id)}>
            {x.label}<span className="tab-count">{x.rows.length}</span>
          </button>
        ))}
      </div>
      <p className="muted small tab-desc">{g.description} The Index compares only subjects in this table.</p>
      {g.rows.length > 0
        ? <OverallTable key={g.id} g={g} labels={labels} limit={limit} />
        : <div className="empty-state">No {g.label.toLowerCase()} results yet. Planned categories: {g.buckets.map((b) => b.label).join(', ')}.</div>}
      {fullHref && g.rows.length > limit && <p className="more"><a href={`${fullHref}#${g.id}`} className="button">Full {g.label} leaderboard: all {g.rows.length} subjects →</a></p>}
      {fullHref && g.rows.length > 0 && g.rows.length <= limit && <p className="table-note"><a href={`${fullHref}#${g.id}`}>Full {g.label} leaderboard and per-suite tables →</a></p>}
      {linked.length > 0 && (
        <div className="suite-links">
          <span className="muted small">Per-suite tables in {g.label}, with intervals, per-tier boards and speed:</span>
          {linked.map((x) => <a key={x.name} href={x.href} className="chip">{x.name}<span className="tab-count">{x.boards}</span></a>)}
        </div>
      )}
    </>
  );
}

function OverallTable({ g, labels, limit }: { g: OverallGroup; labels: Labels; limit: number }) {
  const [key, setKey] = useState<SortKey>('index');
  const live = g.buckets.filter((b) => b.suites.length > 0);
  const sorted = [...g.rows].sort((a, b) => {
    const x = value(a, key);
    const y = value(b, key);
    if (x === null && y === null) return (b.index ?? 0) - (a.index ?? 0);
    if (x === null) return 1; // missing is never ranked above a measurement
    if (y === null) return -1;
    return lowerIsBetter(g, key) ? x - y : y - x;
  });
  const measured = sorted.filter((r) => value(r, key) !== null).length;
  const shown = sorted.slice(0, limit);

  const sorters: { key: SortKey; label: string }[] = [
    { key: 'index', label: 'Index' },
    ...live.map((b) => ({ key: `bucket:${b.id}`, label: b.label })),
    ...g.speed.map((s) => ({ key: `speed:${s.id}`, label: s.label })),
  ];

  const Th = ({ k, children, title }: { k: SortKey; children: ReactNode; title?: string }) => (
    <th className={`num sortable${key === k ? ' sorted' : ''}`} title={title} aria-sort={key === k ? (lowerIsBetter(g, k) ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setKey(k)}>{children}{key === k ? (lowerIsBetter(g, k) ? ' ↑' : ' ↓') : ''}</button>
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
              <Th k="index" title="Per category: score as a share of the best subject's in this table (best = 100), averaged over the categories this subject ran. See Methodology.">Index</Th>
              {g.buckets.map((b) => (
                b.suites.length > 0
                  ? <Th key={b.id} k={`bucket:${b.id}`} title={`${b.label}: mean of ${b.suites.join(', ')}${b.note ? ` (${b.note})` : ''}`}>{b.label}</Th>
                  : <th key={b.id} className="num empty-col" title={`${b.label}: no ranked suite yet${b.note ? ` (${b.note})` : ''}`}>{b.label}</th>
              ))}
              {g.speed.map((s) => <Th key={s.id} k={`speed:${s.id}`} title={`${s.label}: ${s.note}, on the subject's latest run and its hardware`}>{s.label}</Th>)}
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
                    {r.index === null ? <span className="na">—</span> : <><b>{fmt1(r.index)}</b><span className="coverage" title={`${r.coverage} of ${live.length} categories with results in this table`}>{r.coverage}/{live.length}</span></>}
                  </td>
                  {g.buckets.map((b) => {
                    const x = r.buckets[b.id];
                    return <td key={b.id} className={`num${b.suites.length === 0 ? ' empty-col' : ''}`}>{x ? fmt1(x.score) : <span className="na">—</span>}</td>;
                  })}
                  {g.speed.map((s) => {
                    const x = r.speed[s.id];
                    return (
                      <td key={s.id} className="num">
                        {x
                          ? <span title={`${x.what}${x.hardware ? `, ${x.hardware}` : ''}`}>{formatSpeed(s.id, x.value)}{s.id === 'latency' && x.what !== 'per request' ? '*' : ''}{s.id !== 'latency' && s.id !== 'cost' && <span className="unit-hw">{x.hardware}</span>}</span>
                          : <span className="na" title="Not measured">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Showing {shown.length} of {g.rows.length} subjects{key !== 'index' ? `; ${measured} have this measurement, the rest sort last` : ''}. Category scores are each suite&apos;s headline on a 0–100 scale
        and compare only within a column. <b>—</b> means not measured, never zero. Faded columns have no ranked suite yet.
        {g.speed.some((s) => s.id === 'latency') && ' Latency is per request; * marks a batch.'}
        {g.id === 'embedding' && ' Embedding speed is prefill only: input tokens embedded per second. There is no decode.'}
      </p>
    </>
  );
}
