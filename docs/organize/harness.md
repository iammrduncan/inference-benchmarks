# The harness

## The premise

A benchmark score is never "the model's" score. It is the product of four things:

| Factor | What varies | How we treat it |
| --- | --- | --- |
| **Model** | architecture, training | the thing people think they're comparing |
| **Version** | checkpoint revision, quant format and scheme, who quantized it | **varied and measured**: part of the subject |
| **Engine** | kernels, sampling implementation, chat-template handling, KV-cache precision, speculative decoding, structured-output and tool-call parsing | **varied and measured**: part of the subject |
| **Harness** | prompt wording, few-shot examples, how the request is built, output caps and stop sequences, how answers are extracted and scored, retries, timeouts; and for agentic tasks, the agent loop itself | **held constant**: one measuring harness (`bench`) for everything, and one frozen, strong agent harness for every agentic task |

The first three are what the leaderboard compares. The harness is the measuring
instrument. If it changes between two rows, the difference between those rows
means nothing. So the harness gets a version, and two scores are only compared when
they were made with the same harness version.

## Where the plan stood

Before this document, the plan used about eight different harnesses:
- our runner for perf, tool calls and decisions;
- lm-evaluation-harness for general;
- EvalPlus;
- bfcl-eval;
- the LiveCodeBench and Aider harnesses;
- the S1MB and JevBench harnesses;
- taste-benchmark's runner.

Each one builds its own requests, sends them through its own client, uses its own
prompt templates, and extracts answers in its own way. That violates the premise:
a quant that looks worse in `general` than in `coding` might only be showing that
lm-eval and EvalPlus parse answers differently.

## Decision: one harness generates, pinned official scorers grade

**The harness is `bench`**, the runner in `inference-benchmarks`.

> **What `bench` is.** It is our own custom harness, and **it doesn't exist yet**:
> `bench` is the name (decided 2026-10-06) of the command-line tool we will write in
> `inference-benchmarks/runner/`. It is not an existing open-source project, so there
> is nothing to link to. It is built mostly from code we already have:
> - the streaming client plus the `perf` and `tool-calls` runners in
>   `inference-engines/launcher/src/bench.ts`;
> - the decision contracts, Jev mapping and Cerebras structured-output client in
>   `typesafe-ai-benchmark/packages/`;
> - taste-benchmark's isolated task runner.
>
> See [repo-shift.md](repo-shift.md) for where each piece lands.

 It owns every request
sent to every subject, for every suite. External packages are used only as
**offline scorers** on outputs that `bench` captured.

```
           ┌──────────────────────── bench (the harness) ────────────────────────┐
 dataset → │ prompt template → request builder → client → capture → extraction   │ → raw.jsonl
 (pinned)  │  (per suite,       (profile, caps,   (openai |  (every byte,  (per suite, │
           │   in repo, hashed)  stops, no retry)  decision |  timings)      versioned) │
           │                                       anthropic)                         │
           └─────────────────────────────────────────────────────────────────────┘
                                                                     │
                                                                     ▼
                              scorer (pinned package, offline, sandboxed) → summary.json
```

### What `bench` owns, identically for every subject

1. **Prompts.** One prompt template per suite, kept in the repo
   (`suites/<suite>/prompt/`) and hashed into the harness version. Each template
   follows the benchmark's own reference prompt (MMLU-Pro's 5-shot CoT format,
   GPQA's zero-shot, and so on) and is written down once, not inherited from
   whichever library happens to be installed.
2. **Request shape.**
   - Chat Completions messages, with the chat template applied by the **engine**
     (see "Chat templates" below).
   - One request per item, or per case for typed-decisions, where all five
     questions go in one request.
   - The settings profile's sampling, output cap and stop sequences.
   - Tools for tool suites, and `response_format` for structured suites.
3. **The client.**
   - A single client per protocol: `openai`, `decision` and `anthropic`.
   - Streaming where the subject allows it, with time to first token (TTFT) taken
     from the first content, reasoning or tool-call delta (the client already in
     `inference-engines`).
   - The same timeout for every subject.
   - **Zero retries.** A failure is recorded as a failure.
4. **Capture.** Request, response bytes, timings, usage, `reasoning_content`,
   tool calls and errors all go to `raw.jsonl`. Scoring never calls the subject
   again.
