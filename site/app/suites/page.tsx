import type { Metadata } from 'next';
import Link from 'next/link';
import { manifest, suiteHref } from '../../lib/data.ts';
import { Badge } from '../../components/ui.tsx';

export const metadata: Metadata = { title: 'Leaderboards' };

export default function Suites() {
  return (
    <>
      <div className="hero">
        <h1>Leaderboards</h1>
        <p className="lede">One table per suite, tier and settings profile. There is no global &ldquo;best model&rdquo; table: scores from different suites, tiers or profiles are not comparable.</p>
      </div>
      <ul className="list">
        {manifest.suites.map((s) => {
          const boards = manifest.boards.filter((b) => b.suite === s.name);
          return (
            <li key={s.name}>
              <span>
                {boards.length > 0 ? <Link href={suiteHref(s.name)}><b>{s.name}</b></Link> : <b>{s.name}</b>}{' '}
                <Badge>{s.protocol}</Badge>{' '}{s.status !== 'ready' && <Badge tone="warn">{s.status}</Badge>}
                <br /><span className="small muted">{s.description.split('. ')[0]}.</span>
              </span>
              <span className="small muted">{boards.length > 0 ? boards.map((b) => `${b.tier} · ${b.rows.length} subject${b.rows.length === 1 ? '' : 's'}`).join(' / ') : 'no runs yet'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
