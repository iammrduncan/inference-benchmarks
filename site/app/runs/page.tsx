import type { Metadata } from 'next';
import { manifest } from '../../lib/data.ts';
import { RunsTable } from '../../components/RunsTable.tsx';

export const metadata: Metadata = { title: 'All runs' };

export default function Runs() {
  return (
    <>
      <div className="hero">
        <h1>All runs</h1>
        <p className="lede">Every published run, newest first: {manifest.runs.length} runs over {manifest.subjects.length} subjects. Partial runs are listed and never ranked.</p>
      </div>
      <RunsTable runs={manifest.runs} />
    </>
  );
}
