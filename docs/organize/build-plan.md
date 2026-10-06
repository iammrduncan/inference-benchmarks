# Build plan: from proposal to first runs

Status, 2026-10-06:
- All planning questions are answered (README Q1–Q9).
- Decisions D1–D18 are in [README.md](README.md).
- This file turns them into an ordered build, from the repo rename to the first
  P100 `core` run.

Each milestone has:
- a single **done when** check that can be run;
- the repo it touches;
- the work, in order.

Milestones are sequential unless marked *parallel*. Every change follows the
cross-repo rule: one repo per PR, provider side first, on branches, committed or
pushed only when the owner says so.

## Prerequisites

Checked on the owner's Mac on 2026-10-06.

| Need | For | Status here | Action |
| --- | --- | --- | --- |
| Node 24 LTS | both TypeScript repos (TypeScript runs directly) | v24.21.0 via nvm (v22.15 is the default) | `nvm use 24`, or add `.nvmrc` = `24` to both repos |
| `flock` (util-linux) | launcher device locks; 8 launcher tests fail without it | **missing** on macOS | `brew install flock`, or run launcher tests on Linux hosts |
| Docker | Harbor (agentic suites), the taste runner, the code sandbox | Docker 29.2.1 | none |
| Podman | P100 engine recipes | 5.8.2 | **Risk:** confirm Harbor works with Podman on the P100 host (M5) |
| uv | pinned Python scorers | 0.9.3 | none |
| `hf` CLI + token | Hub pins, gated datasets (GPQA), the raw-data dataset | 1.32.0 (2.1.1 available) | `hf auth login` with a token that has accepted GPQA's terms |
| ripgrep | Pi's code search inside task images | 14.1.1 locally | bake into the agent task images (M5) |
| `wrangler` or the Cloudflare dashboard | Cloudflare Pages deploy | **missing** | the Pages project can connect to GitHub directly; `wrangler` is optional |
| API keys | cloud subjects | **1Password vault `benchmarks`, secure note `keys`**, fields `cerebras` and `jev_key`. Both references were checked and resolve (2026-10-06) | Run with `op run --env-file=benchmarks.env.op -- …` (see [Secrets](#secrets)). Add fields when new providers are benchmarked |
| Launcher inventory | recipes on real hardware | **none** at `~/.config/inference-engines/inventory.yaml` | write one per host (ESP32 board, P100 box, Sparks), from `launcher/inventory.example.yaml` |

Done already (2026-10-06):
- The three old `Hackers-in-the-Loop` links were fixed in working trees, not yet
  committed:
  - `inference-engines/schema/recipe.schema.json` (`$id`);
  - `taste-benchmark/README.md`;
  - `taste-benchmark/app/layout.tsx`.
- With Node 24, `launcher validate` reports **2 recipes, 0 problems**. `npm test`
  passes 20 of 28; the 8 failures are all the missing `flock` above, and none come
  from these edits.

## Secrets

API keys live in **1Password**, never in files or records:

- **Location:** vault `benchmarks`, secure note `keys`.
- **References:** `op://benchmarks/keys/cerebras` (→ `CEREBRAS_API_KEY`) and
  `op://benchmarks/keys/jev_key` (→ `JEV_KEY`, the name the theater and the
  decision provider read).
- **Template:** [`benchmarks.env.op`](../../benchmarks.env.op), at the repo root,
  maps references to variable names. It contains no values, so it is safe to
  commit. Run the commands below from the repo root.
- **Running:**
  ```sh
  op run --env-file=benchmarks.env.op -- bench run --cloud typesafe:jev-latest --suite typed-decisions --tier quick --budget-usd 2
  op run --env-file=benchmarks.env.op -- npm run start:demos:live   # the theater, without a plaintext .env
  ```
- **Rules:**
  - `bench` reads keys only from its environment. It passes them to containers as
    environment variables.
  - It never writes a key into `run.json`, raw data, logs or the proxy capture: the
    proxy redacts `Authorization` and `x-api-key` headers before logging.
  - No resolved key is ever written to disk. The plaintext `.env` in
    `typesafe-ai-benchmark/` becomes unnecessary and can be deleted once the theater
    runs under `op run`.
- **New provider:** add a field to the note (for example `anthropic`, `openrouter`
  or `hf`), then a line in `benchmarks.env.op`.

## M0 · Rename and freeze the old state

**Repo:** typesafe-ai-benchmark → inference-benchmarks

Progress as of 2026-10-06:

| Step | Status |
| --- | --- |
| Rename to `iammrduncan/inference-benchmarks` | **done** (owner). Checked with `gh`: the repo resolves, with 38 stars (40 were recorded on 2026-09-29; renames keep stars, so this is ordinary churn) |
| Local remote in `typesafe-ai-benchmark/` points to the new URL | **done** (the local folder keeps its old name until M1) |
| Tag `typesafe-v1` on `main` (`cf348cd`) and create a GitHub release linking the README, video and `docs/benchmarks/` | open |
| Update the description (it still reads "LLM Gateway that mimics typesafe ai…") and add topics; text in [repo-shift.md](repo-shift.md) | open |
| Commit the three link fixes in `inference-engines` and `taste-benchmark` | open |
| Update remotes on other hosts that have a clone | open (owner) |

**Done when:** the `typesafe-v1` release exists, the description and topics are
updated, and the link fixes are committed.

## M1 · Restructure without changing behavior

> **Status: done (2026-10-06)**, on local branch `reorg/m1-m3`, not pushed.
> - `npm run check` passes on Node 24.21: theater 39, gateway 32 and decisions 3
>   tests, plus types, lint and builds.
> - The summarize scripts reproduce every committed `docs/benchmarks/**/summary.json`
>   byte for byte.
> - The theater ran live under `op run` and answered through both Qwen on Cerebras
>   and Jev.
> - Historical records keep the paths they were measured with.

**Repo:** inference-benchmarks

1. `.nvmrc` = `24`; set `engines.node` to `>=24`; regenerate the lockfile.
2. Move `packages/demos` → `apps/theater` and `packages/api` → `packages/gateway`.
3. Extract `packages/decisions` (contracts, `traffic.ts`, scene fixtures, Jev
   mapping), imported by both the theater and, later, the runner.
4. Move the planning docs into `docs/organize/`. Move the skill draft to
   `.agents/skills/benchmark-from-link/`, symlinked from `.claude/skills/`.
5. Rewrite the "Mission" in `AGENTS.md` and the "Product contract" in
   `CONVENTIONS.md`, with the premise and the four separate claims (wire
   compatibility, quality, performance, subject identity). Move the TypeSafe API
   table into `packages/gateway/CONVENTIONS.md`.
6. Add a pinned "What changed" note at the top of the README.

**Done when:** `npm run check` passes on Node 24, and `npm run start:demos:live` runs
the theater unchanged against both providers.

## M2 · `bench` core: identity, records, one cloud suite (the first vertical slice)

**Repo:** inference-benchmarks

This is the smallest change that produces a real, publishable record end to end.

1. `runner/` workspace with a `bench` bin. Port `chat()`, `parseProm` and their
   tests from `inference-engines/launcher/src/bench.ts`.
2. `runner/src/identity.ts`:
   - the subject key;
   - Hub revision resolution via the API;
   - file hashing;
   - the cloud identity (provider + model id + month + returned model or
     fingerprint).
3. `runner/src/record.ts`:
   - `run.json` with the harness block;
   - `summary.json` with Wilson and bootstrap intervals;
   - `raw.jsonl`, or a pointer file for raw data over 5 MB;
   - `bench summarize` recomputes the summary from raw data.
4. Providers: `openai-compatible`, `anthropic` and `decision` (canonical
   `/v1/systemone`, ported from `lib/jev.ts`).
5. Suites:
   - `decision-conformance` (the jev-eval checks);
   - `typed-decisions`, with the loader pinned at rev `d0e2f0c` and each case
     sent whole; scoring is accuracy, KL, Brier and ECE using the card's
     definitions.
6. Targets: `--cloud` and `--endpoint`. `--budget-usd` stops the run at the cap.
7. `subjects/` and `results/` folders. `bench subjects` lists them.

**Done when** (prefix each command with `op run --env-file=benchmarks.env.op --`):
```sh
bench run --cloud typesafe:jev-latest --suite decision-conformance,typed-decisions --tier quick --budget-usd 2
bench run --cloud cerebras:qwen-3.8-27b --via gateway:json-schema --suite typed-decisions --tier quick --budget-usd 2
bench summarize results/**/typed-decisions/*   # reproduces summary.json byte for byte
```
- Both runs write valid records.
- Jev's typed-decisions accuracy lands near the dataset card's 0.727 on the
  matching items. This is the **first harness calibration**: if it doesn't match,
  `bench` gets fixed before anything else is built.

## M3 · Launcher interface and private catalog

> **Status: done (2026-10-06)**, on local branch `reorg/m3` in inference-engines, not
> pushed.
> - `npm test` passes **34/34** on Linux (`node:24` with `flock`, under Podman): the
>   original 28 plus 6 new tests for `describe`, `--json`, identity and private
>   catalogs. On macOS without `flock`, the same 8 lock tests fail as before.
> - `validate` reports 0 problems.
> - `describe needle3/esp32-s3/8-layer --json` prints the identity; `--param layers=4`
>   fills the quant scheme.
> - Private recipes never print or record their source; a test asserts this on
>   stdout and in `run.json`.

**Repo:** inference-engines. *Can run in parallel with M2.*

1. `launcher describe <id> --json`, plus `up --detach --json` and `down --json`.
2. Add an `identity` block to `schema/recipe.schema.json` and to both recipes. Add
   `engine_visibility` (`public` or `private`) and the `decision` endpoint protocol.
3. **Private catalog overlay.** `IE_CATALOG_PATHS` (or `catalog_paths` in the
   inventory) adds extra recipe roots, for example a checkout of a private repo
   `iammrduncan/inference-engines-private`.
   - `validate` and `list` cover them.
   - Records for private recipes leave out the source URL and commit.
   - This is where the P100 recipe lives.
4. Add the macOS `flock` prerequisite to `launcher/README.md`, and add `.nvmrc`.

**Done when:**
- `npm test` passes 28/28 on a host with `flock`.
- `validate` reports 0 problems.
- `describe needle3/esp32-s3/8-layer --json` prints the subject identity.

## M4 · Recipe targets, single-turn core suites, calibration

**Repos:** inference-benchmarks (main) + inference-engines (generic recipes)

1. `bench run --recipe <id>` calls the launcher through `--json`, and always runs
   `down`, even after a failure.
2. Engine health:
   - standard `perf` workloads;
   - the **chat-template check**;
   - **portable fidelity**, with the broken / degraded / faithful / lossless
     verdicts (D18).

   A `broken` verdict stops the run before `core`.
3. The time planner: measure, project, fit to `--budget-hours`, require
   `--accept-plan` for a reduced run, P0 → P1 order, a checkpoint per item.
4. Single-turn suites, each with a prompt template, an extractor and committed
   `core.ids` / `quick.ids` lists:
   - MMLU-Pro, GPQA, IFEval, MATH-500, HumanEval+, LiveCodeBench, BFCL, RULER 32K;
   - decisions-scenes, decisions-classic.

   Offline scorers live in `scorers/` (pinned uv projects).
5. In inference-engines, add the `generic/vllm` and `generic/llama.cpp` template
   recipes, so `bench run --hf … --engine …` works.
6. **Calibration.** For each suite, run the reference subject through `bench` and
   through the official harness, and commit both under
   `suites/<suite>/calibration/`. A suite is marked `ready` only when the two
   scores agree.
7. Import the six Needle evidence folders and the theater, Needle and RLCD
   exports as `imported: true` records.

**Done when:**
- `bench run --recipe needle3/esp32-s3/8-layer --tier quick` reproduces the
  committed tool-calls (11/12) and decode evidence within tolerance.
- The reference subject for Qwen 3.8 27B (BF16 on `generic/vllm` on a Spark)
  completes `core` single-turn.
- Every single-turn suite is `ready`.

## M5 · Agentic suites and the agent-harness bake-off

**Repo:** inference-benchmarks

1. `runner/src/proxy/`: the recording proxy. It forwards OpenAI-compatible,
   decision and Anthropic requests, and logs bytes, timings, tokens and the
   prefix-cache hit rate.
2. `runner/src/agentic/`: drives a pinned Harbor version. The agent's endpoint is
   the proxy. Trajectories and verifier results are added to the run record.
3. Task images with ripgrep. Network policy follows each Harbor task, with no web
   search. Budgets are set in turns and tokens; the wall-clock timeout scales with
   the subject's measured speed.
4. **Bake-off:**
   - harnesses: Pi (default), OpenHands SDK, Goose, OpenCode, and Terminus-2 as
     the baseline;
   - tasks: 30 Terminal-Bench 2.x + 10 SWE-bench Pro, fixed IDs;
   - subjects: a strong hosted model, and Qwen 3.8 27B BF16 on a Spark.

   Pick by the rule in [harness.md](harness.md#choosing-the-agent-harness-a-bake-off-then-freeze),
   then freeze the winner's version, image and config into `agent/`.
5. **Podman check.** Run 3 Harbor tasks on the P100 host's container runtime. If
   Harbor needs Docker, install Docker there, or run task containers on another
   host while the engine stays on the P100.

**Done when:** the bake-off evidence is committed, the winning agent harness is
pinned, and both reference subjects have `coding-agent` core results.

## M6 · Site on Cloudflare Pages

**Repo:** inference-benchmarks. *Can start in parallel once M2 records exist.*

1. `site/`: a Next.js static export built from `results/` and `subjects/` by a
   manifest script.
2. The views:
   - suite leaderboards with rank bands;
   - the **model matrix**;
   - subject pages, with the "private engine, not reproducible" badge where it
     applies;
   - the Decisions page;
   - methodology.
3. Connect a Cloudflare Pages project to the repo: build command
   `npm run build -w site`, output `site/out`. Add a custom domain (optional).
4. `_headers` file: a strict CSP on site pages, and the taste demo CSP on
   `/taste/**`.

**Done when:** a push to `main` deploys, and the Jev and Qwen records from M2 appear
with intervals.

## M7 · First real comparison sets

**Repos:** all. The owner runs these on real hardware.

1. **P100, Qwen 3.8 27B (private engine).**
   - Recipe in the private catalog, with `engine_visibility: private`.
   - Run `core` with `--budget-hours 24`; run `think` as its own job.
   - Results are published with the badge.
   - MTP-1 runs once with and once without, so it gets a **lossless** verdict.
2. **Qwen 3.8 27B matrix:**
   - Cerebras;
   - vLLM BF16 (reference) and FP8 on a Spark;
   - llama.cpp Q8_0 and Q4_K_M;
   - MLX 4-bit;
   - the P100 subject.
3. **Decision models:**
   - Jev, direct and through OpenRouter;
   - meraGPT Decider 1 and Liquid AI d1 (both speak `/v1/systemone`);
   - JEV-27B on vLLM `/v1/decide`;
   - OpenDecider nano in PyTorch, MLX and GGUF;
   - Bekko 17M and 68M in PyTorch and ONNX.
4. The **System 1 vs. System 2** pair: JEV-27B against Qwen3.8-27B in `json-schema`
   and `logprob` modes on the same vLLM.

**Done when:** the model matrix for Qwen 3.8 27B shows at least 2 engines × 3 quants
plus the reference, and the Decisions page shows at least 5 decision subjects with
calibration.

## M8 · Fold in taste, move suites, clean up

**Repos:** all

1. Taste:
   - Move `taste-benchmark/tasks`, `runner` and the gallery into
     `inference-benchmarks`, keeping task fingerprints identical.
   - Add `suites/taste/ranking.yaml` for the owner's ranking.
   - Archive `taste-benchmark`, with a README pointer.
2. inference-engines:
   - Delete `benchmarks/suites/`.
   - `launcher bench` forwards to `bench` when `INFERENCE_BENCHMARKS_DIR` is set;
     it is removed one release later.
   - Recipe `evidence:` entries become links into `inference-benchmarks/results/`.
3. Move the Needle native and RLCD in-process adapters into recipes. Every theater
   lane becomes a subject.
4. Create the sealed decision set:
   - The owner labels about 100 cases in the private repo
     `iammrduncan/inference-benchmarks-sealed`.
   - The public repo gets the suite definition and the item hashes.
5. Merge `launcher-format` into `main` in `esp32-needle-3`.
6. Update the workspace `AGENTS.md` to describe the new layout.

**Done when:** `inference-engines/benchmarks/suites` is gone, the Needle recipe is
still `verified` with linked evidence, taste-benchmark is archived, and the gallery
shows the owner's ranking.

## What the owner does vs. what Claude can build

| Owner (needs your accounts or hardware) | Claude (code and docs, on branches, committed when asked) |
| --- | --- |
| M0: rename, tag and release; Cloudflare Pages project; API keys; `hf auth login`; launcher inventories | M1–M6 code, tests, suite definitions, item-ID lists, calibration scripts |
| M7 runs on the P100, Sparks, ESP32 and Mac; MTP-1 on/off runs | Planning and starting runs on reachable hosts when you give the go-ahead, then summarizing results |
| Labeling the sealed set; ranking taste demos | Sealed-set tooling (hashing, exposure log), the taste ranking file format |

**Next step:** M0 is the owner's. Once the repo is renamed, M1 and M3 can start the
same day.
