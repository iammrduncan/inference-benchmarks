# inference-benchmarks

Benchmarks for **model × version × engine**.

A score is never just the model's. The same weights score differently at another
quant, or in another engine. So every result here names the exact checkpoint, quant
and engine that produced it, and one harness measures them all the same way.

[Hackers in the Loop](https://hackersintheloop.org/) · runs on recipes from
[inference-engines](https://github.com/iammrduncan/inference-engines)

## Results

**typed-decisions** ([Hugging Face official benchmark](https://huggingface.co/datasets/LocalLLaMA/typed-decisions)):
System One decisions with probability-distribution gold, five typed questions per
case. Measured 2026-10-06 from America/Chicago, `greedy-nothink`.

| Subject | Tier | Accuracy (95% CI) | KL from gold ↓ | Brier ↓ | p50 latency | $ per 1k decisions |
| --- | --- | --- | --- | --- | --- | --- |
| Jev 1.13 · TypeSafe API | core (2,000 decisions) | **0.738** (0.718–0.757) | 1.52 | 0.148 | 154 ms | $0.008 |
| Jev 1.13 · TypeSafe API | quick (500) | 0.748 (0.708–0.784) | 1.78 | 0.146 | 171 ms | $0.007 |
| Qwen 3.8 27B · Cerebras, through the gateway (json-schema) | quick (500) | 0.722 (0.681–0.759) | 3.93 | 0.247 | 572 ms | $0.61 |

- **Checked against the card.** On the same 400 cases the card reports Jev at
  0.727 accuracy, 1.442 KL and 0.148 Brier: inside our intervals, with Brier exact.
- **Scorer reproduces the card's baselines.** It rebuilds the card's own Uniform and
  Prior rows exactly ([calibration](suites/typed-decisions/calibration/baselines.json)).
- **Raw data.** Every number links back to raw request/response data in
  [`results/`](results/), and `npx bench summarize results/ --check` recomputes each
  summary byte for byte.

## How it works

```
 link or target ─▶ subject ─▶ bench ─▶ results/<subject>/<suite>/<run>/ ─▶ site (planned)
                  model ×      one harness:     run.json · raw.jsonl · summary.json
                  checkpoint × prompts, client,
                  quant ×      capture, scoring
                  engine
```

- **Subjects.** A subject is a pinned model × checkpoint × quant × engine. Hosted
  models are provider-opaque and keyed by month. Self-declared endpoints are labeled
  as unverified.
- **[`bench`](runner/README.md), the harness.** It sends every request, records
  every byte and scores offline. It never retries, repairs or falls back: a failure
  is a row that counts against the subject.
- **[Suites](suites/).** Each suite pins its data by revision and SHA-256, along
  with its item IDs, prompts and scoring.
- **Engines are not run here.** Starting and stopping engines belongs to
  [inference-engines](https://github.com/iammrduncan/inference-engines). `bench`
  drives its launcher.

## Run it

Node 24 (`nvm use`). API keys come from 1Password, never from files.

```sh
npm install
op run --env-file=benchmarks.env.op -- npx bench run --cloud typesafe:jev-latest \
  --suite decision-conformance,typed-decisions --tier quick --budget-usd 2
npx bench subjects
npx bench summarize results/ --check
npm run check                     # types, lint, offline tests, builds; no keys needed
```

## What's here

| Path | What |
| --- | --- |
| [`runner/`](runner/) | `bench`, the measuring harness |
| [`suites/`](suites/) | Suite definitions: pinned data, item IDs, scoring rules |
| [`results/`](results/), [`subjects/`](subjects/) | Run records and subject identities |
| [`packages/decisions/`](packages/decisions/) | Decision scenes, contracts and the Jev mapping |
| [`packages/gateway/`](packages/gateway/) | A `/v1/systemone` gateway that lets chat LLMs answer decision suites |
| [`apps/theater/`](apps/theater/) | The live side-by-side decisions theater (local, keyed) |
| [`docs/design/`](docs/design/README.md) | The design and the build plan (milestones M0–M8) |

## Status

Built:
- `bench`, with the decision suites;
- the reorganized repo;
- the launcher interface in inference-engines.

Next:
- recipe and Hugging Face targets, with single-turn suites (M4);
- agentic suites (M5);
- the results site on Cloudflare Pages (M6).

See the [build plan](docs/design/build-plan.md).

## History

This repo began as `typesafe-ai-benchmark`, a Qwen-vs-Jev structured-decision
comparison. That comparison lives on as the decision suites and the theater. The
original write-up, raw results and media are preserved at tag
[`typesafe-v1`](https://github.com/iammrduncan/inference-benchmarks/tree/typesafe-v1).

MIT licensed. Datasets keep their own licenses, listed in each suite.