5. **Answer extraction.** Each suite has one versioned extractor. Examples: the
   last `Answer: X` for multiple choice; `math-verify` normalization for MATH;
   the code block for HumanEval+; the parsed tool calls for BFCL.
   - **Thinking output** (`reasoning_content`, or `<think>` blocks in content) is
     separated the same way for every engine before extraction. Engines disagree
     about where they put it, and that must not change a score.
6. **Scheduling.** The time planner, the P0 → P1 order, checkpoints and resume.

### What external packages still do: score offline

| Suite | Scorer (pinned, run offline on captured outputs) | Input `bench` writes |
| --- | --- | --- |
| MMLU-Pro, GPQA | our multiple-choice extractor + exact match (checked against lm-eval's numbers, see "Calibrating the harness") | `raw.jsonl` |
| IFEval | Google's `instruction_following_eval` checkers (as packaged in lm-eval), called on the responses | `responses.jsonl` |
| MATH-500, AIME | Hugging Face `math-verify` | `raw.jsonl` |
| HumanEval+ | `evalplus.evaluate --samples` in a sandbox container | `samples.jsonl` |
| LiveCodeBench | LCB's custom-evaluation entry point on a generations file | `generations.json` |
| BFCL v4 | `bfcl-eval`'s evaluator on result files in its format | `result/*.json` |
| RULER | RULER's string-match metrics (small; ported) | `raw.jsonl` |
| typed-decisions, sealed, classic, scenes, conformance | ours: accuracy, KL, Brier and ECE, using the dataset card's definitions | `raw.jsonl` |
| S1MB | the S1MB harness with a **replay adapter** that returns our captured distributions instead of calling a model | `raw.jsonl` |
| JevBench public | JevBench's quality metrics on our captured answers | `raw.jsonl` |
| Taste | none: the gallery and the owner's ranking | `index.html`, `response.md` |

### Agentic suites use the agent harness (next section)

Some benchmarks can't be split into "generate, then score", because the model works
inside an environment over many turns: Terminal-Bench, SWE-bench, τ²-bench and
agentic taste. They don't get an ad-hoc harness each. They all run through **one
frozen agent harness**, inside one execution framework, with `bench` still on the
wire. See below.

## The agent harness

### Two layers, two jobs

| Layer | Job | Requirement |
| --- | --- | --- |
| **Measuring harness** (`bench`) | Builds requests, records every byte, extracts and scores. It is the meter. | **Thin and neutral.** It must not help or hurt any model. |
| **Agent harness** (the coding agent the model works inside) | The agent loop: context management and compaction, tool calling, code search, file editing, running tests, planning | **As strong as we can make it.** A weak scaffold hides what a model can do. The scaffold changes results a lot (below), so it is chosen carefully, then frozen and identical for every subject. |

Why it matters, from current evidence:
- **Pass rate.** The same model has been reported scoring very differently in
  different scaffolds on Terminal-Bench 2.0 (Letta Code 59.1% vs. Claude Code
  41.6% on one model, as read from the leaderboard).
- **Token cost.** A controlled study
  ([arXiv 2607.22585](https://arxiv.org/abs/2607.22585)) ran Goose, OpenCode and
  OpenHands-SDK on 50 Terminal-Bench Pro tasks:
  - pass rates differed by only 0–8 points per model;
  - **tokens per solved task differed by up to ~40×** (≈ 28K for Goose vs. ≈ 0.8–1.5M
    for the others, as reported).

On the P100's 130 tok/s prefill, that token difference is the difference between
minutes and hours per task. For us, **token efficiency is a selection criterion,
not a footnote.**

### The execution framework: Harbor

[Harbor](https://github.com/harbor-framework/harbor) (Apache-2.0, from the
Terminal-Bench team) runs agents headless in containers against benchmark tasks:
- It has adapters for Terminal-Bench 2.x, SWE-bench / SWE-bench Pro, Aider Polyglot,
  τ³-bench and others.
- It has built-in agents: OpenHands, OpenCode, Codex CLI, Claude Code, Terminus-2,
  and more.
- It runs on Docker locally, or on cloud sandboxes.

Each task's own tests verify the result, so Harbor provides **both the environment
and the scorer** for agentic suites. We pin its version, just as we pin every other
scorer.

### `bench` stays on the wire: the recording proxy

The agent never talks to the subject directly:

```
Harbor task container ──► agent harness (frozen) ──► bench proxy ──► subject endpoint
                                                       │ records every request/response,
                                                       │ timings, tokens, cache hits
                                                       ▼
                                                    raw.jsonl  +  Harbor trajectory + verifier result
```

The proxy is OpenAI-compatible, plus the decision and Anthropic protocols when
needed. It forwards unchanged and logs the bytes. So even inside an agent loop:
- every token the subject saw and produced is captured the same way as in
  single-turn suites;
- per-task cost (prefill tokens, decode tokens, cache-hit rate, turns) comes from
  the wire, not from what the agent reports.

### Choosing the agent harness: a bake-off, then freeze

We don't pick by reputation.

1. **Candidates:**
   - **Pi** ([`earendil-works/pi`](https://github.com/earendil-works/pi), formerly
     `badlogic/pi-mono`; MIT; TypeScript):
     - It is deliberately minimal: read, write, edit and bash tools, and a system
       prompt under ~1,000 tokens.
     - Automatic compaction near the context limit.
     - It works with any provider, including llama.cpp and vLLM.
     - Its author maintains a Harbor adapter
       ([`badlogic/pi-terminal-bench`](https://github.com/badlogic/pi-terminal-bench)).
     - With Claude Opus 4.5 it placed around 8th on Terminal-Bench 2.0 (reported).
   - OpenHands (SDK): context condenser, sub-agents;
   - Goose: by far the most token-efficient in the study above;
   - OpenCode: model-agnostic, MIT, widely used with local llama.cpp and vLLM;
   - Terminus-2: Terminal-Bench's own minimal harness, as a neutral baseline.

   Codex CLI and Claude Code are left out of the core choice. Each is tuned for its
   vendor's models, which would tilt a cross-model comparison. They can still
   appear in an optional harness-comparison suite.
2. **Bake-off:**
   - 30 Terminal-Bench 2.x tasks + 10 SWE-bench Pro tasks, fixed IDs.
   - Two reference subjects: one strong hosted model, and Qwen 3.8 27B on vLLM BF16
     on a Spark (an open model on a local engine).
   - Every candidate gets the same container, tools and budgets.
3. **Rule:**
   - Highest mean pass rate across both subjects, among candidates whose median
     **new prefill tokens per task fits the P100 budget**: ≤ 50K new prefill
     tokens and ≤ 12K output tokens per task, about 14 min per task on the P100 (see
     [core-set.md](core-set.md)).
   - Ties go to fewer tokens.
   - Commit the bake-off runs as evidence.
4. **Freeze.** Pin the chosen harness's version (and container digest) together
   with its config:
   - system prompt;
   - tool set: shell, file read/edit, ripgrep code search, test runner;
   - compaction threshold;
   - turn and token budgets.

   All of these hash into the suite version. Re-run the bake-off only when we
   deliberately upgrade, which creates a new suite version.

**Default until the bake-off runs: Pi.**
- **Smallest overhead.** Its tiny system prompt and four tools keep the per-turn
  token cost lowest. That is what decides agentic runs on the P100's 130 tok/s
  prefill.
- **Strong anyway.** It has shown strong Terminal-Bench results despite being
  minimal.
- **Same language.** It is TypeScript like `bench`, so extensions and config live in
  the same toolchain.
- **Ready to run.** A Harbor adapter already exists.

OpenHands is the runner-up: richer context management, and first-class in Harbor.

**Things to check during the bake-off:**
- **Code search.** Pi has no dedicated code-search tool. It searches with `rg`
  through bash, so the container image must include ripgrep.
- **Small local models.** Its minimalism may give weaker small models less
  guidance than OpenHands does.
- **Compaction settings.** Confirm the pinned version's automatic-compaction
  defaults, because sources differ on them.

### The frozen configuration: "give it the best it can"

- **Native tool calling** through the engine's tool-call parser. That parser is part
  of engine quality, and the template check already covers it.
  - If a subject can't do native tool calls, it runs the harness's text-based tool
    format. That fallback is recorded as a mode and shown on its own rows.
- **Context management on.** Compaction (condensing) triggers at a fixed fraction
  of **the subject's own context window**, which is the only per-subject setting.
  The harness never assumes 200K context on a 32K model.
- **Code search and navigation:** ripgrep, file tree, file view and edit, running
  tests. Every subject gets the same tools. With Pi, these come through bash plus
  ripgrep in the image, not dedicated tools.
- **No web access.** The task container's network policy follows the Harbor task,
  usually package mirrors only. An agent that can search the web can find
  benchmark answers. "Searching" here means searching the code.
- **Budgets by turns and tokens, not wall-clock.** A slow card must not fail a task
  just because it is slow. Each task gets a turn cap and a token cap. The wall-clock
  timeout scales with the subject's measured speed and only exists to catch hangs.
  Wall time is still recorded and reported separately as speed.
- **Prefix caching is required.** In an agent loop, each turn resends the growing
  context.
  - With KV prefix reuse, only the new tokens are prefilled.
  - Without it, a 25-turn task re-prefills hundreds of thousands of tokens, which
    on the P100 is about an hour per task.

  The runner records the cache-hit rate. If a subject's engine has no prefix
  caching, the planner shows the projected cost and usually drops the agentic
  suites to fit the budget.

### Agentic taste

`taste` stays single-turn in `core`: one request, cheap and comparable. The agentic
version, `taste-agent`, gives the same brief to the **same frozen agent harness**,
with a browser-free sandbox and file tools, so a model can iterate on its page.

The earlier idea of varying harnesses (Claude Code vs. Codex) moves to an optional
`harness-comparison` suite. There, the harness is part of the subject and labeled so.

## Chat templates are part of engine quality

Through `/v1/chat/completions`, the **engine** turns messages into tokens. Engines
get this wrong regularly: stale templates, a missing BOS token, broken tool-call
or thinking markup. That is a real engine-quality difference, and the plan keeps it
in the measurement, but it should be caught, not hidden. A new **P0 engine-health
check, `template`**, does three things:

1. Renders a fixed set of conversations (plain, system prompt, multi-turn, tools,
   thinking on/off) through the engine. vLLM can do this with `/tokenize` using
   chat messages, and llama.cpp with `/apply-template`.
2. Compares the result with the checkpoint's own template rendered by
   `transformers` at the pinned revision.
3. Reports `match`, `differs` (with a diff) or `unavailable` (engine can't render).

A `differs` result doesn't block the run. It is shown on the subject page and in
the model matrix, so a quant or engine whose scores dropped because of its template
says so. Raw-completion mode, where the harness applies the template itself, is not
used in `core`: it would hide exactly the engine behavior we're measuring.

## Calibrating the harness

A harness we wrote ourselves needs evidence that it measures what the official
harness does. Before a suite is marked `ready`:

1. Run its `core` items on the **reference subject**.
2. Run the same items through the benchmark's official harness (lm-eval, EvalPlus,
   bfcl-eval, …) with matching settings.
3. The two scores must agree within the 95% interval. Commit both runs, under
   `suites/<suite>/calibration/`.

If they disagree, `bench` is fixed, or the difference is documented as deliberate,
for example a prompt fix. This is done once per harness version, not per subject.

## Harness version

The run record carries the harness version as a first-class pin:

```json
"harness": {
  "name": "bench", "commit": "<inference-benchmarks sha>",
  "suite_hash": "<suite.yaml + core.ids + prompt templates + extractor>",
  "scorer": {"name": "evalplus", "version": "0.3.1"},
  "agent": null   // agentic suites: {"framework": "harbor@<ver>", "harness": "openhands@<ver>",
                  //   "image": "<digest>", "config_hash": "<prompt+tools+compaction+budgets>"}
}
```

- **Version-specific leaderboards.** A leaderboard shows only runs whose
  `suite_hash` matches. A change to a prompt, an extractor or a scorer creates a new
  suite version, and older runs stay on the older version's board.
- **Not part of the subject key.** The harness is held constant rather than
  compared, so it isn't in the key. The "Δ vs reference" column is computed only
  when both runs share the same `suite_hash`.

## Considered and not chosen

- **Inspect AI as the harness.** It has broad eval coverage and good transcripts,
  but it is Python while the repo, the theater and the runner are TypeScript. The
  decision protocol, perf, taste and the time planner would still be custom. We would
  end up with two harnesses again. Its eval implementations remain a useful
  cross-check during calibration.
- **lm-evaluation-harness for everything.** Its chat-completions path is
  generation-only for API models, and it covers neither tool calling, decisions
  nor taste.
- **Each agentic benchmark's own reference harness** (SWE-bench's scaffold,
  τ²'s agent, Terminal-Bench's Terminus). That would be three different agent loops
  of uneven strength. Harbor plus one frozen harness keeps the agent constant across
  every agentic suite.
