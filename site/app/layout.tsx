import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { manifest } from '../lib/data.ts';
import { Logo } from '../components/Logo.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Inference Benchmarks', template: '%s · Inference Benchmarks' },
  description: 'Benchmarks for model × version × engine, measured with one harness held constant.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap top-inner">
            <Link href="/" className="brand" aria-label="Inference Benchmarks, home"><Logo /></Link>
            <nav className="nav">
              <Link href="/suites/">Leaderboards</Link>
              <Link href="/runs/">Runs</Link>
              <Link href="/models/">Model matrix</Link>
              <Link href="/subjects/">Subjects</Link>
              <Link href="/methodology/">Methodology</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="foot">
          <div className="wrap foot-inner">
            <span>Built from the committed records in <a href={manifest.repo}>inference-benchmarks</a>. Engines and recipes: <a href={manifest.engines_repo}>inference-engines</a>.</span>
            <span className="muted">A <a href="https://hackersintheloop.org">Hackers in the Loop</a> project · built {manifest.generated_at.slice(0, 10)}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
