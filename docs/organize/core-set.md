# The core set: one small benchmark set per category, finishing within 24 hours

## The problem

Full benchmark runs take days on slow hardware. A P100 has slow prefill and decode,
and full LiveCodeBench, SWE-bench or a thinking-mode GPQA would each take more than
a day. We want every subject on the leaderboard to finish a **comparable** run in
**about 24 hours or less on the slowest hardware we support**. So the ranked tier has
to be small and fixed, with the expensive suites moved to optional tiers.

## Tiers (replacing `smoke` / `card`)

| Tier | Purpose | Estimated time on the P100 (below) | Ranked? |
| --- | --- | --- | --- |
| **`quick`** | Every recipe change; checks that nothing broke | ≈ 1.1 h | No (regression check only) |
| **`core`** | **The leaderboard.** Every subject runs exactly this item set | ≈ 15.4 h: about 8 h of single-turn benchmarks plus about 7.4 h of agentic coding. That fits in 24 h on the P100. On slower hardware, the planner drops agentic P1 first | **Yes** |
| **`think`** | Reasoning slice for thinking models, run on top of `core` | ≈ 6.7 h | Yes, on its own leaderboard |
| **`full`** | Model-card comparable, multi-day, resumable and sharded | days | Per-benchmark tables only, never the main ranking |

**Planning envelope: the P100.** These are measured rates reported by the owner on
2026-10-06 for Qwen 3.8 27B on the private P100 engine:
- prefill **≈ 130 tok/s at 32K context**;
- decode **≈ 28 tok/s with MTP-1** (one-token multi-token-prediction speculation).

They are not yet a committed run record. Two things make the estimates
conservative:
- The 32K prefill rate is applied to **every** item. Prefill on short prompts is
  normally faster.
- Speculative decoding speeds vary with content. Code and structured output usually
  get higher acceptance than prose.

MTP-1 is an engine flag, so it is part of the subject's `engine`. Its quality must
match the non-speculative engine within the fidelity tolerance.

The hour figures below are estimates of the form items × (prompt tokens ÷ prefill +
output tokens ÷ decode), using typical prompt and output lengths per benchmark. They
are not timings. The time planner replaces them with each subject's measured rates.

## Categories and their priority benchmarks

- **P0** must run for the subject to be listed in that category.
- **P1** is part of `core` as well, and runs after every P0 item.
- **P2** belongs to `think` or `full` only.

All `core` items run under the `greedy-nothink` profile, with a **per-benchmark
output cap**. Output cut off at the cap counts as wrong, and the number of cut-off
answers is reported.

