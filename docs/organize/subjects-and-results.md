# Subjects, run records and ranking

This document defines the data model that both the runner and the site depend on.
Get this right first; everything else can be changed later.

## The subject

A **subject** is the thing that gets a score. It is a tuple:

| Field | Meaning | Example |
| --- | --- | --- |
| `model` | Model family and size, as a slug | `qwen3.8-27b` |
| `checkpoint` | Exact weights source: Hugging Face repo + commit SHA, or a provider model ID + snapshot | `Qwen/Qwen3.8-27B-Instruct@4f2a91c` |
| `quant` | Format + scheme + who produced it, with the SHA-256 of the weight files | `gguf:Q4_K_M` by `unsloth`, `sha256:…` |
| `engine` | Engine name + version or image digest, plus serving flags that change outputs | `vllm@0.14.2` (digest), `kv=fp8`, `spec=off` |
| `hardware` | Only part of the key for speed. Recorded, but not keyed, for quality | `gb10-dgx-spark x1`, `esp32-s3 16MB PSRAM` |

**Subject key** (used in URLs and folder names):

```
<model>/<checkpoint-short>/<quant>/<engine>        quality key
<model>/<checkpoint-short>/<quant>/<engine>/<hw>   speed key
```

Examples:

```
qwen3.8-27b/hf-4f2a91c/bf16/vllm-0.14.2
qwen3.8-27b/hf-4f2a91c/gguf-q4_k_m-unsloth/llamacpp-b6120
qwen3.8-27b/cerebras-2026-09/opaque/cerebras
needle3/hf-9da7512/cact-8layer/needle-esp32-9d2987b/esp32-s3
jev/typesafe-jev-latest-2026-09/opaque/typesafe
```

Rules:

- **The runner resolves every field; the user never types the key.** For recipes it
  comes from the recipe's new `identity` block (see [repo-organization.md](repo-organization.md#inference-engines-changes)).
  For HF targets the runner resolves the revision to a commit through the Hub API and
  hashes the weight files. For GGUF, only the file that was actually served is
  hashed.
- **A declared quant is checked where it can be.** Examples: `quantization_config` in
  `config.json`, the GGUF header's file type, MLX's `config.json`. If the declared
  and observed quant disagree, the run is refused.
- **Serving flags that change outputs are part of `engine`.** KV-cache dtype,
  speculative decoding, the chat template override and max-model-len truncation all
  count. Flags that only affect speed, such as tensor-parallel size and batch
  limits, belong to the speed key.
- **Adapters and heads belong to the checkpoint.** A LoRA or decision head on a
  base model, such as JEV-27B (Qwen3.8-27B + a LoRA + a decision head), is recorded
  as `checkpoint: {base, adapter@revision}`. The site can then group "same backbone"
  subjects together.
