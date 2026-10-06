---
name: benchmark-from-link
description: Turn a link (a research paper, a Hugging Face model, or a GitHub recipe/engine repo) plus target hardware into a benchmarked subject. It researches how to run the model, works out the quant, engine and hardware with the user, creates or reuses the inference-engines recipe, writes the subject records here, runs the tiered benchmarks, and stores the results. Use when the user shares a paper, HF or GitHub link and asks to benchmark, evaluate, run or "add" that model, or says which hardware to run it on.
---

# Benchmark from a link

> **Status.** Moved into the repo in M1 (2026-10-06). Steps that depend on the
> `bench` runner, `subjects/` and `results/` work once M2 lands; until then follow
> the "Runner status" note in step 6.

You get **one link**, and usually a hardware target ("run this on the P100", "on the
Sparks", "on the ESP32"). You end with:

- a pinned **subject** (model × checkpoint × quant × engine × hardware);
- a recipe in `inference-engines` that can run it;
- its records in this repo;
- benchmark results, or a precise handoff if something blocks you.

Read first:
- the plan in [`docs/organize/`](../../../docs/organize/README.md): `core-set.md`, `subjects-and-results.md`, `benchmarks.md`, `harness.md`;
- [references/hardware-fit.md](references/hardware-fit.md) for sizing;
- [references/records.md](references/records.md) for the files you write.

The sibling repo's skill `inference-engines/.claude/skills/add-recipe-from-link/SKILL.md`
owns recipe creation for third-party repos. Follow it; don't re-implement it.

## Rules

- **The user makes the expensive or irreversible choices.** These need an explicit
  go-ahead on the printed plan:
  - the quant, engine and hardware choice;
  - flashing a device;
  - downloads over ~20 GB;
  - spending a cloud budget;
  - any run over ~1 hour.

  Research and drafting files need no approval.
- **Never accept a license for the user.** Gated or non-commercial weights go through
  the launcher's acknowledgment flow, with the user's own token.
- **Never guess, never invent numbers.**
  - Unconfirmed pins, licenses and sizes stay `TODO`.
  - Numbers from a paper or model card are recorded as **reported, with their source
    and settings**. They are never mixed with our measurements.
  - Speed and fit predictions are labeled as estimates.
- **Never touch upstream.** Don't edit, fork, open issues or PRs on, or contact the
  author of, any repo or model you were linked to. Suggest a courtesy note to the
  user at the end; they decide.
- **Private engines: publish scores, never the engine.** For example, the P100
  Qwen 3.8 27B engine.
  - Set `engine_visibility: private`. Its results are published with the badge
    "private engine, not reproducible".
  - Never link the engine's repository or commit, and never push its code or its
    recipe to a public remote. The recipe for a private engine lives on a private
    branch or in a private repo.
- **Keys come from 1Password.** Run cloud subjects under
  `op run --env-file=benchmarks.env.op -- …` (vault `benchmarks`, note `keys`).
  Never print, store or commit a resolved key. If a provider's field is missing,
  ask the owner to add it to the note.
- **One repo per PR, provider first.** Land the `inference-engines` change before
  the `inference-benchmarks` records that pin it. Work on branches. Commit or push
  only when the user asks.

## Step 1: classify the link

| Link looks like | Kind | Go to |
| --- | --- | --- |
| `arxiv.org/abs/…`, `openreview.net`, a PDF, a lab blog post announcing a model | **paper** | 2a |
| `huggingface.co/<org>/<repo>` (model), or a collection | **hf** | 2b |
| `github.com/…` with launch scripts for a specific device and model (`start.sh`, compose files, a Makefile with `serve`/`flash`, a `recipe.yaml`) | **recipe** | 2c |
| `github.com/…` holding model or training code, not a way to serve it | treat as **paper**: find the weights | 2a |
| An `inference-engines` recipe ID, or a folder path | existing recipe | 4 |

If the user gave no hardware target and the link doesn't imply one, **ask** (offer
the hosts in `~/.config/inference-engines/inventory.yaml`). Don't pick one yourself.

