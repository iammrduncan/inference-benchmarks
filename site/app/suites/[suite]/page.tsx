import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { manifest, suite as getSuite } from '../../../lib/data.ts';
import { BoardTable, EmbeddingsSpeed, isEmbeddings } from '../../../components/Boards.tsx';
import { Badge, Section } from '../../../components/ui.tsx';

export const dynamicParams = false;
export function generateStaticParams() {
  return [...new Set(manifest.boards.map((b) => b.suite))].map((suite) => ({ suite }));
}

type Props = { params: Promise<{ suite: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { suite } = await params;
  return { title: `${suite} leaderboard` };
}

export default async function SuitePage({ params }: Props) {
  const { suite: name } = await params;
  const s = getSuite(name);
  const boards = manifest.boards.filter((b) => b.suite === name);
  if (!s || boards.length === 0) notFound();
  const group = manifest.overall.find((g) => g.id === manifest.suite_groups[s.name]);
  return (
    <>
      <div className="crumbs"><Link href="/suites/">Leaderboards</Link> / {group ? <><a href={`/suites/#${group.id}`}>{group.label}</a> /</> : null}</div>
      <div className="page-title">
        <h1>{s.name}</h1>
        <div className="tabs-note">
          <Badge>{s.protocol}</Badge>{s.scorer && <Badge>scorer: {s.scorer}</Badge>}<Badge tone={s.status === 'ready' ? 'good' : 'warn'}>{s.status}</Badge>
        </div>
        <p className="lede">{s.description}</p>
      </div>
      {boards.map((b) => {
        const runs = b.rows.map((r) => manifest.runs.find((x) => x.id === r.run)).filter((r) => r !== undefined);
        const emb = runs.filter(isEmbeddings);
        return (
          <div key={b.id}>
            <Section title={`${b.tier} tier · ${b.profile}`} aside={<>{s.tiers[b.tier] ?? ''}{b.rows.length > 0 ? ` · ranked by ${b.metric}` : ''}</>}>
              <BoardTable board={b} />
            </Section>
            {emb.length > 0 && (
              <Section title={`Speed · ${b.tier} tier`} aside="per hardware class, fidelity-gated">
                <EmbeddingsSpeed runs={emb} />
              </Section>
            )}
          </div>
        );
      })}
    </>
  );
}
