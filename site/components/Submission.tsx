import { manifest } from '../lib/data.ts';
import type { Submission } from '../lib/types.ts';
import { Badge } from './ui.tsx';

const SIGNATURE: Record<'ssh' | 'gpg' | 'x509', string> = { ssh: 'SSH', gpg: 'GPG', x509: 'S/MIME' };

/** GitHub's verdict on the signature of the commit that added the run. */
export function SignatureBadge({ s }: { s: Submission['signature'] }) {
  if (s.verified) {
    const kind = s.type ? SIGNATURE[s.type] : null;
    return <Badge tone="good" title={`GitHub verified this commit's ${kind ?? ''} signature`.replace('  ', ' ')}>Signed{kind ? ` · ${kind}` : ''}</Badge>;
  }
  if (s.reason === 'unsigned') return <Badge title="The commit that added this run is not signed">Unsigned</Badge>;
  return <Badge tone="warn" title={`GitHub could not verify the signature (${s.reason})`}>Signature not verified</Badge>;
}

const profile = (login: string) => <a href={`https://github.com/${login}`}>@{login}</a>;

/** "@alice · PR #12 · commit abc1234 · Signed · SSH". `compact` drops the PR and commit links. */
export function Submitter({ s, compact = false }: { s: Submission; compact?: boolean }) {
  return (
    <span className="submitter">
      {s.by ? profile(s.by) : <span className="muted">unknown</span>}
      {!compact && s.pr !== null && <> · <a href={`${manifest.repo}/pull/${s.pr}`}>PR #{s.pr}</a></>}
      {!compact && <> · <a href={`${manifest.repo}/commit/${s.commit}`} className="mono">commit {s.commit.slice(0, 7)}</a></>}
      {!compact && s.author && s.author !== s.by && <> by {profile(s.author)}</>}
      {' '}<SignatureBadge s={s.signature} />
    </span>
  );
}