## Step 2: research

Record your findings in the subject's `INTAKE.md` as you go (see records.md).

### 2a. Paper

1. Read the paper, not only the abstract. Extract:
   - model name(s) and sizes, and the architecture (anything non-standard:
     MoE, hybrid attention/SSM, custom heads, new tokenizer);
   - context length;
   - **released artifacts**: weights, code and license, and the links to them;
   - evaluation settings: prompt format, sampling, thinking mode, harness;
   - **reported scores** for any benchmark in our catalog.
2. Follow the links to the weights. If **no weights are released**, stop. Report
   that it can't be benchmarked locally, and say whether a hosted API exists
   (which can be a `--cloud` subject instead).
3. Continue with 2b for each released checkpoint the user cares about. If there are
   several sizes, ask which, and suggest the largest that fits the hardware.

### 2b. Hugging Face model

1. Pin the revision: the commit SHA via `hf` (load the `hf-cli` skill) or the Hub
   API. Read:
   - the model card;
   - `config.json`: architecture, layers, hidden size, attention and KV heads,
     head dim, context, dtype, `quantization_config`;
   - `generation_config.json` and the chat template;
   - the license and whether it is gated;
   - the file list with sizes.
2. Map the **model tree**. Find the existing quantizations through the card's
   "Quantizations" tree, and search `<model> GGUF / AWQ / GPTQ / EXL2|EXL3 / MLX /
   FP8 / NVFP4`. Note who produced each one and its revision. Prefer the official
   ones, then the well-known quantizers. Record each one's file hashes.
3. Check engine support for the architecture on the target hardware: vLLM,
   llama.cpp, SGLang, MLX, ExLlama. Use release notes or the supported-models
   lists, and give the source for each. A new architecture often isn't supported
   by any engine on older GPUs yet. Say so early.
4. Note the **recommended sampling and thinking** settings from the card. They
   become the `card` settings profile.
5. Note any **training-data disclosures** (for `trained_on` / `overlap`), especially
   for decision models and our decision suites.

### 2c. GitHub recipe

1. Pin the default-branch commit (`git ls-remote <repo> HEAD`). Read the README,
   LICENSE, the launch scripts and any pins file. A recipe usually **states** the
   hardware, quant and engine. Take them from there instead of picking your own.
2. Is it **ours** (`iammrduncan/*`: `esp32-needle-3`, the P100 work)?
   - Our repos follow, or should follow, the native engine format
     (`inference-engines/docs/rollout-plan.md` §6). The recipe is
     `integration: native`.
   - If the repo isn't in that format yet, list what's missing (entry points, pins,
     `IE_*` inputs) and ask whether to fix it in that repo first.
3. Is it **someone else's**? Run the `add-recipe-from-link` procedure in
   `inference-engines`. It writes the manifest, the adapter or a `HANDOFF.md`, at
   `status: unverified`.
4. Check that the user's inventory actually has the hardware the recipe needs.
   If it doesn't, say so and stop, or propose the closest hardware they have, as a
   new subject.

## Step 3: work out the subject with the user (paper and hf; confirm-only for recipes)

Using [references/hardware-fit.md](references/hardware-fit.md), put **2–4 concrete
options** in front of the user. Each option is:

- a quant (with its source repo and revision);
- an engine (with version or image);
- a hardware target from the inventory;
- context and settings;
- an estimated fit (weights + KV + overhead vs. memory);
- an estimated decode tok/s, labeled as an estimate;
- the projected `core` tier hours (from `core-set.md`'s formula and the
  envelope);
- the quality risk (bits, known issues with this quant);
- whether a recipe exists.

Recommend one, and say why. Also propose the **reference subject** for this
checkpoint (release precision on vLLM, or a hosted API) if it isn't already in
`results/references.yaml`. Without a reference there are no deltas. If none of our
hardware can hold the reference, say so and suggest a cloud or Spark run.

Use AskUserQuestion when the options are clear-cut. Write down the decision and the
rejected options, with a one-line reason each, in `INTAKE.md`.

