import type { Metadata } from 'next';
import { groupSuites, manifest, subjectLabels } from '../../lib/data.ts';
import { OverallTables } from '../../components/OverallTable.tsx';

export const metadata: Metadata = { title: 'Leaderboards' };

export default function Leaderboards() {
  return (
    <>
      <div className="hero">
        <h1>Leaderboards</h1>
        <p className="lede">
          Every subject, one table per kind of model: the full version of the home page&apos;s top 10. Sort by any column.
          Each table&apos;s Index compares only the subjects in it. Below each table are the per-suite boards, with intervals, every tier and speed.
        </p>
      </div>
      <OverallTables groups={manifest.overall} labels={subjectLabels()} syncHash suites={groupSuites()} />
    </>
  );
}
