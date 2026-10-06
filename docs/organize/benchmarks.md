# 1. The benchmarks

What we measure, on which subjects, and at which tier. The definitions of *subject*,
*settings profile* and *run record* are in [subjects-and-results.md](subjects-and-results.md).

## Principles

1. **Model × version × engine is the variable; the harness is not.** One harness
   (`bench`) sends every request, and official packages only score its captured
   outputs ([harness.md](harness.md)). Every quality suite exists partly to answer
   "what did this quant, or this engine, cost us?" So a quality score is always
   shown next to a **reference subject**: the same checkpoint, unquantized (BF16,
   or the release precision), on a reference engine (vLLM), run through the same
   harness. The delta matters as much as the absolute score.
2. **Few suites, pinned hard.** Each suite pins its harness version, dataset
   revision, subset, prompt template, sampling and thinking settings, and scoring.
   A score without those pins is not published.
3. **Quality, speed and taste are separate axes.** They are never averaged together.
   Speed is ranked per hardware class. Taste has only the owner's personal ranking.
4. **Failures count.** Timeouts, invalid output and refusals count against the
   subject. Nothing is silently retried, repaired or dropped. This is the rule
   `typesafe-ai-benchmark` and `inference-engines` already follow.
5. **A ranked core that fits in 24 hours.** There are four tiers: `quick`, `core`,
   `think` and `full`.
   - `core` is the leaderboard: one small, fixed item set per category, sized to
     finish within about 24 hours even on slow cards like the P100.
   - `full` is model-card comparable and can take days. It is never in the main
     ranking.

   The categories, their priority benchmarks, the time budget and the planner
   are defined in **[core-set.md](core-set.md)**. Leaderboards rank only within
   one tier.
6. **Project workloads are not public scores.** Our own frozen workloads, such as
   Needle's agent-watch cases or the theater scenes, are labeled as project
   workloads everywhere they appear.

## The catalog

Status meanings (carried over from `inference-engines`):
- `ready`: implemented and has been run.
- `defined`: pinned but not yet run.
- `new`: proposed here.

### Quality suites

The Smoke and Card columns below describe each suite's scope. The ranked item sets
are the `quick` and `core` ID lists in [core-set.md](core-set.md), which replace
"smoke" and "card" as the tier names.

