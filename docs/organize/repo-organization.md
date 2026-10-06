# 3. How the repos are organized

## After the change

| Repo | Owner | Role | Owns | Does not own |
| --- | --- | --- | --- | --- |
| **`inference-benchmarks`** (was `typesafe-ai-benchmark`) | iammrduncan | *What to measure, and what happened* | suite definitions, taste tasks, decisions scenes, the `bench` runner, results, the static site, the live theater | starting or stopping engines, and knowing how any engine is built |
| **`inference-engines`** (moved from Hackers-in-the-Loop) | iammrduncan | *How to run it* | recipes (including generic HF recipes), the launcher, inventory, attribution and acknowledgments, adapters for external repos, recipe-specific workloads and fidelity commands | suites, results, leaderboards |
| **`esp32-needle-3`** and future engine repos | the author (personal or org) | *An engine* | engine source, firmware, native-format entry points, the engine's own evidence backing its README | anything about other engines |
| **`taste-benchmark`** | iammrduncan | **Archived** | a README pointing to `inference-benchmarks/suites/taste` and the gallery | everything else (moved) |

```
                    ┌──────────────────────────────────────────┐
                    │ inference-benchmarks                      │
                    │  suites/  runner/  results/  site/       │
                    │  apps/theater  packages/decisions        │
                    └───────┬───────────────────────┬──────────┘
      launcher up/down --json│                       │ cloud APIs (keys from env)
      (recipes + generic HF) │                       ▼
                    ┌────────▼─────────┐     Anthropic, OpenAI, Cerebras,
                    │ inference-engines│     TypeSafe, OpenRouter, ...
                    │ recipes/launcher │
                    └────────┬─────────┘
            source.repo@commit│ (pinned; native or adapter)
                    ┌────────▼─────────┐   ┌───────────────────────────┐
                    │ esp32-needle-3   │   │ external engine repos,     │
                    │ (our engines)    │   │ vllm / llama.cpp images    │
                    └──────────────────┘   └───────────────────────────┘

   inference-engines ──links──▶ inference-benchmarks   (recipe evidence URLs, README "results" link)
   engine repos      ──links──▶ inference-benchmarks   (optional "independent results" badge/link)
```

### Which way dependencies go

- **`inference-benchmarks` → `inference-engines`** is a *runtime* dependency: the runner calls
  the launcher. It is loose, going through a CLI with `--json` output, not through
  imports. The runner records the `inference-engines` commit for each run.
- **`inference-engines` → `inference-benchmarks`** is only *links*. There is no code
  dependency, so `inference-engines` stays usable without `inference-benchmarks`:
  `up`, `down`, `check` and `validate` keep working.
- **`inference-engines` → engine repos** stays as it is: the recipe pins
  `repo@commit`.
- **Engine repos depend on neither.** They keep their own `bench/` and `evidence/`
  for engine-specific work. The native engine format from
  `inference-engines/docs/rollout-plan.md` §6 is unchanged.

This keeps each repo understandable on its own, and each can be cloned alone:
- `inference-benchmarks` can run cloud-only suites without `inference-engines`.
- `inference-engines` can launch recipes without `inference-benchmarks`.

## `inference-engines` changes

1. **A machine-readable launcher interface.**
   - `launcher up <id> --detach --json` prints `{endpoint, model, identity, acknowledgments, run_id}`.
   - `launcher describe <id> [--param …] --json` prints the resolved identity
     without starting anything.
   - `launcher down <id> --json`.