- **Training disclosures are subject metadata.** These fields are not part of the key:
  - `trained_on`: datasets and splits;
  - `overlap`: disclosed overlap with a suite;
  - `source`: a link to where the author disclosed it.

  The site uses them to flag contaminated rows (see
  [decision-models.md](decision-models.md#what-we-add-to-the-plan)).
- **Sampling and thinking settings are not part of the subject.** They are the
  **settings profile** of a run (see [benchmarks.md](benchmarks.md#settings-profiles)).
  The same subject can have runs under several profiles.

### The subject registry

Each subject has a folder `subjects/<subject-key>/` holding:
- `subject.yaml`: the resolved identity, reference, settings profiles,
  `trained_on` / `overlap`, the source link, and `engine_visibility` (`public` or
  `private`);
- `INTAKE.md`: the research, the options considered, and the user's decision.

The `benchmark-from-link` skill writes both. `run.json` copies the identity at run
time, so a run never depends on the registry staying unchanged.

### Cloud subjects

A hosted API hides the checkpoint, the quant and the engine. We record:

- `checkpoint`: the provider model ID, plus the month of the run
  (`claude-opus-5-5@2026-09`), plus any `model` or `system_fingerprint` value the API
  returns.
- `quant`: `opaque`.
- `engine`: the provider name.

The site labels these rows "provider-opaque". Two runs of the same model ID in
different months are **different subjects**, because providers change what serves a
model ID. If a provider documents its quant, as some OpenRouter endpoints do, we
record it as `quant: declared:<value>`.

### Protocols

A subject speaks one or more protocols. A suite declares which protocols it accepts.

| Protocol | Shape | Spoken natively by | Reached through an adapter by |
| --- | --- | --- | --- |
| `openai` | `/v1/chat/completions` (+ tools, `response_format`, logprobs) | vLLM, llama.cpp, SGLang, MLX servers, Needle bridge, most clouds | n/a |
| `anthropic` | Messages API | Claude | n/a |
| `decision` | **Canonical:** TypeSafe's `POST /v1/systemone` shape: `{model, state, questions}` in, `{model, answers, usage}` out; Choice / Score / Noul with full distributions | TypeSafe Jev | Adapters for: OpenRouter `POST /api/alpha/decisions`; vLLM `/v1/decide` (JEV-27B); local encoder workers (Laya, Bekko, OpenDecider-nano); **any `openai` subject via `packages/gateway`** (`json-schema` mode returns no distribution; `logprob` mode reads option logprobs) |

- **The adapter is part of the subject's `engine`.** Jev called directly and Jev
  called through OpenRouter are two subjects with the same opaque checkpoint.
- **Gateway modes are part of the run's mode.** The same Qwen subject therefore has
  separate rows for `json-schema` and `logprob`.

### Private engines

Some subjects run on an engine whose code isn't public, for example our P100 engine
for Qwen 3.8 27B. **Their scores are published**, labeled **"private engine, not
reproducible"**:

- `subject.yaml` sets `engine_visibility: private`. The engine is identified by a
  name and a version hash, with no repository URL or commit link.
- Its runs are complete: `run.json`, `summary.json` and `raw.jsonl` (model outputs
  are not secret). Only the engine's source location is left out.
- The site shows the label as a badge on every row and on the subject page. A filter
  can hide private-engine rows. They appear in rankings, with the badge.
- A private-engine subject is **never a reference subject**, because nobody else can
  re-run it.
- When the engine is published, the subject keeps its key. Its `engine_visibility`
  changes to `public` and the repository is added, so earlier runs become
  reproducible retroactively.

### Bare endpoints

`--endpoint http://host:port --identity identity.yaml` lets someone benchmark an
engine that is neither a recipe nor a supported generic engine. The identity is
self-declared and cannot be verified. Those results are listed under an
**"unverified identity"** filter that is off by default, and they are never a
reference subject.

### Reference subjects

For every checkpoint, one subject is marked as the **reference**:

- Default: the release precision on vLLM.
- Otherwise: the harness the model card used.
- Needle: its own host build at full depth.

The reference is recorded in `results/references.yaml` and changed only by PR.
Quality deltas and portable fidelity are always computed against it.

## The run record

Every run writes one folder. The format extends what `inference-engines` already
writes (`run-config.json`, `raw.jsonl`, `summary.json`), so existing evidence can be
imported without being rewritten.

```
results/<subject-key>/<suite>/<YYYY-MM-DD>-<tier>-<profile>-<shortid>/
  run.json        subject (fully resolved), target kind, suite + suite hash, harness block
                  (bench commit, suite_hash incl. prompts + extractor, scorer + version, exception flag),
                  dataset revisions, settings profile, tier, runner commit,
                  inference-engines commit + recipe id (if any), hardware inventory fingerprint,
                  acknowledged terms, start/end timestamps, operator, budget cap
  summary.json    per-metric values + n + 95% interval, completed/attempted counts
  raw.jsonl       one line per request: input id, timings, usage, output, tool calls,
                  validation result, error; or a pointer (see below)
  harness/        the external harness's own output files, untouched
```

- **Raw data over 5 MB** goes to a Hugging Face dataset repo
  (`iammrduncan/inference-benchmarks-raw`). `raw.jsonl` is then replaced by
  `raw.pointer.json`, which holds `{repo, revision, path, sha256, bytes}`. The site
  and the summarizer verify the hash.
- **`summary.json` is always recomputable from raw.** The runner has a
  `bench summarize <run>` command, and CI recomputes summaries for changed runs.
  This is the same discipline as `scripts/summarize-*.mjs` today.
- **Partial runs are kept.** A run that stopped at 60% is published as partial, with
  its completed count, and is excluded from ranking until it is complete.
- **Exporting to the Hub.** For suites whose dataset carries the Hub's
  `benchmark:official` tag (`typed-decisions`, GPQA, and others), `bench export-hf
  <run>` writes the `.eval_results/*.yaml` entry. It has the `dataset.id`, the
  `task_id` and the `value`, and `source.url` points at the run's page on our site.
  - We PR it to our **own** model repos.
  - For anyone else's model, a person decides whether to open the PR, never
    automation.
  - The Hub's default view hides models that declare `base_model` (quants,
    adapters). Our site does not, and says so.
- **Overridden sources are marked.** A run using `--source/--commit` (a development
  checkout of a recipe) is flagged `overridden`, and is never evidence for the
  pinned recipe.

## Ranking on the site

- **Leaderboard unit.** One table covers one suite (or one sub-task, such as
  GPQA), one tier and one settings profile. Rows are subjects. There are no global
  "best model" tables.
- **Uncertainty.**
  - Proportions get Wilson 95% intervals.
  - Other metrics get bootstrap intervals over items.
  - **Rank bands**: a subject's rank is shown as a range covering every subject
    whose interval overlaps its own (for example "2–4").
  - Ties are shown as ties.
- **Missing axes are N/A, never 0.** If a subject cannot produce a metric
  (calibration from a model that returns no distribution, for example), it is
  absent from that leaderboard rather than scored zero.
  - Example: JevBench's harmonic-mean composite gives zero calibration to models
    without distributions. We don't copy that.
  - Borda ranks, as in S1MB, are computed only among subjects that ran the same
    item set.
- **Composite indexes** (optional, per purpose):
  - The mean of min-max-normalized suite scores.
  - Computed only for subjects with every component at card tier.
  - Coverage is shown next to the index.
  - It is never a headline number on its own.
- **Delta columns.** Every quality table can show "Δ vs reference" for the
  subject's own checkpoint, with an interval. This column is what makes the model ×
  quant × engine view work.
- **Speed tables** are per hardware class, and show only subjects whose fidelity
  passed (or whose quality delta is within the suite's tolerance). Rows that fail
  this rule are listed underneath and marked, not hidden.
- **Taste** is a gallery with filters (model, quant, engine, task, prompt version).
  It has no computed ranks and no public voting. The only ordering is the owner's
  personal ranking (`suites/taste/ranking.yaml`), labeled "Owner's ranking".

### Site views

| View | What it shows |
| --- | --- |
| Home | The latest runs, the featured comparison (Qwen 3.8 27B across engines and quants), and links into the suites |
| Suite leaderboard | The table described above, with filters for model, quant, engine, hardware, target kind and the "unverified identity" filter |
| **Model matrix** | One checkpoint. Rows are quants, columns are engines. Each cell holds the quality Δ vs reference (with an interval), a decode tok/s sparkline for each piece of hardware, and a link to the subject. This is the view that shows the idea behind the whole project. |
| Subject | Full identity, every run with its settings profile, raw download links, a link to the recipe in `inference-engines`, and the reproduce command |
| Decisions | The decisions family. Accuracy and calibration leaderboards (calibration lists only distribution-returning subjects). A **reliability diagram** per subject. Option-order sensitivity. The "same backbone" view (System 1 head vs. System 2 structured output). The theater scene results and MP4, with a link to run the live theater locally. Contamination flags have a toggle. |
| Taste gallery | The sandboxed iframes, CSP rules, four-at-a-time limit and download-not-link rule from `taste-benchmark` |
| Methodology | Suite pins, profiles, statistics, and what is and is not comparable |

The site is **static**: a Next.js static export built from `results/` by a manifest
script, as `taste-benchmark` does it today. It is hosted on **Cloudflare Pages**. A
`_headers` file sends the taste demos' Content-Security-Policy as a real HTTP header,
as well as the `<meta>` tag. There is no server and no keys, and
anyone can build it.
