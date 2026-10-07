import type { Metadata } from 'next';
import Link from 'next/link';
import { manifest, suiteHref } from '../../lib/data.ts';

export const metadata: Metadata = { title: 'Methodology' };

export default function Methodology() {
  const doc = (p: string) => `${manifest.repo}/blob/main/${p}`;
  return (
    <div className="prose">
      <div className="hero">
        <h1>Methodology</h1>
        <p className="lede">What is measured, how, and what is and is not comparable.</p>
      </div>

      <h2>Subjects</h2>
      <p>A score belongs to a <b>subject</b>: <code>model/checkpoint/quant/engine</code>. The runner resolves every part from what actually ran (the Hugging Face revision, the quant producer and revision, the engine version), and nothing is typed by hand. Hardware is recorded on every run and is part of the key only for speed.</p>
      <ul>
        <li><b>Recipe subjects</b> come from <a href={manifest.engines_repo}>inference-engines</a>: the launcher brings a pinned recipe up, <code>bench</code> measures it, and the launcher takes it down. The recipe and its commit are on every run page.</li>
        <li><b>Provider-opaque</b> subjects are hosted APIs. Their checkpoint is the provider&apos;s model ID plus the month of the run, because providers change what serves a model ID.</li>
        <li><b>Private engine, not reproducible</b>: the scores are published, the engine&apos;s code is not. Such a subject is never a reference.</li>
      </ul>

      <h2>One harness</h2>
      <p><code>bench</code> builds every request, records every byte and extracts answers identically for every subject. Scoring is offline, by pinned scorers reading the captured outputs, never by calling a model. Every run publishes <code>run.json</code> (full identity and settings), <code>summary.json</code> and <code>raw.jsonl</code>, and the summary can be recomputed from raw data with <code>bench summarize</code>.</p>

      <h2>Leaderboards and uncertainty</h2>
      <ul>
        <li>One table is one suite, one tier and one settings profile. There is no global table.</li>
        <li>Proportions get Wilson 95% intervals. Ranks are <b>bands</b>: a row&apos;s range spans every position its interval allows, and overlapping rows tie.</li>
        <li>A metric a subject cannot produce is absent, never 0. Partial runs are published and never ranked.</li>
      </ul>

      <h2>Embeddings</h2>
      <ul>
        <li><b>Prompts</b> are the model card&apos;s own, read from the checkpoint at its pinned revision and applied with MTEB&apos;s rules. The server adds none.</li>
        <li><b>Scores</b> are MTEB&apos;s own main scores, computed offline from the vectors <code>bench</code> collected. The headline is the mean over the tier&apos;s tasks.</li>
        <li><b>Dimensions</b> 768, 512, 256 and 128 come from one run: the vectors are truncated and re-normalized (Matryoshka), which is exactly what a user of a smaller dimension gets.</li>
        <li><b>Δ vs reference</b> is paired task by task against the checkpoint&apos;s reference subject at the same dimension, with a bootstrap interval over tasks. The score&apos;s own interval also resamples tasks, so it mostly reflects task choice; that is why ranks overlap and the Δ column is the one to read.</li>
        <li><b>Fidelity</b> compares each run&apos;s vectors with the reference&apos;s on the same texts: mean, p1 and min cosine, and top-10 neighbor overlap for up to 1,000 queries against 20,000 documents. Verdicts: <i>lossless</i> (cosine ≥ 0.999 and overlap ≥ 0.98), <i>faithful</i>, <i>degraded</i> (cosine &lt; 0.98 or overlap &lt; 0.80), <i>broken</i> (&lt; 0.90 or &lt; 0.50). The thresholds are provisional.</li>
        <li><b>Speed</b> tables are per hardware class and rank only faithful or lossless subjects. Engines are run stock and untuned.</li>
      </ul>

      <h2>Decisions</h2>
      <p>The <Link href={suiteHref('typed-decisions')}>typed-decisions</Link> suite sends structured decision questions (Choice, Score, Noul) in the System One <code>/v1/systemone</code> shape. Accuracy counts every dispatched decision, so an invalid output is a wrong answer; KL, Brier and ECE use valid decisions only. Models without a native decision API are reached through the gateway, and the gateway mode is part of the run&apos;s mode.</p>

      <h2>Sources</h2>
      <ul>
        <li><a href={doc('docs/design/subjects-and-results.md')}>Subjects, run records and ranking</a></li>
        <li><a href={doc('docs/design/embeddings.md')}>The embeddings category</a></li>
        <li><a href={doc('docs/design/harness.md')}>The harness</a></li>
      </ul>
    </div>
  );
}
