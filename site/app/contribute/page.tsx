import type { Metadata } from 'next';
import { manifest } from '../../lib/data.ts';
import { Code } from '../../components/ui.tsx';
import { SignatureBadge } from '../../components/Submission.tsx';

export const metadata: Metadata = { title: 'Contribute benchmarks' };

export default function Contribute() {
  const doc = (p: string) => `${manifest.repo}/blob/main/${p}`;
  const runners = manifest.runs.map((r) => r.submission?.by).filter((x): x is string => !!x);
  const contributors = new Set(runners).size;
  return (
    <div className="prose">
      <div className="hero">
        <h1>Contribute benchmarks</h1>
        <p className="lede">Run a model on your hardware and send the results as a pull request. Every merged run shows who submitted it and whether GitHub verified the signature on their commit.</p>
        <p className="cta-row">
          <a className="button button-primary" href={`${manifest.repo}/fork`}>Fork on GitHub</a>
          <a className="button" href={manifest.repo}>★ {manifest.stars !== null ? `${manifest.stars.toLocaleString('en-US')} stars` : 'Star'} on GitHub</a>
          <span className="muted small">{manifest.runs.length} runs from {contributors} {contributors === 1 ? 'contributor' : 'contributors'} so far</span>
        </p>
      </div>

      <h2>How it works</h2>
      <ol>
        <li><b>Fork</b> <a href={manifest.repo}>inference-benchmarks</a> and clone your fork.</li>
        <li><b>Run</b> a suite with <code>bench</code> against your model, engine and hardware (see the <a href={doc('runner/README.md')}>runner README</a>). It writes a run folder under <code>results/</code> with every request, response and timing.</li>
        <li><b>Sign</b> the commit that adds it. GitHub has to show it as <SignatureBadge s={{ verified: true, reason: 'valid', type: 'ssh' }} />; the steps are in <a href={`${doc('CONTRIBUTING.md')}#sign-your-commits`}>CONTRIBUTING.md</a>.</li>
        <li><b>Open a pull request.</b> The checks run on it, a maintainer reviews it, and once it&apos;s merged the run appears here within minutes.</li>
      </ol>
      <Code>{`git clone https://github.com/<you>/inference-benchmarks && cd inference-benchmarks
npm ci
npm run bench -- run --suite typed-decisions --tier quick --endpoint http://127.0.0.1:8000 --identity identity.yaml --model <name>
git add results subjects && git commit -S -m "Results: <model> on <hardware>"
git push && gh pr create`}</Code>

      <h2>What the checks require</h2>
      <p>Every pull request runs two checks, and it can&apos;t merge until both pass. Neither reruns a benchmark.</p>
      <ul>
        <li>The records validate, and every <code>summary.json</code> recomputes byte for byte from its <code>run.json</code> and <code>raw.jsonl</code>.</li>
        <li>Nothing in a run folder names a private machine, address or home directory: name your machines by alias (<code>gpu-host-1</code>, <code>cpu-host-1</code>) in your launcher inventory.</li>
        <li>A pull request with results changes only <code>results/</code> and <code>subjects/</code>, adds new run folders (each with <code>run.json</code>, <code>summary.json</code> and <code>raw.jsonl</code>), and never changes an existing run.</li>
        <li>The run was made by a published, unmodified <code>bench</code>: its harness commit is in main&apos;s history.</li>
        <li>Every commit that adds results carries a signature GitHub verifies.</li>
        <li>No changes under <code>submissions/</code>. Those records are written after merge, by a workflow, from GitHub&apos;s own data.</li>
      </ul>

      <h2>How credit appears</h2>
      <p>Each run page and the <a href="/runs/">runs table</a> show who submitted the run, the pull request, the commit that added it, and GitHub&apos;s verdict on its signature: <SignatureBadge s={{ verified: true, reason: 'valid', type: 'ssh' }} />, <SignatureBadge s={{ verified: false, reason: 'unsigned', type: null }} /> or <SignatureBadge s={{ verified: false, reason: 'bad_email', type: 'gpg' }} />. A signature proves who sent a run, not that its numbers are right. Anyone can rerun it: <code>run.json</code> pins the model, quant, engine, harness commit and suite.</p>

      <h2>New benchmarks and fixes</h2>
      <p>To propose a new suite or category, open an issue or a pull request against <a href={doc('docs/design/README.md')}>docs/design</a> first: a suite pins its dataset revision, item IDs, prompt template and scorer, and has to agree with the official harness before it is ranked. Fixes to the runner and site go straight to a pull request.</p>
    </div>
  );
}
