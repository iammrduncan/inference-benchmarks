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

      <h2>The home page&apos;s Index</h2>
      <p>The home page has one table per kind of model: <b>Language</b>, <b>Decision</b>, <b>Embedding</b> and <b>Image</b>. Their scores do not mean the same thing (a decision model&apos;s accuracy, an embedding model&apos;s retrieval score), so they are never averaged together. A suite&apos;s <code>category</code> decides its table, so a model appears in every table it has results in: Qwen answering decisions through the gateway is in Decision, and its coding runs will be in Language. Only ranked suites count: pass/fail suites such as decision-conformance are listed, not scored.</p>
      <ul>
        <li><b>Language</b>: Taste, Coding, Math, Tool calling, Knowledge, Instruction following, Long context. Speed: prefill, decode, TTFT, latency.</li>
        <li><b>Decision</b>: Typed decisions (accuracy), Calibration ((1 − Brier) × 100 on typed-decisions), Scenes, Classic, Sealed. Speed and cost: latency per decision request, $ per 1,000 decisions.</li>
        <li><b>Embedding</b>: Text (MTEB), Code, Multilingual, Image, Audio. Speed: prefill only.</li>
        <li><b>Image</b>: Text-to-image, Image editing. Speed: time per image.</li>
      </ul>
      <ul>
        <li><b>Category score</b>: the mean of the subject&apos;s suite headlines in that category, each on a 0–100 scale (decision accuracy, mean MTEB score). For each suite, every subject is compared on the same board: the tier most subjects ran.</li>
        <li><b>Index</b>: in each category the subject ran, its score as a share of the best subject&apos;s score there (best = 100), averaged over those categories. It is computed within one table only.</li>
        <li><b>Coverage</b> (e.g. 1/2) is shown next to every Index: how many of the categories with results this subject has. The Index says how close a subject is to the best at what it runs, and nothing about what it does not run. Read it with its coverage, never alone.</li>
        <li>Taste counts only once the owner&apos;s ranking exists. Speed columns come from the subject&apos;s latest run on its stated hardware and are not part of the Index: speed only compares on the same machine. <b>Prefill</b> (input tokens per second) and <b>decode</b> (output tokens per second) are separate columns, because they are different work; embedding models only prefill. Decode and TTFT are not measured yet.</li>
      </ul>
      <p>This is a starting rule and will change as categories fill in. Every change will be listed here.</p>

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
