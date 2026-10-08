import type { Metadata } from 'next';
import Link from 'next/link';
import { manifest, modelHref } from '../../lib/data.ts';

export const metadata: Metadata = { title: 'Model matrix' };

export default function Models() {
  return (
    <>
      <div className="hero">
        <h1>Model matrix</h1>
        <p className="lede">One checkpoint per matrix: rows are variants (a quant served by an engine), columns are hardware, and every cell is measured against the checkpoint&apos;s reference subject. This is the view the whole project exists for.</p>
      </div>
      <ul className="list">
        {manifest.matrices.map((m) => (
          <li key={m.checkpoint}>
            <Link href={modelHref(m.model)}><b>{m.model}</b> <span className="mono small muted">{m.checkpoint}</span></Link>
            <span className="small muted">{m.variants.length} variants × {m.hardware.length} machines · {m.suite}{Object.keys(m.not_run).length ? ` · ${Object.keys(m.not_run).length} machine(s) it does not fit` : ''}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