| Suite | Contents | Scorer (offline; `bench` generates) | Status | Smoke | Card | Scoring shown |
| --- | --- | --- | --- | --- | --- | --- |
| **general** | MMLU-Pro, GPQA Diamond, IFEval, AIME 2025 | MC extractor (ours, calibrated against lm-eval 0.4.13); IFEval checkers; math-verify | defined | 50 per task | full | accuracy per task; IFEval strict prompt-level |
| **coding** | EvalPlus (HumanEval+, MBPP+); card adds LiveCodeBench (pinned release window), Aider Polyglot | `evalplus.evaluate --samples` 0.3.1; LCB custom evaluation; Aider at pinned commit | defined | HumanEval+ | full + LCB + Aider | pass@1, greedy |
| **coding-agent** | Terminal-Bench 2.x and SWE-bench Pro, run in the **frozen agent harness** through Harbor, with `bench` as the recording proxy ([harness.md](harness.md#the-agent-harness)) | Harbor's per-task test verifiers (pinned) | new | 20 Terminal-Bench (P0) + 10 SWE-bench Pro (P1) | more of each, plus Aider Polyglot | task pass rate; tokens, turns and cache-hit rate per task |
| **tool-calling** | BFCL v4 (simple, multiple, parallel, irrelevance, multi-turn); τ²-bench for models ≥ ~8B | bfcl-eval 2026.3.23 evaluator on our result files; τ²-bench runs through Harbor in the frozen agent harness | defined (was `tool-calling-card`) | 200 BFCL rows | full BFCL + τ² | AST accuracy per category; τ² pass^1 |
| **tool-calling-small** | Needle 3 card set: Mobile Actions, DroidCall, DSTC8, SNIPS (gold + 7-way) | our port of the card's scoring | new (split out of `tool-calling-card`) | 200 rows | full splits | exact call; ordered exact calls; field F1 |
| **decisions-\*** | A family of System One decision suites: our own scenes, plus HF `typed-decisions`, S1MB, JevBench (public items), classic classification, and conformance checks | see [Decision suites](#decision-suites-system-one) | new | per suite | per suite | accuracy, calibration (KL / Brier / ECE), latency per decision, $ per 1k decisions |
| **fidelity** | Engine output compared with a reference implementation of the same weights | engine-provided command (recipe `benchmarks.fidelity`) **plus** a portable logprob check (below) | ready (engine-provided) | fixed prompts | fixed prompts × 3 | top-1 agreement, mean KL, forced-token NLL delta |

**Why these.** `general`, `coding` and `tool-calling` are what model cards report,
which lets us place our runs next to published numbers. `tool-calling-small` exists
because a 26M-parameter model like Needle scores zero on BFCL's hard categories;
those scores say nothing useful, and the model card's own set does. The decisions
family is this repo's heritage. It covers short, typed judgments where latency, cost
and calibration matter as much as accuracy. A whole model class has grown up
around that task, and nobody yet ranks it across quants and engines (see
[decision-models.md](decision-models.md)).

**Dropped or deferred**
- *MMLU (original)*: saturated, and MMLU-Pro covers it.
- *HumanEval (plain)*: EvalPlus replaces it.
- *Arena-style Elo*: we have no traffic for it.
- *LongBench v2*: deferred. Long context is covered by RULER instead: 20 items at
  32K in `core` and 64K/128K in `full` (see [core-set.md](core-set.md)).
- *JevBench's composite score and its hidden tiers*: we use JevBench's public items
  and quality metrics, but compute speed and cost ourselves (see below).

### Decision suites (System One)

Research and sources are in [decision-models.md](decision-models.md). Every
suite below accepts any subject that speaks the **decision protocol** (see
[subjects-and-results.md](subjects-and-results.md#protocols)). Chat LLMs reach it
through `packages/gateway`, in `json-schema` mode or `logprob` mode.

| Suite | Source | Items | Smoke | Card | Headline metric | Also reported |
| --- | --- | --- | --- | --- | --- | --- |
| **decisions-scenes** | Our six theater scenes (details below) | ≈ 450 decisions + stateful runs | 1 pass | 3 passes, fixed seeds | exact fixture agreement | valid rate, goal reached (stateful), p50/p95, $ per 1k |
| **typed-decisions** | HF official, `LocalLLaMA/typed-decisions` (Apache-2.0), pinned revision | `test`: 400 cases × 5 questions = 2,000 decisions (rev `d0e2f0c`) | one workflow (100 cases) | all 400 cases, each sent whole | accuracy (Hub headline) | KL from gold, Brier, ECE. Exportable to the Hub's `.eval_results`. |
| **s1mb** | `hotchpotch/S1MB` harness + `s1mb-dataset`, pinned | 137 benchmarks, 26k judgments | 1 subset per type, `--limit 200` | full | baseline-adjusted Task Avg, **familiar** and **generalization** reported separately | per-type (Noul/Choice/Score), Brier, target mass. Borda only among our own subjects. |
| **jevbench-public** | `fstandhartinger/jevbench` public items, pinned | original 72 + public hard/easy | original 72 | all public | chance-corrected accuracy | ECE, Brier, ordinal MAE, paraphrase consistency. Not their composite. |
| **decisions-sealed** | Private, owner-labeled, about 100 cases in the typed-decisions row shape; items kept in a private repo | 100 | 1 workflow | all | accuracy | KL, Brier, ECE. Items never published; an exposure log tracks every third-party endpoint they were sent to |
| **decisions-classic** | SST-2, AG News, Banking77, 500 seeded each (the `dhruvmehra/jevbench` protocol and label descriptions) | 1,500 | 100 per set | 500 per set | accuracy | macro-F1, ECE (10 bins). The only suite where encoder fine-tunes, NLI, LLMs and decision APIs share the same labels. |
| **decision-conformance** | The `finnhll/jev-eval` checks, re-implemented against our protocol | ≈ 50 probes | all | all × 3 repeats | pass / fail per invariant | probabilities sum to 1; choice = argmax; score = probability-weighted mean; batched = separate; repeat std; **option-order sensitivity**; monotonicity |

**Rules for the decisions family**

- **Calibration is N/A, not 0,** for subjects that return no distribution. This
  covers chat LLMs in `json-schema` mode, and Needle in tool-call mode. They rank on
  accuracy; calibration leaderboards list only the subjects that have it.
- **Latency per decision is measured two ways.** Single-decision latency comes
  from wherever the runner runs, with that location recorded. Batched per-decision cost comes from the same
  hardware. Hosted APIs are never scaled by an assumed factor (unlike JevBench's ×2).
- **Cost is $ per 1k decisions.** For local subjects it is shown as "$0 API, local
  compute excluded", plus J per decision when power is measured.
- **Contamination flags.** A subject trained on a suite's train split (such as
  OpenDecider-small-td or Laya-td on typed-decisions) or with disclosed overlap (such
  as Bekko on S1MB) is flagged, and hidden from the default ranking.
- **Generalization stays separate.** S1MB's generalization sets and our own sealed
  set are never averaged into familiar-task scores.

### `decisions-scenes` in detail

This suite is how the repo's current audience finds its work in the new structure,
so it is worth being precise about it.

- **Scenes.** Six of the seven theater scenes, with their existing contracts
  (`packages/demos/lib/contracts.ts`, `traffic.ts` and the theater scene
  definitions):
  - Stateless: tickets 100, guardrails 100, approvals 100, scoring 100.
  - Stateful: routing, home 24.
  - **Driving stays theater-only.** It is real-time WebGPU physics, and a
    headless replay would measure something different. If a deterministic
    fixed-timestep simulator is written later, it can join as `driving-sim`.
- **Modes.** A subject runs in whichever modes it supports. Each mode is its own
  row on the leaderboard:
  - `json-schema`: OpenAI `response_format: json_schema`, strict.
  - `tool-call`: one forced tool call. This is Needle's mode.
  - `native-judgment`: Choice/Score/Noul questions over the decision protocol,
    through the existing mapping in `lib/jev.ts`. This works for Jev and any other
    decision model (JEV-27B, OpenDecider, Laya, Bekko, …).
  - `logprob`: option probabilities read from a local engine's logprobs, through the
    gateway.

  If a mode is unsupported, the result is recorded as `unsupported`. The runner never
  falls back to "JSON in plain text" without saying so.
  This makes the **engine** visible: vLLM guided decoding, llama.cpp grammars and
  SGLang can differ on the same weights.
- **Metrics.**
  - Valid / dispatched.
  - Exact fixture agreement per scene.
  - Successful-request p50, p95 and p99.
  - Input and output tokens.
  - Known cost.
  - For stateful scenes: goal reached, and steps taken.

  These are the same numbers the README reports today, so historic results can
  be imported.
- **Concurrency.** Fixed per scene, as in the theater today (two for stateless
  scenes, one for stateful). Seeds are fixed, so input order is identical for every
  subject.

### Speed suites

| Suite | Workloads | Metrics | Status |
| --- | --- | --- | --- |
| **perf** | Standard set, identical for every subject: `chat-short` (≈512 in / 256 out); `prefill-8k` (8K in / 64 out); `prefill-32k` (only if the context allows); `decode-2k` (1K in / 2K out). Plus the recipe's own workload file when it has one. | TTFT; prefill tok/s; decode tok/s (client-measured and, where mapped, engine-reported); end-to-end latency. One unmeasured warm-up. | ready (recipe workloads); new (standard set) |
| **perf-concurrency** | `chat-short` at concurrency 1, 4, 16 and 64, stopping when p95 TTFT exceeds 10 s | aggregate output tok/s; p50/p95 TTFT and latency per level | new; applies to server engines only |
| **efficiency** | Derived from the two above when power is measured (`nvidia-smi`, `powermetrics`, a USB power meter for boards) | J per output token; W at idle and under load | new; optional |

- **Speed is only ranked within one hardware class.** For cloud subjects, "hardware"
  is the provider plus the client region, and the metric is observed latency from
  that region. That is labeled on the site.
- **Speed is only shown next to a passing fidelity result,** or next to a quality
  delta within tolerance. A fast engine that broke the model should not top a table.

### Portable fidelity check (new)

The engine-provided `fidelity` command only exists for our own engines. For every
engine that returns logprobs (vLLM, SGLang, llama.cpp server), add a portable check:

1. The reference subject greedily generates continuations for 64 fixed prompts. The
   runner stores the reference tokens and top-20 logprobs.
2. The candidate subject scores those same token sequences with `echo`/`prompt_logprobs`
   where the engine supports it; otherwise it re-generates greedily.
3. The runner reports:
   - top-1 agreement,
   - mean and p99 KL over overlapping top-k,
   - NLL delta per token.

This is the most direct measure of **quant tax** and **engine drift**, and it is cheap.
When the candidate and reference use different tokenizers the check is skipped, and
the result says so.

**Thresholds** (starting values, 2026-10-06; to be revisited once the first reference
runs exist, through a PR that creates a new suite version):

| Verdict | Rule (vs. the reference subject, same prompts) | Effect |
| --- | --- | --- |
| **broken** | top-1 agreement < 0.80, **or** mean KL > 0.5 nats/token, **or** the chat-template check fails on plain conversations | `quick` stops the run before `core`. Something is wrong with the engine or the quant file, not just quantization loss |
| **degraded** | not broken, but top-1 < 0.90 **or** mean KL > 0.10 | Runs and ranks for quality. In speed tables it is listed below the line as "degraded" |
| **faithful** | top-1 ≥ 0.90 **and** mean KL ≤ 0.10 | Eligible for speed rankings |
| **lossless** (same weights, speed-only change, e.g. MTP-1 or other speculative decoding vs. the same engine without it) | top-1 ≥ 0.99 **and** mean KL ≤ 0.01 vs. the non-speculative run | Otherwise the speed flag is treated as changing the output, and the subject is listed separately |

Engines with their own `fidelity` command, such as Needle against its host
reference, keep the thresholds the recipe declares. The verdict is still reported in
the same three words.

### Taste (unscored)

| Suite | Tasks | Output | Status |
| --- | --- | --- | --- |
| **taste** | `simple`, `detailed`, `makebetter`, moved unchanged from `taste-benchmark/tasks/` | One HTML page per task, shown in the sandboxed gallery | defined |

- **Rules carried over verbatim from `taste-benchmark`:**
  - One user message, no system prompt, no tools, one turn.
  - Each task runs in its own container with only `/task` mounted read-only.
  - Refusal fallbacks are off.
  - A task-folder fingerprint marks demos made from an older prompt.
- **Agent-harness taste** (Claude Code, Codex, and similar) is a separate suite,
  `taste-agent`, with the same isolation contract. It is listed separately, because
  the harness is part of the subject.
- **No public voting, never merged into scores.** The owner ranks taste demos
  personally (`suites/taste/ranking.yaml`), shown as "Owner's ranking".

## Which subjects run which suites

A subject's model **purpose** comes from the recipe's `purpose` field, or from the
`--purpose` flag for cloud and HF targets. Purpose selects which **categories** of
[core-set.md](core-set.md) the subject runs at `core` tier. The table below is the
scope at `full` tier. Any suite can still be run on purpose.

| Purpose | Core categories | Full-tier suites |
| --- | --- | --- |
| `general` | health, knowledge, instruction following, math, coding, tool calling, decisions, long context\*\*\*, taste (opt-in) | general, coding, tool-calling, perf, perf-concurrency\*\*, fidelity\* |
| `coding` | health, coding, tool calling, instruction following, knowledge | coding, coding-agent, tool-calling, general, perf |
| `tool-calling` / `routing` | health, tool calling (small or BFCL, by size), decisions (tool-call mode) | the same, full |
| `decision` (System One models: Jev, JEV-27B, OpenDecider, Laya, Bekko, …) | health (per-decision latency), decisions | all decisions-\* suites, full |
| any, opt-in | taste | taste |
| thinking models | + the `think` slice | + AIME, full GPQA |

\* Fidelity needs a local engine and a reference. Cloud subjects skip it.
\*\* Server engines only.
\*\*\* Only if the subject's context is at least 32K.

Target constraints worth writing down:

- **Needle on ESP32.** Tool schemas are compiled into the firmware, so BFCL and
  `tool-calling-small` must run on the **host build of the same C engine** (a
  separate recipe, `needle3/host/8-layer`). The board itself runs perf, fidelity,
  and the frozen tool-call workload. The site shows the board and the host build as
  two subjects that share weights and engine code.
- **Cloud subjects.** No fidelity, no efficiency. Perf means observed latency.
  Checkpoint and quant are opaque (see [subjects-and-results.md](subjects-and-results.md#cloud-subjects)).
- **Slow hardware.** Card tiers must be resumable and sharded. At about 20 tok/s,
  SWE-bench takes days. Summaries always state the subset size actually completed.

## Settings profiles

Scores are compared only within one **settings profile**. Each suite declares which
profiles it accepts:

| Profile | Meaning |
| --- | --- |
| `card` | The model card's recommended sampling and thinking settings, copied into the run record with the source link |
| `greedy-nothink` | Temperature 0, thinking disabled. The default for decisions, fidelity, tool-calling-small and perf |
| `thinking` | Thinking enabled at the card's recommended budget. Required for AIME and GPQA on reasoning models |

## First runs

These are the first comparison sets that show off model × quant × engine. Each set
uses one checkpoint across several quants and engines, plus a reference.

| Set | Subjects | Suites |
| --- | --- | --- |
| **Needle 3** | ESP32 8-layer (recipe, verified); host build of the 8-layer engine; Cactus native 20-layer on an M4 Pro (from the theater); depths 4 and 6 through the recipe's `layers` param | perf, fidelity, tool-calling-small, recipe tool-calls, decisions-scenes (tool-call mode) |
| **Qwen 3.8 27B** | Cerebras (cloud); vLLM BF16 on a DGX Spark (reference); vLLM FP8; llama.cpp Q4_K_M and Q8_0 GGUF; MLX 4-bit on Apple M-series | general smoke, coding smoke, decisions-scenes, decisions-classic, perf, portable fidelity |
| **Qwen 3.8 Flash Next** | The `mia-tp2` recipe (NVFP4, two Sparks) once verified, against the same checkpoint on vLLM at BF16 | general, coding, tool-calling, perf, perf-concurrency |
| **Decision models** | Jev 1.13 via the TypeSafe API **and** via OpenRouter (one opaque model, two "engines"); JEV-27B on vLLM `/v1/decide` vs. Transformers+PEFT; OpenDecider-nano in PyTorch vs. MLX vs. GGUF quants; Bekko 17M/68M in PyTorch vs. ONNX; Laya base and its td checkpoint (flagged); Needle 3 (tool-call mode) | decision-conformance, typed-decisions, decisions-classic, decisions-scenes, perf per decision; s1mb at card tier |
| **System 1 vs. System 2 on one backbone** | JEV-27B decision head vs. Qwen3.8-27B structured output (`json-schema` and `logprob` modes), on the same vLLM, same GPU | the decisions-\* suites |
| **Frontier references** | Claude Opus 5.5, Sonnet 5.5, GPT OSS 120B on Cerebras | decisions-scenes, decisions-classic, taste, general smoke (budget-capped) |

Two sets to lead the site with:

- **Qwen 3.8 27B.** The same checkpoint appears in one table across a cloud
  provider, two local engines and four precisions.
- **Decision models.** This is what the repo's current audience came for. It is
  also where engine and quant effects on calibration are newest; no one else
  publishes them.

The **System 1 vs. System 2** pair connects the two sets.