## Step 4: find or create the inference-engines implementation

Work in the sibling checkout (`INFERENCE_ENGINES_DIR`, default `../inference-engines`).

1. `npm run launcher -- list` (plus `show <id>`). Is there already a recipe that
   runs this exact subject, or that covers it with params (the planned `generic/vllm`,
   `generic/llama.cpp`, `generic/mlx-lm` and `generic/encoder-decision` templates)?
   If so, **reuse it**: the subject is that recipe + params.
2. If not, create one, on a branch:
   - a third-party repo: the `add-recipe-from-link` procedure;
   - our own engine: a native recipe under `hardware/<hw>/<model>/<variant>/`;
   - a standard engine with no template yet: a recipe that pins the engine image
     digest and the weights revision and hashes, with `fetch` / `serve` / `health`
     steps.

   Include the `identity` block, purpose, endpoint (`openai` or `decision`),
   `engine_metrics` if the engine exposes metrics, and a `fidelity` command if a
   reference implementation exists.
3. `npm run launcher -- validate` and `npm test` must pass.
   `npm run launcher -- check <id> --on <host>` shows the run plan. Read the plan's
   disclosure (privileges, device writes, downloads) back to the user.
4. Status stays `unverified` until step 6 produces evidence on the listed hardware.

## Step 5: write the subject records here

Create `subjects/<subject-key>/subject.yaml` and `INTAKE.md`, as described in
[references/records.md](references/records.md):
- the resolved identity;
- the source link and kind;
- the reference subject;
- the categories selected by purpose;
- reported (card or paper) numbers with sources;
- `trained_on` / `overlap`;
- the decision log from step 3.

## Step 6: plan, then run

1. **Plan.** Print the run plan:
   - target;
   - tiers (`quick`, then `core`; `think` only for thinking models, and only if
     the user wants it);
   - categories;
   - projected hours using the measured speed when there is one, otherwise the
     envelope;
   - downloads;
   - cost cap for cloud runs.

   **Wait for an explicit go-ahead.**
2. **Quick first.** Bring the recipe up and run `quick`.
   - If engine health fails (fidelity outside tolerance, or the endpoint broken),
     stop and report. Don't spend 7 hours on a broken subject.
3. **Core.** Run `core` with `--budget-hours 24`.
   - If the time planner proposes dropping benchmarks, show the user the proposal;
     they accept or change it.
   - Run long jobs in the background with checkpoints. Don't poll in a tight loop.
   - Report progress at each benchmark boundary.
4. **Bring it down.** `launcher down <id>`, even after a failure. Release device
   locks.

**Runner status.** The `bench` CLI (`bench plan` / `bench run` / `bench summarize`) is
specified in `docs/organize/repo-shift.md` and built in milestone M2. Check
`npm run bench -- --help` first. If it doesn't exist:
- For recipes, run what exists today:
  `npm run launcher -- bench <id> --suite perf|tool-calls|fidelity --tier smoke` in
  `inference-engines`.
- For anything else, stop after step 5 and hand back the exact commands that will
  run once the runner lands.

Don't hand-roll a substitute harness and present its numbers as suite results.

## Step 7: store results and close out

1. Run records go under `results/<subject-key>/<suite>/<run-id>/`, following
   records.md: `run.json`, `summary.json`, `raw.jsonl` or a pointer for raw data
   over 5 MB. Check that `summary.json` recomputes from raw.
2. If this run is the recipe's first passing evidence on its listed hardware,
   update `evidence:` in the recipe (as links here). Change `status` only by the
   recipe-format rules, and only for hardware that actually ran.
3. Optional: if the suite is Hub-official and this is **our own** model repo, prepare
   the `.eval_results` export. For anyone else's model, only offer it to the user.
4. Hand back:
   - the subject key;
   - what ran and what didn't (with reasons);
   - headline results with intervals, next to the reference and the reported
     numbers, clearly separated;
   - TODOs;
   - open PRs or branches;
   - the courtesy-note suggestion for third-party authors.
