# Organizing inference-engines, benchmarks and taste

Status: **planning complete, 2026-10-06.** All questions are answered (Q1–Q9) and decisions D1–D18 are set. The ordered build starts at M0 in **[build-plan.md](build-plan.md)**. Nothing is implemented yet.

## The premise

A score is never just the model's. It is **model × version × engine × harness**:
- *version* is the checkpoint and quant you are actually running;
- *engine* is the kernels, chat-template handling, sampling and parsing;
- *harness* is the prompts, request shape and answer extraction.

We vary and measure the first three, and hold the harness constant: one harness,
`bench`, sends every request to every subject for every benchmark. See
[harness.md](harness.md).

## The goal

Turn `typesafe-ai-benchmark` (40 stars as of 2026-09-29) into the project's
general **`inference-benchmarks`** repo (`iammrduncan/inference-benchmarks`):

- It owns every benchmark definition: the suites now in
  `inference-engines/benchmarks/suites/`, the taste tasks now in `taste-benchmark`,
  and the structured-decision scenes it already has.
- It owns the **runner**. The runner can target three kinds of subject:
  1. a recipe recorded in `inference-engines`,
  2. a hosted cloud model (Anthropic, OpenAI, Cerebras, TypeSafe, OpenRouter, …),
  3. a Hugging Face link served by a standard engine (vLLM, llama.cpp, SGLang, MLX).
- It owns the **results** and a **static site** that shows and ranks them.
- What it ranks is not "a model" but a **subject**: model × checkpoint × quant ×
  engine (× hardware for speed). The same weights can score differently at
  another quant or in another engine, and showing that is the point.

`inference-engines` stays the place that knows **how to run** things. `inference-benchmarks`
knows **what to measure** and **what the results were**.

## Documents

| File | Question it answers |
| --- | --- |
| [build-plan.md](build-plan.md) | **Start here to build.** Prerequisites (checked on this Mac), and milestones M0–M8, each with tasks and a runnable "done when" check. |
| [benchmarks.md](benchmarks.md) | 1. Which benchmarks do we run, on which subjects, at which tiers? |
| [harness.md](harness.md) | The premise, and the one harness: `bench` generates every request; pinned official packages only score the captured outputs offline. Also covers chat-template checks and calibrating the harness against official harnesses. |
| [core-set.md](core-set.md) | The ranked `core` tier: nine categories, the priority benchmarks in each, a time budget that fits in about 24 hours on slow cards like the P100, and the time planner. |
| [subjects-and-results.md](subjects-and-results.md) | What exactly is a "subject", what a run records, where results live, and how the site ranks them. (Shared by 1 and 2.) |
| [repo-shift.md](repo-shift.md) | 2. How `typesafe-ai-benchmark` becomes `inference-benchmarks`: what we keep, move, split or retire, file by file. |
| [decision-models.md](decision-models.md) | Research: JevBench, HF's official `typed-decisions`, S1MB and other System One benchmarks, the open decision models, and what they add to this plan. |
| [benchmark-from-link skill](../../.agents/skills/benchmark-from-link/SKILL.md) | Skill (linked from `.claude/skills/`): turns a paper, Hugging Face or GitHub link plus a hardware target into a recipe, subject records and benchmark runs. |
| [repo-organization.md](repo-organization.md) | 3. How the four repos relate afterwards, which way the dependencies go, and the migration order. |