2. **An `identity` block in `recipe.yaml`** (added to the schema), so the subject is
   declared rather than guessed from `components`:
   ```yaml
   identity:
     model: needle3
     checkpoint: {hf: Cactus-Compute/needle3, revision: 9da75122d4ca11aa4a667281c9c8ba38a7eed679}
     quant: {format: cact, scheme: "${layers}-layer slice", sha256: from-manifest}
     engine: {name: needle-esp32, version: 9d2987bca499a17fcc5fe7785e73d08dff8d5f22}
   ```
   Params can appear in the identity (Needle's `layers`, for example), so each depth
   is its own subject.

   `endpoint.protocol` accepts `decision` alongside `openai`, so recipes can serve
   decision models: for example `jev-27b/<hw>/vllm-decide`, and
   `opendecider-nano/apple-m/mlx`.
3. **Generic recipes for Hugging Face links**, in a new top-level `generic/` folder,
   because they are not tied to one piece of hardware:
   - `generic/vllm`: pinned `vllm/vllm-openai` digest; params `hf_repo`, `revision`,
     `quant`, `max_model_len`, `kv_cache_dtype`.
   - `generic/llama.cpp`: pinned `ggml-org/llama.cpp:server` digest; params
     `hf_repo`, `revision`, `file` (GGUF).
   - `generic/sglang` and `generic/mlx-lm` (Apple M-series, host isolation).
   - `generic/encoder-decision`: a small pinned Python server that loads a decision
     encoder (Laya, Bekko, OpenDecider-nano) with Transformers or ONNX Runtime, and
     serves the `decision` protocol. It takes `hf_repo`, `revision` and `runtime`
     (`torch` or `onnx`) as params.

   These are the recipes behind `bench run --hf …`. Their status is `template`: they
   are run-verified per model, not per recipe. The schema and `validate` need to
   accept `template`. Gated models still go through the acknowledgment flow, using
   the license read from the model card.
4. **Suites move out.**
   - Delete `benchmarks/suites/` once `inference-benchmarks/suites/` holds
     the same definitions (it moves; no copy is kept).
   - `launcher bench` becomes a thin forwarder for one release: if `INFERENCE_BENCHMARKS_DIR`
     is set it runs `bench run --recipe <id> …`, and otherwise it prints where
     benchmarks live. Then it is removed.
   - Remove `bench.ts` after that release, but port `chat()` and its tests first.
5. **Evidence becomes links.** `evidence:` entries accept URLs into
   `inference-benchmarks/results/…`, and `validate` checks that a `verified` recipe has at
   least one passing run there. The six existing Needle result folders are imported
   into `inference-benchmarks` and replaced by links in the same PR pair.
6. **Docs.** Update `README.md`, `AGENTS.md`, `benchmarks/README.md` (becomes a
   pointer) and `docs/rollout-plan.md` §5. Add a "Results" link to the site on every
   recipe README.

## `esp32-needle-3` changes

- Merge `launcher-format` into `main`. The verified recipe pins a commit that exists
  only on that branch, so `main` and the pinned engine have diverged.
- Add a **host serving target**, so BFCL and the Needle card set can run on the same
  C engine with arbitrary tool schemas. It becomes a recipe,
  `needle3/host/8-layer` (x86 or Apple, host isolation).
- Link from its README to the Needle subject pages on the inference-benchmarks site, next to
  its own evidence. Its own README numbers stay its own.

## `taste-benchmark` changes

1. Move `tasks/`, `runner/`, `scripts/run-benchmark.sh` and `build-manifest.mjs` into
   `inference-benchmarks`, keeping task fingerprints identical.
2. Replace the README with a short pointer. Archive the repo (read-only; the history
   stays).
3. The inference-engines `taste` suite (`TASTE_BENCHMARK_DIR`) goes away along with
   the rest of `benchmarks/suites/`.

Folding it in costs little now: three commits, no demos, no stars to speak of. Later,
with a gallery full of demos, the move would cost more.

## Workspace (`inference-and-benchmarks/`)

- Keep the four sibling checkouts. `taste-benchmark` can be deleted locally once it
  is archived.
- The runner's default `INFERENCE_ENGINES_DIR` is `../inference-engines`, which
  matches this layout.
- Update the root `AGENTS.md` once the move lands. The relationships section is
  replaced by the table and diagram above.

## Migration order

Each step leaves every repo working. Steps within a phase can run in parallel.

| Phase | Repo | Step | Done when |
| --- | --- | --- | --- |
| 0 | inference-benchmarks | Tag `typesafe-v1`, create the release, rename to `iammrduncan/inference-benchmarks`, update the description and topics; point the local `inference-engines` remote at `iammrduncan/inference-engines` | old URLs redirect; stars intact |
| 1 | inference-benchmarks | Restructure only: `packages/demos` → `apps/theater`, `packages/api` → `packages/gateway`, extract `packages/decisions`; move to Node 24; move the `benchmark-from-link` skill draft into `.agents/skills/` | `npm run check` passes; the theater runs unchanged |
| 2 | inference-benchmarks | Add `runner/` with identity, run records, `openai-compatible` + `anthropic` providers, `perf` and `tool-calls` ported with tests, and `--cloud` and `--endpoint` targets | a cloud `decisions` smoke run writes a valid record |
| 2 | inference-engines | Add `identity` to schema and recipes; add `describe`/`up`/`down --json` | `validate` and `npm test` pass; `describe needle3/esp32-s3/8-layer --json` prints the subject |
| 3 | inference-benchmarks | `--recipe` target through the launcher; headless `decisions-scenes` suite; importers for theater, Needle and RLCD results | the Needle recipe smoke runs reproduce the committed evidence within tolerance |
| 3 | inference-benchmarks | Decision protocol: `decision.ts` + OpenRouter and vLLM `/v1/decide` adapters; gateway `logprob` mode; `decision-conformance`, `typed-decisions` and `decisions-classic` suites | Jev (direct and via OpenRouter) and Qwen through the gateway both pass the conformance suite and have a typed-decisions smoke record |
| 3 | inference-engines | `generic/vllm` and `generic/llama.cpp` template recipes | `bench run --hf … --engine llama.cpp` works on one machine |
| 4 | both | Move the suites; import Needle evidence; turn `evidence:` into links; `launcher bench` → forwarder | `inference-engines/benchmarks/suites` is gone; the Needle recipe stays `verified` |
| 5 | inference-benchmarks | Static site: leaderboards, model matrix, subject pages, Decisions page; deploy to Cloudflare Pages | the site builds from `results/` only |
| 6 | inference-benchmarks + taste-benchmark | Fold in taste; gallery on the site; archive `taste-benchmark` | one taste run from a recipe and one from a cloud model appear in the gallery |
| 7 | all | First comparison sets ([benchmarks.md § First runs](benchmarks.md#first-runs)), with the Qwen 3.8 27B matrix first | a model-matrix page with ≥ 2 engines × ≥ 3 quants and a reference |
| 7 | inference-benchmarks + inference-engines | Decision-model set: `generic/encoder-decision` recipe, JEV-27B and OpenDecider recipes, S1MB and JevBench harness adapters, the first Hub `.eval_results` export | the Decisions page shows ≥ 5 decision subjects, including one model in ≥ 2 engines, with calibration, plus the System 1 vs. System 2 pair |
| 8 | inference-engines | Move the Needle native and RLCD adapters out of the theater and into recipes; remove `launcher bench` | theater lanes are all subjects; no in-process engine adapters remain |

## Conventions that apply across repos

- **One repo per PR.** When a change spans repos, land the provider side first (for
  example, the launcher's `--json`), then the consumer side, which pins the new
  commit.
- **Identity is pinned end to end.** A result names the inference-benchmarks commit, the suite
  hash, the inference-engines commit, the recipe ID and the engine commit. A missing
  pin means the result is not published.
- **Claims are separate.** Wire compatibility, structured validity, judgment
  quality, speed and taste are never merged into one claim, and each carries its
  date and hardware.
- **Credentials and weights never go in any repo.** Raw data over 5 MB goes to the
  Hugging Face dataset, pinned by hash.
- **Attribution travels with the subject.** The site shows the recipe's authors,
  engine and weights licenses on every subject page, drawn from `recipe.yaml`.
