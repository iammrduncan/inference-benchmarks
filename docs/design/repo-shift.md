# 2. Shifting typesafe-ai-benchmark into `inference-benchmarks`

## Why reuse this repo

The repo has 40 stars (checked 2026-09-29) and is growing. A **rename**
keeps stars, watchers, issues and forks, and GitHub redirects the old web and git
URLs, as long as nothing new is ever created under the old name. Starting a new repo
would throw that audience away.

The risk is the opposite problem: people starred a *Qwen-vs-Jev* comparison (the repo
description currently reads "LLM Gateway that mimics typesafe ai structured output").
To keep them:

- Keep that comparison prominent. It becomes the `decisions` suite and the theater
  app.
- Keep the existing results reachable at stable paths.
- Say plainly at the top of the README what changed and why.

## Steps on GitHub

1. **Tag the current state** as `typesafe-v1` and create a GitHub release that links
   the current README, video and results. Never rewrite published history.
2. **Rename** `iammrduncan/typesafe-ai-benchmark` → `iammrduncan/inference-benchmarks`.
   It stays on the personal account, next to `iammrduncan/inference-engines`.
3. **Update local remotes:** `git remote set-url origin
   git@github.com:iammrduncan/inference-benchmarks.git` (the redirect covers stale
   clones meanwhile).
4. **Update the description and topics**, for example: "Benchmarks for model ×
   quant × engine: quality, speed, structured decisions and taste. Home of the
   Qwen-vs-Jev decisions benchmark." Add the topics `llm-benchmark`, `quantization`,
   `inference`, `vllm`, `llama-cpp`, `typesafe`.
5. **Pin a short "What changed" note** at the top of the README for a few months,
   linking the `typesafe-v1` release.
6. **Never create a new repo named `typesafe-ai-benchmark`** under the old owner.
   That would break the redirects.

## Target layout

```
inference-benchmarks/
  README.md                what this is; featured results; quick start for the 3 target kinds
  AGENTS.md CLAUDE.md CONVENTIONS.md   rewritten product contract (see below)
  suites/
    general/ coding/ coding-agent/ tool-calling/ tool-calling-small/
    perf/ perf-concurrency/ efficiency/ fidelity/
    decisions/             suite.yaml + scenes/ (fixtures, contracts, expected outputs)
    taste/                 suite.yaml + tasks/{simple,detailed,makebetter}/ + runner/ (container)
  runner/                  the `bench` CLI (TypeScript, Node 24)
    src/targets/           recipe.ts (via inference-engines launcher) · cloud.ts · hf.ts · endpoint.ts
    src/providers/         openai-compatible.ts · anthropic.ts · decision.ts (canonical /v1/systemone) ·
                           openrouter-decisions.ts · vllm-decide.ts · encoder-worker.ts · cactus-native.ts · rlcd.ts
    src/suites/            one generator per suite: prompt template → request → capture → extractor
    src/scorers/           wrappers that run pinned offline scorers on captured outputs
    src/proxy/             the recording proxy agents talk through (OpenAI-compatible, plus decision and Anthropic protocols)
    src/agentic/           drives Harbor with the frozen agent harness; collects trajectories and verifier results
    src/identity.ts        subject resolution + hashing
    src/record.ts          run.json / raw / summary writing + summarize
  scorers/                 one pinned uv project per offline scorer (ifeval checkers, math-verify, evalplus, bfcl-eval, lcb, s1mb);
  agent/                   the frozen agent-harness config (system prompt, tools, compaction, budgets) and bake-off evidence; Harbor pinned in scorers/harbor
  subjects/                <subject-key>/subject.yaml + INTAKE.md (identity, sources, decisions; written by the skill)
  results/                 <subject-key>/<suite>/<run>/  + references.yaml + legacy/
  .agents/skills/benchmark-from-link/   the intake skill (linked from .claude/skills/)
  site/                    Next.js static export: leaderboards, model matrix, subjects, taste gallery
  apps/theater/            the live side-by-side UI (today's packages/demos), now any-subject
  packages/
    decisions/             scene contracts, prompts, decoders and validators shared by runner and theater
    gateway/               today's packages/api proxy: speaks the decision protocol in front of any openai subject
                           (json-schema mode today; logprob mode new)
  scripts/                 media tooling (make-demo.py), legacy importers
  docs/                    methodology, per-suite notes, jev.md, needle.md, rlcd.md, security.md
```

