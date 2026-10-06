# bench

`bench` is the measuring harness for inference-benchmarks. It resolves a **subject** (model × checkpoint × quant × engine), sends every request to it, records every byte, and scores the captured outputs. One harness for every subject is the point: see [docs/design/harness.md](../docs/design/harness.md).

Node 24 runs the TypeScript sources directly; there is no build step.

```sh
npm install
# keys come from 1Password, never from files
op run --env-file=benchmarks.env.op -- npx bench run --cloud typesafe:jev-latest \
  --suite decision-conformance,typed-decisions --tier quick --budget-usd 2
op run --env-file=benchmarks.env.op -- npx bench run --cloud cerebras:qwen-3.8-27b \
  --via gateway:json-schema --suite typed-decisions --tier quick --budget-usd 2
npx bench summarize results/ --check      # every summary.json recomputes byte for byte
npx bench subjects
npx bench calibrate typed-decisions       # rebuild the dataset card's baselines offline
```

## Commands

| Command | What it does |
| --- | --- |
| `run --suite a,b --cloud provider:model [--via gateway:json-schema]` | Run suites against a hosted model. `typesafe` speaks the decision protocol natively. `cerebras` reaches it through `packages/gateway` in json-schema mode, which the runner starts in-process on a loopback port. |
| `run --suite a,b --endpoint URL --identity FILE --model M [--api-key-env VAR]` | Any endpoint that speaks `/v1/systemone`. The identity is self-declared, so the subject is labeled "unverified identity" and is never a reference. |
| `--tier quick\|core` | `quick`: the committed `quick.ids`. `core`: the full ranked item set. |
| `--budget-usd N` | One cap for the whole command. The runner stops dispatching at the cap and marks the run partial. Needs a known price for the subject. |
| `--concurrency N` | Requests in flight (default 2). |
| `--rpm N` | Pace dispatch to at most N requests per minute, to stay under provider rate limits. Pacing delays requests; it never retries them. Both settings are recorded in `run.json` under `dispatch`. Through the gateway, one typed-decisions case is five provider calls. |
| `summarize <dirs> [--check]` | Recompute `summary.json` from `raw.jsonl` and `run.json` only. `--check` exits 1 if any differs. |
| `subjects` | Subjects in `subjects/` and their run counts. |
| `calibrate typed-decisions` | Rebuild the card's Uniform and Prior rows from the pinned data. KL and Brier must match the card to 3 decimals. |
| `ids typed-decisions` | Regenerate the committed `quick.ids` and `core.ids` (seeded, stratified). |

## What a run writes

```
subjects/<subject-key>/subject.yaml       identity, written once
results/<subject-key>/<suite>/<date>-<tier>-<profile>[-<mode>]-<id>/
  run.json        subject, mode, profile, harness (commit, suite hash, scorer), endpoint,
                  dataset pins, request settings, budget, environment, status
  raw.jsonl       one line per request: request body, response, timings, usage, cost, gold
                  (or raw.pointer.json when raw data exceeds 5 MB; the data stays in .artifacts/raw)
  summary.json    metrics with 95% intervals, latency percentiles, usage and cost
```

- **No retries, no repairs, no fallbacks.** A failed request is a row with `ok: false`, and it counts against the subject.
- **Credentials never reach a record.** Keys travel only in request headers, and the client does not capture headers.
- **Cloud subjects** are keyed `<model>/<provider>-<YYYY-MM>/opaque/<provider>`. Providers change what serves a model id, so each month is its own subject. The models the API actually reported are counted in `run.json` under `observed_models`.

## Suites

| Suite | Protocol | Items | Scoring |
| --- | --- | --- | --- |
| [`typed-decisions`](../suites/typed-decisions/suite.yaml) | decision | quick 100 cases (500 decisions), core 400 (2,000) | accuracy, KL from gold, Brier, ECE; see the suite file for definitions and the calibration notes |
| [`decision-conformance`](../suites/decision-conformance/suite.yaml) | decision | 17 probes | invariants, batched vs. separate, repeat stability, option order, monotonicity |

`npm test -w @decision/bench` runs offline against local fake servers; it needs no keys and no network.
