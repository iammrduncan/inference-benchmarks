# Small Model Arena

**Status: proposal (2026-10-17).** It was prompted by the [SmolLM3](https://huggingface.co/HuggingFaceTB/SmolLM3-3B)
model card, whose headline chart puts five 2–4B models on one plot of "win rate"
against size. The arena does the same on our harness, with our records. It adds
what the card leaves out:
- intervals on every score;
- agentic coding (SWE-bench and Terminal-Bench);
- a cost axis;
- the tokens each model spends to solve each benchmark;
- the effect of quant and engine.

This is not Elo or voting; [benchmarks.md](benchmarks.md) dropped those (no traffic).
The arena is a pinned roster of small models, run on a pinned set of public
benchmarks and compared head to head.

## What the SmolLM3 card measures

Its instruct table has 8 benchmarks, run with lighteval in two modes: no extended
thinking (`/no_think`) and extended thinking (`/think`, the default):

| Benchmark | SmolLM3-3B no-think | think | Best of the five (no-think) |
| --- | --- | --- | --- |
| AIME 2025 | 9.3 | 36.7 | Qwen3-4B 17.1 |
| GSM-Plus | 72.8 | 83.4 | Qwen3-4B 82.1 |
| LiveCodeBench v4 | 15.2 | 30.0 | Qwen3-4B 24.9 |
| GPQA Diamond | 35.7 | 41.7 | Qwen3-4B 44.4 |
| IFEval | 76.7 | 71.2 | SmolLM3-3B 76.7 |
| MixEval Hard | 26.9 | 30.8 | Qwen3-4B 31.6 |
| BFCL | 92.3 | 88.8 | Qwen3-4B 95.0 |
| Global MMLU | 53.5 | 64.1 | Qwen3-4B 65.1 |

The no-think comparison covers Qwen2.5-3B, Llama 3.2 3B, Qwen3-1.7B and Qwen3-4B.
The think table has only the three hybrid models: SmolLM3-3B, Qwen3-1.7B and Qwen3-4B.

**The card's "win rate" is a mean rank, not a percentage.** The card doesn't
define it. On each benchmark, a model scores 1 plus the number of other models it
beats or ties, and a missing result scores 1 and loses to everyone. Averaged over
the 8 no-think benchmarks, that reproduces every point on the chart. Counting ties
as losses instead would put SmolLM3 at 3.75 and Llama at 1.625, which the chart
doesn't show.

| Model | Card chart | Mean rank from the card's table |
| --- | --- | --- |
| Qwen3-4B | ~4.6 | 4.625 |
| SmolLM3-3B | ~3.9 | 3.875 |
| Qwen2.5-3B | ~2.5 | 2.5 |
| Qwen3-1.7B | ~2.4 | 2.375 |
| Llama 3.2 3B | ~1.75 | 1.75 |

The arena code computes this as a check against the card, using the table above as
a test fixture. It does not rank by it (see [Win rate](#win-rate)).

## Roster

**v1: the chart's five**, so every number can be compared with the card's.

| Subject (reference: BF16, release revision) | Modes | License notes |
| --- | --- | --- |
| `HuggingFaceTB/SmolLM3-3B` | no-think, think | Apache-2.0 |
| `Qwen/Qwen3-4B` | no-think, think | Apache-2.0 |
| `Qwen/Qwen3-1.7B` | no-think, think | Apache-2.0 |
| `Qwen/Qwen2.5-3B-Instruct` | no-think | Qwen Research License (fine for benchmarking) |
| `meta-llama/Llama-3.2-3B-Instruct` | no-think | Gated on Hugging Face: the owner accepts the license once |

**v2 candidates** (verify the current release of each before adding): Qwen3-4B-2507
(Instruct and Thinking), Gemma 3 4B and 3n E4B, Phi-4-mini (3.8B), LFM2 2.6B,
Granite 4.0 Micro, Ministral 3B, and anything newer at ≤ 4B.

**The roster is versioned** (`arenas/small-models/roster.yaml`, hashed like a suite).
Win rate is relative to the roster, so adding a model starts a new arena version.
Old versions stay viewable and are never recomputed in place.

## Benchmarks

The card's 8, built as **shared suites** in the Language categories. The same
GPQA run then serves the arena, the Language table and `core`. Item lists are
fixed ID lists, as in [core-set.md](core-set.md#fixing-the-item-sets).

| Benchmark | Category | Arena items | Scorer (offline) | Already in core-set |
| --- | --- | --- | --- | --- |
| AIME 2025 | math | all 30; think mode averages 4 samples per problem | math-verify | `think` tier |
| GSM-Plus | math | 400, stratified by perturbation type | math-verify (numeric) | new |
| LiveCodeBench | coding | the card's v4 window (for the card check) and the newest pinned window (ranked), 100 each | LCB evaluator, sandboxed | core P1 (40) |
| GPQA Diamond | knowledge | all 198 | MC extractor | core P1 |
| IFEval | instruction-following | all 541 | IFEval checkers, strict prompt-level | core P0 (150) |
| MixEval Hard | knowledge | — | needs an LLM answer parser (open decision 3) | new |
| BFCL | tool-calling | 200: the core set's four categories | bfcl-eval | core P0 |
| Global MMLU | knowledge | 600: 6 languages × 100 | MC extractor | new |
| *MMLU-Pro (if MixEval Hard is dropped)* | knowledge | the core list, 280 | MC extractor | core P0 |

### Agentic coding: SWE-bench and Terminal-Bench

The card stops at single-turn coding. The arena also runs the agentic suites from
[core-set.md](core-set.md#4-coding), because tokens and cost per task matter most
here. Can a 3B model fix a real issue at all, and how many tokens and turns does it
burn trying?

| Benchmark | Arena items | Run through | Reported |
| --- | --- | --- | --- |
| **Terminal-Bench 2.x** | the core list, 20 tasks | the frozen agent harness in Harbor, with `bench` as the recording proxy ([harness.md](harness.md#the-agent-harness)) | pass rate; tokens, turns and $ per task and per *solved* task; prefix-cache hit rate |
| **SWE-bench Pro** | the core list, 10 tasks | same | same |
| *SWE-bench Verified* (optional) | a fixed 50-task subset | same | same. Its value is that many small-model numbers are published against it, but it is more contaminated than Pro |

Notes:
- These depend on M5 (the recording proxy, Harbor and the agent-harness bake-off).
  They join the arena after the single-turn suites, without blocking them.
- Small models have 32K–64K context. The harness's compaction is set relative to
  each subject's context, and a task that can't fit records `skipped: context`.
  The cell stays blank, as everywhere else.
- Expect very low pass rates at 3–4B. With 10–20 tasks the intervals are wide, so
  most agentic pairs will be ties in the win rate. The useful signals are tokens
  and turns per attempt, and whether a model solves anything at all.
- Agentic results get their own rows on the boards, and win rate is shown with and
  without them, because the agent harness is part of what's measured.

Pin every dataset revision at implementation, as the decision suites do. The card
doesn't state its BFCL version, its Global MMLU languages or its shot counts for
these. Where ours differ, the site labels the card column "card (different setup)"
rather than implying a match.

**Card check (calibration).** Before a suite is `ready`, SmolLM3-3B BF16 through
`bench` must land near the card's number. "Near" means within the score's 95%
interval, or with the gap explained, as harness.md requires for every suite. The
site shows our number and the card's number side by side.

## Modes and profiles

- **no-think** runs under `greedy-nothink`: temperature 0, thinking off, a
  per-benchmark output cap, and cut-off answers counted as wrong.
- **think** runs under `thinking`: each model card's recommended sampling (SmolLM3:
  temperature 0.6, top-p 0.95) and a thinking cap per benchmark (AIME 16K, the
  others 8K). Thinking and answer tokens are recorded separately.
- Each mode gets its own board. Models without a think mode appear only on the
  no-think board, and their think cells stay blank.

The switch differs by family: Qwen3 uses `enable_thinking` in the chat template;
SmolLM3 uses `/think` / `/no_think` in the system prompt or `enable_thinking`. The
switch a subject used is recorded with its run.

## Win rate

**Arena win rate (%)**
- Count every (benchmark, opponent) pair where both models have a result.
- Score each pair: a win is 1, a tie 0.5, a loss 0. Win rate is the mean × 100.
- **A win must be clear.** A beats B only when the 95% paired-bootstrap interval of
  A − B, over the same items, excludes zero; otherwise it's a tie. With 200–600
  items per benchmark, gaps under a few points are ties, and the board says so
  instead of ranking noise.
- A missing result is left out, not counted as a loss (unlike the card).
- Computed per mode, per roster version. The site shows it with rank bands and the
  head-to-head matrix behind it.

The **mean rank** (the card's measure) is shown only on the card-check page.

## Cost and tokens to solve

Every figure comes from the run records. The site keeps these as separate axes from
quality and never averages them together (benchmarks.md, principle 3).

| Measure | Definition | Notes |
| --- | --- | --- |
| **Tokens to solve** | Output tokens per item (median and total), and **output tokens per correct answer** = total output tokens ÷ correct items | Thinking tokens are included and also shown separately. Each model counts in its own tokenizer, so token counts don't share a unit across models. That's why time and $ sit next to them |
| **Input tokens** | Prompt tokens per item | Few-shot and tool docs make these differ by benchmark |
| **Time to solve** | Engine GPU-seconds per benchmark at a fixed concurrency, on the stated hardware | Speed only compares within one hardware class |
| **$ per 1K items** | GPU-seconds × a dated $/hour rate for that hardware class (`arenas/small-models/rates.yaml`) | Labeled as an estimate. Hosted provider prices appear as a separate column only where a provider serves the exact checkpoint, dated like the cloud subjects |
| **Size** | Parameters (billions), and weight memory at the subject's quant (GB) | The card's x-axis |

**Charts** (every axis titled with its measure and unit):
1. **Win rate (%) vs Parameters (billions)**: the card's chart, one per mode.
2. **Win rate (%) vs Cost ($ per 1K items, log scale)**, on the reference hardware.
3. **Accuracy (%) vs Output tokens per item (log scale)**, one panel per benchmark,
   with each model's no-think and think points joined. This shows what thinking
   buys per token.
4. **Head-to-head matrix**: wins, ties and losses for each pair.

## How it fits the repo

- **The arena is a site category over shared suites.** The suites keep their
  Language categories, so a 3B model's GPQA also appears in the Language table. The
  arena is a board defined by `arenas/small-models/arena.yaml`: the roster, the
  suites with their tiers and profiles, the win-rate rule and the rates file. The
  site gets a **Small Model Arena** tab next to Language, Decision, Embedding and
  Image, and a page at `/arena/small-models/`.
- **The runner needs the `chat` protocol**: OpenAI `/v1/chat/completions`, the
  thinking switch, separate reasoning tokens, output caps and stop sequences. This
  is M4's single-turn work in [build-plan.md](build-plan.md#m4--recipe-targets-single-turn-core-suites-calibration),
  and the arena's suites are the first ones built.
- **Scorers** are pinned uv projects in `runner/scorers/`, as `mteb` is today.
- **Engines.**
  - The reference is BF16 on vLLM, through the `generic/vllm` recipe (M4 item 5),
    on the DGX Spark. vLLM does not support the P100's compute capability, so
    the P100 runs llama.cpp.
  - Quant and engine variants are separate subjects: GGUF Q4_K_M and Q8_0 on
    llama.cpp, on the P100, the M4 Pro and the B70. They appear as deltas against
    the BF16 reference ("what does 4-bit cost a 3B model?"), which is the
    question this repo exists to answer.

## Item text that must not be published

The site publishes every run folder, including request and response bodies.
- **GPQA's card asks users not to "reveal examples from this dataset in plain text
  or images online."** GPQA runs therefore keep prompt and response text out of
  the published folder: `raw.jsonl` holds item IDs, hashes, extracted answers,
  correctness and token counts, and the full text stays in `.artifacts/raw`.
  A `sealed_text: true` flag in the suite, enforced by the site's publication
  check, makes this automatic.
- Check each other dataset's terms (LiveCodeBench, Global MMLU, GSM-Plus,
  MixEval) when its suite is built, and use the same flag where needed.

## Rough budget (estimates, not timings)

| Mode | Output tokens per subject | Dominated by |
| --- | --- | --- |
| no-think | ≈ 1M | IFEval, GSM-Plus, LiveCodeBench |
| think | ≈ 8–10M | AIME (4 samples × up to 16K), LiveCodeBench, Global MMLU |

Roster v1 (5 no-think + 3 think) comes to roughly 30–35M output tokens. A 3–4B
model on vLLM with batching should manage on the order of 1–2K tokens/s, so v1 is
hours, not days, on the reference hardware. On the P100 with llama.cpp, plan for
the no-think board only. The time planner replaces these with measured rates.

## Build order

1. **Chat protocol and the first two suites** (IFEval, GPQA Diamond), including
   GPQA's sealed text. SmolLM3-3B is the reference subject on `generic/vllm`.
   *Done when* both suites pass the card check in no-think mode.
2. **The remaining suites**: AIME 2025, GSM-Plus, LiveCodeBench, BFCL, Global
   MMLU, and MixEval Hard or MMLU-Pro; then think mode. *Done when* SmolLM3-3B has
   all 8 in both modes, with card-check results.
3. **Roster v1 runs**, `arena.yaml`, and the win-rate and cost code. Tests include
   the card fixture (mean ranks 4.625 / 3.875 / 2.5 / 2.375 / 1.75) and paired
   win/tie cases. *Done when* both boards compute from committed records.
4. **The site**: the arena tab, the four charts and the card-check page.
5. **Agentic coding** (after M5): Terminal-Bench 2.x and SWE-bench Pro for the
   roster, with tokens, turns and $ per task.
6. **Variants and roster v2**: quant and engine subjects on the P100, M4 Pro and
   B70, then the v2 candidates as arena version 2.

## Open decisions

1. **Roster v1**: the chart's five as proposed, or add v2 candidates from the start?
2. **Reference hardware**: BF16 on vLLM on the DGX Spark, as proposed?
3. **MixEval Hard** needs an LLM to parse free-form answers. Either use a pinned
   open judge model (labeled, and a cost of its own) or replace it with MMLU-Pro,
   which keeps 8 benchmarks, is rule-scored and is already in `core`.
4. **Cost basis**: measured GPU-time × a dated rate card per hardware class (as
   proposed), or hosted provider prices where they exist?
5. **Placement**: a site category over shared suites (as proposed), or arena-only
   suites?