It stays an npm workspace (`runner`, `site`, `apps/*`, `packages/*`), and Python
stays isolated under `scorers/`. See [harness.md](harness.md): `bench` is the only thing that talks to a subject.

## What happens to each existing piece

| Today | Becomes | Notes |
| --- | --- | --- |
| `packages/demos/lib/contracts.ts`, `traffic.ts`, the theater scene fixtures and expected outputs | `packages/decisions/` | The one source of scene truth. The runner's headless `decisions` suite and the theater both import it. |
| `packages/api/src/cerebras.ts`, `schema.ts`, `evaluate.ts`, `metrics.ts` | `packages/decisions/` (the structured-output encoder and validator) and `runner/src/providers/openai-compatible.ts` | Cerebras becomes just another OpenAI-compatible cloud provider, and the compact numeric-slot encoding becomes the `json-schema` mode of `decisions`. Keep "strict schema, no repair, no fallback". |
| `packages/api` HTTP server, `http.ts`, examples | `packages/gateway/` | **It has a job now:** it is the adapter that lets any chat LLM take the decision suites. Add `logprob` mode (option probabilities from engine logprobs) next to the existing `json-schema` mode. Its compatibility tests keep running in `npm run check`. |
| `packages/demos/lib/jev.ts` | `runner/src/providers/decision.ts`, with the mapping in `packages/decisions` | It becomes the generic decision-protocol client, with TypeSafe as one endpoint. Add `openrouter-decisions`, `vllm-decide` (JEV-27B) and `encoder-worker` (a Python worker for Laya, Bekko, OpenDecider-nano and S1MB adapters). The mapping version stays in the records. |
| `packages/demos/lib/needle*.ts`, `scripts/setup-needle.mjs`, `needle-release.json` | `runner/src/providers/cactus-native.ts` **for now**; later an `inference-engines` recipe `needle3/apple-m/cactus-native` | In-process adapters make identity and isolation harder. Move them behind a recipe that serves OpenAI-compatible tool calls, then delete the adapter. |
| `packages/demos/lib/rlcd*.ts`, `python/rlcd_worker.py`, `rlcd-release.json`, `rlcd-requirements.lock` | Same path as Needle: an adapter now, a recipe `qwen2.5-1.5b/apple-m/rlcd-mlx` later | |
| `packages/demos` app, components, theater UI | `apps/theater/` | The lane selector lists **subjects** from the runner's registry, so any recipe, HF or cloud target can be a lane, not just the four hard-coded models. The theater stays a local, keyed, live app and is never deployed. |
| `scripts/benchmark-*.mjs`, `summarize-*.mjs`, `probe-needle-speed.mjs` | Replaced by `bench run` and `bench summarize` | One-off importers under `scripts/legacy/` convert their outputs into run records. |
| `docs/benchmarks/**` (comparison, needle, needle-warm, needle-capped, rlcd, rlcd-v2, theater) | Kept at their current paths under `results/legacy/`, and also imported as run records | Old README links keep working (add redirect stubs where paths move). Imports are marked `imported: true`, and point to the original file and its hash. |
| `docs/jev.md`, `needle.md`, `rlcd.md`, `security.md`, `plan.md`, `showcase-research.md` | `docs/` (unchanged), and `plan.md` moves to `docs/history/` | |
| `docs/media/*` | `docs/media/*` | Used by the README and the Decisions page. |
| `.agents/skills/engineering` | Unchanged | The human-owned engineering references stay as they are. |
| `AGENTS.md`, `CONVENTIONS.md` | Rewritten "Mission" and "Product contract" sections | Keep the engineering judgment, definition of done and the three separate claims (wire compatibility, quality, performance). Add a fourth: *subject identity*. Move the TypeSafe API contract table into `packages/gateway/CONVENTIONS.md`. |
| `todo.txt` | Delete once its items are closed | All boxes are checked today. |
| Node 22 pin | Node 24 LTS | Matches `inference-engines` (≥ 23.6, running `.ts` directly). Allows the runner to be ported without a build step. |

### Pieces ported from other repos