## Decisions proposed

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Home of the benchmarks repo | Rename `iammrduncan/typesafe-ai-benchmark` → **`iammrduncan/inference-benchmarks`**, staying on the personal account next to `iammrduncan/inference-engines` (already moved there from `Hackers-in-the-Loop`). A rename keeps stars, issues and redirects. Tag `typesafe-v1` first. |
| D2 | Unit of ranking | The **subject**: `model@revision / quant / engine@version`, plus `hardware` for speed. Cloud models are subjects whose checkpoint and quant are "provider-opaque". |
| D3 | Who starts engines | Only the `inference-engines` launcher. The runner calls it for recipes and for **generic recipes** (`generic/vllm`, `generic/llama.cpp`, …) that take a Hugging Face link as a parameter. Cloud targets need no launcher. A bare `--endpoint` is allowed but gets marked "unverified identity". |
| D4 | Where suites live | All suite definitions move to `inference-benchmarks/suites/`. Engine-specific checks (fidelity command, a recipe's frozen tool-call workload) stay in the recipe, and the runner invokes them. |
| D5 | Where results live | `inference-benchmarks/results/`, keyed by subject. Recipes point at their evidence there instead of committing results under `hardware/…`. Large raw files go to a Hugging Face dataset, pinned by SHA-256. |
| D6 | taste-benchmark | Fold it into `inference-benchmarks` (`suites/taste/` plus a gallery on the site), then archive the repo with a pointer. It has three commits and no demos yet, so this is the cheapest moment. |
| D7 | The TypeSafe / Jev comparison | Keep it as the flagship **`decisions`** suite (headless) and keep the interactive theater as `apps/theater`. It is why people starred the repo. |
| D8 | The standalone "imposter Jev" gateway (`packages/api`) | Keep it as `packages/gateway`. It becomes the **adapter that lets any chat LLM take the decision suites** (`json-schema` and new `logprob` modes). |
| D9 | Ranking rule | Rank inside one suite, one settings profile and one tier. Show 95% intervals and **rank bands**, not strict ordinals. Composite indexes only count subjects that completed every suite in the index. Taste is never merged into scores. It has only the owner's personal ranking. |
| D10 | Toolchain | Node 24 LTS in both TypeScript repos (type stripping, like `inference-engines` today). Python harnesses in pinned `uv` environments. |
| D11 | System One decision models | A first-class subject class with its own **decision protocol** (canonical: TypeSafe's `/v1/systemone` shape; adapters for OpenRouter Decisions, vLLM `/v1/decide`, local encoders). Its suites are `decisions-scenes`, HF-official `typed-decisions`, `s1mb`, `jevbench-public`, `decisions-classic` and `decision-conformance`. See [decision-models.md](decision-models.md). |
| D12 | Calibration and missing metrics | Report KL, Brier and ECE for subjects that return distributions. If a subject can't produce a metric, show N/A (never 0) and leave it off that leaderboard. |
| D13 | Contamination and the Hub | Subjects carry `trained_on` / `overlap` disclosures, and flagged rows are hidden from the default ranking. We export `.eval_results` for Hub-official benchmarks, PR'd automatically only to our own model repos. |
| D14 | Benchmark time budget | Four tiers, timed on the P100's measured 130 tok/s prefill (at 32K) and 28 tok/s decode (MTP-1): `quick` (≈1.1 h), **`core` (≈15.4 h, ranked: about 8 h single-turn + 7.4 h agentic coding)**, `think` (≈6.7 h, ranked separately), `full` (days, unranked). Each category has P0/P1 benchmarks with fixed item-ID lists. The runner measures speed first, projects the run, and drops whole low-priority benchmarks rather than trimming items. See [core-set.md](core-set.md). |
| D15 | How a benchmark request arrives | A link (paper, Hugging Face model, or GitHub recipe) plus a hardware target goes to the **`benchmark-from-link` skill**, in [`.agents/skills/benchmark-from-link/`](../../.agents/skills/benchmark-from-link/SKILL.md). It researches the link, works out quant × engine × hardware with you, reuses or creates the inference-engines recipe (handing third-party repos to `add-recipe-from-link`), writes `subjects/<key>/subject.yaml` + `INTAKE.md`, and runs `quick` then `core` after your go-ahead. |
| D16 | The harness | **`bench` is the single harness.** It owns prompt templates, request shape, the client, capture, answer extraction (including separating thinking output) and scheduling for every subject. External packages (lm-eval's IFEval checkers, math-verify, EvalPlus, bfcl-eval, LCB, S1MB via a replay adapter) only **score captured outputs offline**. Each suite is calibrated against its official harness on the reference subject before it is marked `ready`. Agentic suites run through the agent harness (D17). See [harness.md](harness.md). |
| D17 | The agent harness | Agentic suites (Terminal-Bench, SWE-bench Pro, τ², agentic taste) run in **one strong agent harness**, frozen and identical for every subject. It runs inside **Harbor** (Apache-2.0), with `bench` as a recording proxy on the wire. The harness is chosen by a **bake-off** (Pi, OpenHands SDK, Goose, OpenCode, with Terminus-2 as baseline) on pass rate within a token budget, then pinned. **Default is Pi** (minimal prompt, so the lowest token cost; TypeScript; has a Harbor adapter) until the bake-off runs. Configuration: native tool calls, compaction relative to each subject's context, ripgrep code search, no web access, turn and token budgets rather than wall-clock, prefix caching required. Core adds 20 Terminal-Bench (P0) and 10 SWE-bench Pro (P1) tasks, about 7.4 h on the P100. See [harness.md](harness.md#the-agent-harness). |
| D18 | Fidelity thresholds | Starting values against the reference: **broken** (top-1 < 0.80 or KL > 0.5) stops the run; **degraded** (top-1 < 0.90 or KL > 0.10) ranks for quality but not for speed; **faithful** is eligible for speed rankings; **lossless** (top-1 ≥ 0.99, KL ≤ 0.01) is required for speed-only flags such as MTP-1. To be revisited after the first reference runs. See [benchmarks.md](benchmarks.md#portable-fidelity-check-new). |

## Open questions

All resolved on 2026-10-06 except Q6, which is a standing rule.

| # | Question | Answer |
| --- | --- | --- |
| Q1 | Repo name | `iammrduncan/inference-benchmarks`, pairing with `iammrduncan/inference-engines`. |
| Q2 | Site host | **Cloudflare Pages**, building the static export from the repo. Cloudflare's `_headers` file sets the taste gallery's CSP as a real header, not only a `<meta>` tag. |
| Q3 | The gateway | Keep it: it is the decision-protocol adapter for chat LLMs (D8). |
| Q4 | Taste votes | **No public voting.** The owner ranks taste demos personally (`suites/taste/ranking.yaml`), shown as "Owner's ranking" and never merged into scores. |
| Q5 | Card-tier cloud spend | Not a planning question. The owner sets up keys and budgets when needed; the runner keeps its `--budget-usd` cap. |
| Q6 | P100 Qwen work | **Publish its scores, with the engine marked "private engine, not reproducible".** The engine code stays private. See [subjects-and-results.md](subjects-and-results.md#private-engines). |
| Q7 | Hosted latency from a same-region VM | **No.** Latency is measured from wherever the runner runs, with that location recorded in `run.json`. |
| Q8 | Private sealed decision set | **Yes.** `decisions-sealed`: about 100 owner-labeled cases in a private repo, with item hashes and scores public and an exposure log. See [core-set.md](core-set.md). |
| Q9 | Size of typed-decisions | **400 test cases × 5 questions = 2,000 decisions** (100 per workflow across 4 workflows), checked on the Hub at revision `d0e2f0c` (2026-10-01). The `all` config is the four workflows combined, not extra data. |

## Order of work

The build is ordered as milestones M0–M8 in [build-plan.md](build-plan.md):

| Milestone | What gets built |
| --- | --- |
| M0 | Rename the repo, tag `typesafe-v1` (owner) |
| M1 | Restructure without changing behavior |
| M2 | `bench` core: identity, run records, and the first cloud decision runs (the first vertical slice) |
| M3 | Launcher `--json` and the private catalog (in parallel with M2) |
| M4 | Recipe targets, engine health, single-turn suites, calibration |
| M5 | Recording proxy, Harbor, agent-harness bake-off |
| M6 | Site on Cloudflare Pages |
| M7 | First comparison sets (P100, Qwen matrix, decision models) |
| M8 | Fold in taste, move suites out of inference-engines, sealed set, cleanup |

The phase table in [repo-organization.md](repo-organization.md#migration-order)
gives the same order from the point of view of the repos.
