# Qwen 2.5 1.5B RLCD in the demo

The side-by-side model selector includes **Qwen 2.5 1.5B · RLCD Local** when its
local artifacts are installed. It needs no cloud key and reports zero API fees;
hardware and electricity remain excluded.

## What is pinned

Sources checked 2026-09-18:
[RLCD engine](https://huggingface.co/harshatheg/Qwen-2.5-1B-RLCD),
[base weights](https://huggingface.co/mlx-community/Qwen2.5-1.5B-Instruct-4bit).

Despite its name, `harshatheg/Qwen-2.5-1B-RLCD` contains an Apache-2.0 decoding
engine and demo source, not model weights. Its model card loads the separate
`mlx-community/Qwen2.5-1.5B-Instruct-4bit` repository. The demo records both:

- engine revision `2af86848be75847ccb3553b0941cc51d6ef7e4e9`;
- weight revision `8b403126fc14f14cfc99bb4cfa72ecbc129ea677`.

The product label says 1.5B so it does not repeat the engine repository's misleading
1B shorthand. `apps/theater/rlcd-release.json` is the source of both pins.

## Local setup

The supported path is macOS on Apple Silicon. Install `uv`, Python 3.12 and the
[Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli), then run:

```sh
npm run setup:rlcd
npm run start:demos:live
```

The setup script creates an isolated environment and downloads source and weights
under ignored `.artifacts/rlcd/`. Python packages are exact-pinned in
`apps/theater/rlcd-requirements.lock`. Restart the live server after setup so the
launcher discovers the artifacts. No model files or credentials are committed.

## Mapping and execution

Every existing scene still owns its strict JSON Schema and final Zod/application
validator. Mapping version `rlcd-scenes-v2` treats the upstream engine as what it
actually is—a first-token classifier—not as a general JSON generator. The adapter:

- removes IDs and unrelated policy/state fields from the classifier context while
  retaining the evidence needed for that scene;
- uses collision-resistant semantic decision labels, then maps them back to the
  unchanged public string, boolean and integer values;
- evaluates judge criteria as parallel `YES` / `NO` fields and sums their declared
  weights into the public accuracy score; validity is true only when every criterion
  is satisfied;
- keeps home outputs as deltas, with an explicit `UNCHANGED` option for every
  device field.

All direct properties must be required, unknown model output properties are rejected,
and a direct integer domain may contain at most 255 values. The judge's internal
criterion fields and deterministic weighted aggregation are recorded in the request
contract. There is no retry, repair, fixture lookup or fallback. The mapped public
result must still pass the unchanged scene validator before the demo applies it.

The upstream engine performs one context prefill, broadcasts its KV cache across
the fields in that request, and evaluates the field suffixes as a batch. That is
parallel field decoding, not batching of independent demo inputs. The engine also
uses a process-global GPU lock. The adapter therefore keeps one loaded Python/MLX
worker and explicitly queues independent inputs FIFO. Two side-by-side lanes or two
static-scene callers can submit concurrently, but Metal inference remains serialized.
Cancellation kills the worker so no detached inference continues; the next request
starts a replacement. Queue time, replacement load, inference and validation all
remain inside the 16-second request deadline and end-to-end timing.

The worker uses JSON lines over private stdio, not the upstream HTTP demo server.
It receives only the pinned local paths, context and converted schema; cloud keys are
not inherited. Hugging Face and Transformers offline flags prevent inference-time
downloads.

## Scores and limitations

The engine returns a winning score for each model field. For choices whose first tokens
are distinct, that value is a softmax over the constrained candidates' next-token
logits. When candidates collide at the first token—such as multi-digit integer
choices—the upstream code follows an argmax continuation, falls back to the first
choice when matching fails, and synthesizes a winning score with a minimum of 0.75.

Exports therefore call these values `reportedFieldScores`. They are diagnostics,
not verified calibrated probabilities. Collision fields are marked per request and
counted in benchmark summaries. The benchmark separately reports type validity,
fixture agreement and latency; a structurally valid answer is not evidence of a
correct judgment. Version 2 deliberately uses distinct first-token labels for the
published workload and records any future collision detected by the pinned tokenizer.

The compact translation materially improves the guardrail and approval workloads,
but it does not turn the base 1.5B instruct model into a reliable general judge,
planner or controller. Multi-field exact match is particularly harsh, and correlated
field errors remain possible because all suffix decisions share one semantic prefill.

The repository's benchmark uses the same recorded input order as the historical
Qwen/Jev run, two concurrent callers for static scenes, and one caller for stateful
scenes. The single worker serializes actual model calls. It uses no warmup requests,
automatic retries or hidden fallback and preserves failures and the driving-deadline
cancellation. See the [published mapping v2 run](https://github.com/iammrduncan/inference-benchmarks/blob/typesafe-v1/docs/benchmarks/rlcd-2026-09-19-v2/README.md)
for raw results and comparison with the original mapping. Reproduce with:

```sh
npm run benchmark:rlcd -- .artifacts/rlcd-benchmark-new
npm run summarize:rlcd -- .artifacts/rlcd-benchmark-new
```

This local run must not be presented as a universal model or provider speed ranking.
