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

**embeddings**: EmbeddingGemma 2 (`google/embeddinggemma-2@914f7f8`), quick tier (NanoBEIR
+ STSBenchmark + Banking77, 66,939 texts), the card's own prompts, scored offline with
MTEB 2.22.5. Stock, untuned engines. Measured 2026-10-07. The reference is
sentence-transformers fp32 on the P100; fidelity compares each run's vectors with it.

| Variant | Machine · engine | Score @768 | Δ vs ref | @256 | @128 | Fidelity | Prefill tok/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fp32 (Google) | P100 16 GB · sentence-transformers (reference) | 66.90 | — | 64.98 | 60.61 | reference | 10,961 |
| fp32 (Google) | M4 Pro 24 GB · sentence-transformers (MPS) | 66.90 | +0.00 | 64.98 | 60.61 | lossless | 4,793 |
| bf16 (Google) | M4 Pro 24 GB · sentence-transformers (MPS) | 66.93 | +0.03 | 65.05 | 60.80 | faithful | 6,064 |
| fp32 (onnx-community) | P100 16 GB · ONNX Runtime CUDA | 66.90 | +0.00 | 64.98 | 60.61 | lossless | 12,808 |
| fp32 (onnx-community) | M4 Pro 24 GB · ONNX Runtime CPU | 66.90 | +0.00 | 64.98 | 60.61 | lossless | 2,654 |
| q8 (onnx-community) | P100 16 GB · ONNX Runtime CUDA | 66.80 | −0.10 | 65.06 | 60.66 | faithful | 12,620 |
| q8 (onnx-community) | M4 Pro 24 GB · ONNX Runtime CPU | 66.80 | −0.10 | 65.06 | 60.66 | faithful | 2,756 |
| q4 (onnx-community) | P100 16 GB · ONNX Runtime CUDA | 66.19 | **−0.71** | 64.53 | 60.37 | **degraded** | 12,530 |
| q4 (onnx-community) | M4 Pro 24 GB · ONNX Runtime CPU | 66.19 | **−0.71** | 64.53 | 60.37 | **degraded** | 1,391 |

- **Precision:** fp32 and bf16 match the reference, and q8 is faithful (cosine 0.9999).
  q4 is the only variant that loses quality: −0.71 points at 768, with only 63–72% of
  each query's top-10 neighbors unchanged.
- **Dimensions:** truncating to 256 costs about 2 points and 128 about 6, for every variant.
- **Engines:** the same ONNX file gives the same vectors on CUDA and on CPU. q4 is no
  faster than fp32 on the P100, and half as fast on the M4 Pro's CPU.
- **Prefill only:** embedding has no decode. Speed is engine time, batches of 32.
- The Intel Arc Pro B70 runs are pending.

## How it works

```
 link or target ─▶ subject ─▶ bench ─▶ results/<subject>/<suite>/<run>/ ─▶ site
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
npm run site                      # the results site in dev mode, http://localhost:3100
npm run build -w site && npm run preview -w site   # the static export, as Cloudflare Pages serves it
```

## What's here

| Path | What |
| --- | --- |
| [`runner/`](runner/) | `bench`, the measuring harness |
| [`suites/`](suites/) | Suite definitions: pinned data, item IDs, scoring rules |
| [`results/`](results/), [`subjects/`](subjects/) | Run records and subject identities |
| [`packages/decisions/`](packages/decisions/) | Decision scenes, contracts and the Jev mapping |
| [`packages/gateway/`](packages/gateway/) | A `/v1/systemone` gateway that lets chat LLMs answer decision suites |
| [`site/`](site/) | The static results site: leaderboards, the model matrix, subject and run pages. Built from `results/` and `subjects/` |
| [`apps/theater/`](apps/theater/) | The live side-by-side decisions theater (local, keyed) |
| [`docs/design/`](docs/design/README.md) | The design and the build plan (milestones M0–M8) |

## Status

Built:
- `bench`, with the decision suites;
- the reorganized repo;
- the launcher interface in inference-engines;
- recipe targets and the embeddings suite;
- the static results site (`site/`), not yet connected to Cloudflare Pages.

Next:
- Hugging Face targets, with single-turn suites (M4);
- agentic suites (M5);
- Cloudflare Pages deploys, the Decisions page and the taste gallery (M6).

See the [build plan](docs/design/build-plan.md).

## History

This repo began as `typesafe-ai-benchmark`, a Qwen-vs-Jev structured-decision
comparison. That comparison lives on as the decision suites and the theater. The
original write-up, raw results and media are preserved at tag
[`typesafe-v1`](https://github.com/iammrduncan/inference-benchmarks/tree/typesafe-v1).

MIT licensed. Datasets keep their own licenses, listed in each suite.