| From | Into | Notes |
| --- | --- | --- |
| `inference-engines/launcher/src/bench.ts`: `chat()` streaming client, `parseProm`, the perf and tool-calls runners, and `command` / `recipe-command` execution | `runner/src/providers/openai-compatible.ts`, `runner/src/suites/` | Port with its tests. The client already handles SSE, tool-call deltas and TTFT. |
| `inference-engines/benchmarks/suites/*/suite.yaml`, `benchmarks/README.md` | `suites/*/` | Rename `tool-calling-card` → `tool-calling` + `tool-calling-small`. Status values carry over. |
| `inference-engines/hardware/**/benchmarks/results/*` | `results/<subject-key>/…` (imported) | The recipe keeps its `benchmarks/workload.yaml`; its `evidence:` list becomes URLs into this repo. |
| `taste-benchmark/tasks/`, `runner/`, `scripts/run-benchmark.sh` | `suites/taste/` | Keep task-hash fingerprints identical, so older demos stay valid. |
| External decision harnesses: S1MB (`hotchpotch/S1MB`, MIT), JevBench public (`fstandhartinger/jevbench`, MIT), dhruvmehra/jevbench (MIT) | `scorers/s1mb`, `scorers/jevbench`, plus data loaders under `suites/` | `bench` generates; their code only scores. S1MB gets a **replay adapter** that feeds it our captured distributions, so its own scoring runs unchanged. The jev-eval checks are re-implemented in TypeScript as `decision-conformance`, with credit. |
| `taste-benchmark/scripts/build-manifest.mjs`, the `app/` gallery, the CSP injection | `site/` (the taste section) | Keep the sandbox rules exactly: no `allow-same-origin`, CSP meta, downloads rather than links, four at a time. |

## The runner CLI

One command, three kinds of target, and the same record format for all of them:

```sh
# 1. A recorded inference-engines recipe (the launcher starts and stops it)
bench run --recipe needle3/esp32-s3/8-layer --suite perf,tool-calls --tier quick

# 2. A hosted cloud model
bench run --cloud anthropic:claude-opus-5-5 --suite decisions,taste --profile card --budget-usd 20

# 3. A Hugging Face link on a standard engine (the launcher's generic recipe)
bench run --hf Qwen/Qwen3.8-27B-Instruct --quant gguf:Q4_K_M --engine llama.cpp \
  --on spark-1 --tier core --budget-hours 24     # every category its purpose selects; the planner fits it to the budget

# Escape hatch: something already running, with self-declared identity
bench run --endpoint http://127.0.0.1:8000 --identity ./identity.yaml --suite perf

bench run --cloud typesafe:jev-latest --suite typed-decisions,decision-conformance --budget-usd 5
bench run --hf autotrust/JEV-27B --engine vllm --protocol decision --suite decisions-classic
bench run --hf Qwen/Qwen3.8-27B --engine vllm --via gateway:logprob --suite decisions-classic

bench subjects            # resolved subjects with results
bench export-hf <run>     # .eval_results YAML for Hub-official benchmarks
bench summarize <run>     # recompute summary.json from raw
bench import <path>       # legacy importers
bench site                # build the static site into site/out
```

- **The runner never starts an engine itself.** For `--recipe` and `--hf` it calls
  `inference-engines`:
  - `launcher up <id> --param … --detach --json`, which returns the endpoint, the
    resolved identity and the acknowledged terms;
  - then `launcher down <id>` afterwards.

  The runner finds the launcher through `INFERENCE_ENGINES_DIR` (a sibling
  checkout), or through the published `@iammrduncan/inference-engines`
  package once one exists.
- **Keys** come from the environment only and are never written into records.
- **Budgets.** Cloud runs need `--budget-usd`. The runner estimates cost from the
  provider's pricing file and stops at the cap. A run stopped this way is
  published as partial.
- **Isolation.**
  - Taste and `coding` (which executes generated code) run in containers holding
    only their task, as `taste-benchmark` does today.
  - `coding-agent` runs in its own sandbox with no credentials mounted.

## What does not change

- The rules for published results:
  - no hidden retries, repairs or fallbacks;
  - failures are kept;
  - quality, validity and speed are separate claims;
  - dates and hardware are stated.
- `npm run check` stays the single gate: types, lint, offline tests and builds. It
  never needs provider keys.
- MIT license for the repo's code. Imported suites keep their datasets' licenses,
  listed per suite. Gated datasets such as GPQA are never committed.
