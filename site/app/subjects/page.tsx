import type { Metadata } from 'next';
import { manifest } from '../../lib/data.ts';
import { Labels, SubjectName } from '../../components/ui.tsx';

export const metadata: Metadata = { title: 'Subjects' };

export default function Subjects() {
  const models = [...new Set(manifest.subjects.map((s) => s.model))].sort();
  return (
    <>
      <div className="hero">
        <h1>Subjects</h1>
        <p className="lede">A subject is what gets a score: model, checkpoint, quant and engine. Its key is resolved by the runner from what actually ran, never typed by hand.</p>
      </div>
      {models.map((model) => (
        <section key={model} className="section">
          <h2 style={{ marginBottom: 12 }}>{model}</h2>
          <ul className="list">
            {manifest.subjects.filter((s) => s.model === model).map((s) => (
              <li key={s.key}>
                <span><SubjectName k={s.key} showModel={false} /> <Labels subject={s} /></span>
                <span className="small muted">{s.target} · {s.runs.length} run{s.runs.length === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