### 0. Engine health (always runs first)

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P0 | `perf`: standard workloads `chat-short`, `prefill-8k`, `decode-2k` (+ `prefill-32k` if the context allows), 3 repeats | 13 requests | per workload | 0.2 | Measures the real prefill and decode rates, which feed the **time planner** (below) |
| P0 | **Chat-template check**: fixed conversations rendered by the engine vs. the checkpoint's own template ([harness.md](harness.md#chat-templates-are-part-of-engine-quality)) | 8 renders | — | < 0.1 | A wrong template silently costs points; we report it rather than hide it |
| P0 | Portable fidelity (logprob check vs. the reference subject) | 64 prompts | 64 | 0.1 | Catches a broken quant or engine before we spend 15 hours on it. Verdict: broken, degraded or faithful ([thresholds](benchmarks.md#portable-fidelity-check-new)) |

### 1. Knowledge and reasoning

| Pri | Benchmark | Core items | Output cap | Est. h | Why this one |
| --- | --- | --- | --- | --- | --- |
| P0 | **MMLU-Pro** | 280 (20 per subject × 14 subjects, fixed seed) | 64 | 0.5 | Broad knowledge. Its 10 options make it far harder to guess than MMLU, and quant damage shows up here first |
| P1 | **GPQA Diamond** | all 198 | 64 | 0.2 | Hard science. Cheap without thinking, and the set is small enough to run whole |

### 2. Instruction following

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P0 | **IFEval** | 150 (fixed seed, covering every instruction type) | 512 | 0.6 | Scored by rules, not a judge model. It catches broken chat templates and engines that ignore stop sequences |

### 3. Math

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P0 | **MATH-500** | 100 (20 per difficulty level, fixed seed) | 1,024 | 0.6 | Multi-step accuracy without thinking. Low-bit quants lose points here |
| P2 | AIME 2025 | 30 | 8,000 (thinking) | 3.3 | `think` tier only |

### 4. Coding

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P0 | **HumanEval+** (EvalPlus) | all 164 | 512 | 0.5 | Cheap, strict tests, sandboxed. A single-turn check of raw code generation, with no agent loop |
| P0 | **Terminal-Bench 2.x** (agentic) | 20 tasks, fixed IDs, stratified by category and difficulty | per-task turn and token caps | 4.7 | Real multi-step work in a terminal, done in the frozen agent harness through Harbor ([harness.md](harness.md#the-agent-harness)). Graded by each task's own tests |
| P1 | **SWE-bench Pro** (agentic) | 10 tasks, fixed IDs | per-task turn and token caps | 2.7 | Fixing real repository issues. Pro is the less contaminated successor to Verified |
| P1 | **LiveCodeBench** | 40 from the newest pinned release window | 1,536 | 0.4 | Less contaminated than HumanEval. The window is pinned, so the item set is fixed |
| P2 | Aider Polyglot, more Terminal-Bench and SWE-bench Pro tasks, `taste-agent` | — | — | days | `full` only |

**Estimating the agentic hours.**
- **Assumption.** The agent harness has to pass the bake-off budget: a median of
  **≤ 50K new prefill tokens and ≤ 12K output tokens per task**, with prefix caching
  on. On the P100 that is about 6.4 min of prefill and 7.1 min of decode.
- **Per task.** Plus test and tool execution, that comes to about 14 min per
  Terminal-Bench task and about 16 min per SWE-bench Pro task.
- **Without prefix caching** the agentic hours would multiply several times, so
  prefix caching is required for these suites.

### 5. Tool calling

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P0 | **BFCL v4** (simple, multiple, parallel, irrelevance) | 200 (50 per category) | 256 | 0.7 | The standard. Irrelevance checks that the model declines to call a tool when it shouldn't |
| P0 *(models < 1B)* | **tool-calling-small**: Mobile Actions + DroidCall | 200 | 128 | < 0.1 | Small models score zero on BFCL, which tells us nothing |
| P1 | The recipe's own frozen workload (e.g. Needle's 12 cases) | as defined | — | < 0.1 | Regression against the engine's own evidence |
| P2 | τ²-bench | — | — | many h | `full` only (needs a user-simulator model) |

### 6. Decisions (System One)

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P0 | **typed-decisions** (HF official) | the whole `test` split: 400 cases (100 per workflow × 4) × 5 questions = 2,000 decisions, pinned at revision `d0e2f0c` | 192 | 1.4 | Gold answers are probability distributions, so it scores calibration as well as accuracy. Each case is sent **whole** (state + all 5 questions in one request), as the dataset's own leaderboard does; request shape changes scores |
| P0 | **decision-conformance** | 50 probes | 64 | < 0.1 | The protocol checks: probabilities sum to 1, option order, batched vs. separate calls |
| P1 | **decisions-scenes** (stateless: tickets, guardrails, approvals, scoring) | 400 | 64 | 0.7 | Our own audience's benchmark: latency and cost per decision |
| P1 | **decisions-classic** | 300 (100 each: SST-2, AG News, Banking77) | 32 | 0.2 | Puts LLMs, encoders and decision APIs on the same labels |
| P1 | **decisions-sealed** (private; see below) | 100 cases × 5 questions | 192 | 0.35 | The only set no model can have trained on. Its scores are published; its items are not |
| P2 | S1MB, jevbench-public, stateful scenes | — | — | — | `full` only |

Decision encoders such as Laya or Bekko answer in milliseconds, so for them this
category takes minutes. The hour figures matter only for chat LLMs reaching these
suites through the gateway.

**The sealed set (`decisions-sealed`).**
- **Contents.** About 100 cases in the `typed-decisions` row shape: a state, five
  typed questions, and gold distributions. The owner labels them, drawing on the
  theater workloads plus new workflows.
- **Storage.** The items live in a private repo, `iammrduncan/inference-benchmarks-sealed`.
  The public repo holds only the suite definition, the SHA-256 of every item, and
  the scores.
- **Exposure log.** Sending the set to a hosted API exposes it, so every run that
  sends it to a third-party endpoint is recorded in an exposure log.
- **Rotation.** Retire a version once the log shows wide exposure, and start
  `decisions-sealed-v2`.

### 7. Long context (only if the subject's context is at least 32K)

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P1 | **RULER**: needle-in-a-haystack, multi-key and variable-tracking tasks at 32K | 20 | 64 | 1.4 | Prefill-bound: at 130 tok/s each 32K item takes about 4 minutes of prefill alone. This is the biggest single item in `core` on the P100, so it stays small |
| P2 | RULER at 64K / 128K | — | — | — | `full` only. 64K is the second length in the old P100 contract |

### 8. Taste (opt-in; ranked only by the owner)

| Pri | Benchmark | Core items | Output cap | Est. h | Why |
| --- | --- | --- | --- | --- | --- |
| P1 | **taste**: `simple`, `detailed`, `makebetter` | 3 | 16,000 | 0.25 | Cheap, and the gallery is the fun part of the site. Ranked only by the owner's personal ranking (below) |

### The `think` slice (thinking models only; ranked separately)

| Benchmark | Items | Thinking cap | Est. h |
| --- | --- | --- | --- |
| GPQA Diamond | 100 (fixed seed) | 4,096 | 3.1 |
| AIME 2025 | all 30 | 8,000 | 2.4 |
| MATH-500 | 50 (levels 4–5) | 3,072 | 1.3 |

Running `core` and `think` together comes to about 22 hours on the P100, which is
just inside one day. In practice, run `think` as its own job.

**Taste ranking.** There is no public voting. The owner ranks taste demos personally:
- The ranking lives in `suites/taste/ranking.yaml`: an ordered list of demo IDs per
  task and prompt version, with optional notes.
- The site shows it as **"Owner's ranking"** on the taste gallery.
- It is never merged into any score, index or other leaderboard.

## Total

| Tier | Contents | Est. h on the P100 | Hardware 3× slower |
| --- | --- | --- | --- |
| `quick` | perf-quick, fidelity, MMLU-Pro 70, IFEval 50, HumanEval+ 40, BFCL 50, typed-decisions 100, conformance | ≈ 1.1 | ≈ 3.4 |
| `core` (all categories that apply) | the P0 + P1 tables above (8.0 single-turn + 7.4 agentic) | ≈ 15.4 | ≈ 46: the planner drops agentic P1, then lower categories |
| `think` | the slice above | ≈ 6.7 | ≈ 20 (run separately) |

Not every subject runs every category:
- A decision encoder runs only health and Decisions.
- Needle runs health, Tool calling (small) and Decisions in tool-call mode.
- Cloud subjects skip health; they get a latency probe instead.

## The time planner

The runner turns the 24-hour goal into a rule, instead of hoping each run fits.

1. **Measure.** Engine health runs first and records the actual prefill and decode
   rates at the relevant context lengths.
2. **Project.** For each remaining benchmark it computes items × (median prompt
   tokens ÷ measured prefill + expected output tokens ÷ measured decode). The
   expected output comes from the cap and from the median of earlier runs of the
   same suite. It then prints the plan and its projected finish time.
3. **Fit or stop.** If `core` is projected to exceed `--budget-hours` (default 24),
   the runner **drops whole benchmarks, P1 before P0, starting from the least
   important category**. It never trims items inside a benchmark, because then the
   scores would no longer be comparable. The run needs `--accept-plan` before it
   continues in reduced form, and the subject is listed as "core (partial: …)",
   with the missing benchmarks named.
4. **Run in priority order**: all P0 items first, across categories, then P1. If the
   machine dies at hour 20, the most important results already exist. Every
   benchmark checkpoints after each item and resumes where it stopped.

## Speedups that don't change results

These make `core` faster without changing a score, so they are allowed. Each one is
recorded in `run.json`:

- **Prefix caching** for shared prompts (BFCL function docs, MMLU-Pro few-shot
  headers, typed-decisions questions over the same state).
- **Parallel requests** up to the engine's slot count when the engine batches
  (llama.cpp `--parallel`, vLLM). Speed results always come from `perf` alone,
  never from quality runs.
- **Tight output caps and stop sequences** per benchmark, with cut-off answers
  counted as wrong (already above).
- **Skipping rather than truncating.** A subject whose context can't fit an item
  records that item as `skipped: context`. Prompts are never silently truncated.

Not allowed in `core`:
- changing the item set per subject;
- sampling instead of greedy decoding to save tokens;
- a cheaper judge model;
- any score extrapolated from part of a benchmark.

## Fixing the item sets

- Each `core` subset is generated once from a seed and committed as an **ID list**:
  `suites/<suite>/core.ids` and `quick.ids`. The list's hash is part of the suite
  hash. Changing it creates a new suite version, and old results stay on the old
  version's leaderboard.
- The `quick` lists are a strict subset of the `core` lists, and `core` is a subset of
  `full`. A `quick` run can therefore be compared item by item with the same items
  from a `core` run.
- Stratification follows each benchmark's own categories: MMLU-Pro subjects, MATH
  levels, BFCL categories, IFEval instruction types. That way a small subset still
  covers the whole benchmark.
- With 100–300 items, the 95% interval on accuracy is about ±5–9 points. The site
  shows these intervals and rank bands, so the `core` tier says so openly instead of
  overstating differences.
