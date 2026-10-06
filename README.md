# typesafe-ai-benchmark

**LLM-native structured output vs. TypeSafe Jev: latency, cost, and judgment quality.**

[Hackers in the Loop](https://hackersintheloop.org/)

How does a fast general-purpose LLM compare with a purpose-built judgment model
on the same application tasks? This benchmark runs **Qwen 3.8 27B on Cerebras**
and **TypeSafe Jev** side by side across seven synthetic workloads, with a
separate local **Needle 3** evaluation on the same contracts. It records
validated outputs, mistakes, request latency, token usage and estimated cost.

[![Qwen on Cerebras vs. Jev — side-by-side benchmark demo](docs/media/theater-demo.gif)](docs/media/theater-demo.mp4)

[Watch or download the demo (MP4)](docs/media/theater-demo.mp4) ·
[Static screenshot](docs/media/theater.png) ·
[Raw results and methodology](docs/benchmarks/README.md)

The GIF and 98-second MP4 illustrate the comparison UI. Published measurements
come from the separately captured browser exports linked below.

## What we compare

| Approach | Model / provider | One application decision |
| --- | --- | --- |
| **LLM-native structured output** | Qwen 3.8 27B / Cerebras | One schema-constrained LLM response, validated and decoded locally |
| **Local tool-calling model** | Needle 3 / Cactus native runtime | One tool call, strictly validated before any simulated action |
| **Native judgment API** | Jev / TypeSafe | One request batching native Choice/Noul questions, mapped to the same application output |

“LLM-native” means using the LLM provider’s structured-output capability. The
benchmark compiles application fields into compact numeric slots, asks Qwen for
one constrained response, then reconstructs the typed result. It does not ask
Qwen to emulate Jev probabilities in this comparison. Jev's native probabilities
remain available in the exports. All paths validate outputs before applying
simulated actions. [Exact mapping and differences](docs/jev.md).

## Why Qwen on Cerebras?

We chose Qwen 3.8 on Cerebras as our fast LLM baseline, to compare Jev with a
low-latency structured-output approach. Qwen runs with reasoning disabled and a
compact output schema. This is a baseline choice, not a measured ranking of every
LLM or hosting provider.

[Cerebras' model catalog](https://inference-docs.cerebras.ai/models/overview), checked
2026-09-17, lists Qwen at approximately 1,850 output tokens/s and GPT OSS at about
3,000. Those advertised token rates are different from the end-to-end decision
latency measured here; they do not establish which model is fastest on these tasks.

## Benchmark outcomes

Measured **2026-09-17 UTC**, running both providers together through the production
side-by-side theater. All seven scenes completed; no rate limits or retries.
Static scenes used two concurrent requests per model; stateful scenes used one.

| Measurement | Qwen 3.8 27B · Cerebras | Jev · TypeSafe | Needle 3 · local¹ |
| --- | ---: | ---: | ---: |
| Validated / dispatched | 475 / 476 | 479 / 480 | 327 / 445 |
| Failed / canceled at driving deadline | 0 / 1 | 0 / 1 | 117 / 1 |
| Successful request p50 / p95 / p99 | 215 / 452 / 912 ms | 176 / 336 / 532 ms | 225 / 724 / 791 ms |
| Input / output tokens | 305,915 / 5,185 | 297,984 / 43,836 | Unavailable |
| Known estimated API cost | $0.310581 | $0.011919 | $0² |
| Sum of scene durations | 70.02 s | 55.54 s | 94.23 s |

¹ Needle measured separately **2026-09-18 UTC**, directly through the demo runtime
on an Apple M4 Pro; Qwen/Jev measured in the browser on September 17. Same contracts,
static input order and concurrency, but no browser/HTTP overhead or competing lane
for Needle. This is **not a controlled speed ranking**.
² Zero API fees excludes local hardware/electricity. Needle's median native decode
rate was **864 tok/s**, distinct from its **225 ms** median successful request.
[Needle reset-worker raw results and baseline](docs/benchmarks/needle-warm-2026-09-18/README.md).

Qwen/Jev latency measures successful browser requests; Needle measures direct
demo-runtime completion without HTTP. Scene durations exclude operator gaps; the two cloud columns overlap in
real time. Driving stops at ten seconds and cancels its outstanding request.
Unknown canceled-call usage is excluded from estimated cost.

| Exact fixture agreement / dispatched | Qwen | Jev | Needle 3 |
| --- | ---: | ---: | ---: |
| Tickets | 75/100 | 75/100 | 0/100 |
| Guardrails | 100/100 | 100/100 | 43/100 |
| Approvals | 100/100 | 95/100 | 45/100 |
| Scoring | 93/100 | 100/100 | 1/100 |
| Home | 24/24 | 15/24 | 0/24 |

Needle stopped routing after one valid hop and an invalid response. Driving produced
no valid control outputs; its 34.6 m came from initial coasting/physics. Invalid
outputs count as non-matches above; all mismatches remain in the raw results.

Qwen and Jev both reached the routing destination in eight hops. Driving covered **94.6 m /
84.2 m**, respectively, with **one collision each**. Fixture agreement is separate
from valid output: Jev matched Scoring more often, while Qwen matched Approvals
and Home more often in this run.

Jev uses batched native questions; Qwen generates one joint schema response.
Stateful inputs can diverge after different decisions. These measurements describe
one synthetic development-machine run, not calibrated quality or general model parity.
[Per-scene results, raw exports, method and limitations](docs/benchmarks/README.md).
Recompute the table data offline with `node --import tsx scripts/summarize-comparison.mjs`.

## Run the comparison

Requires **Node 22** and **npm 10**. Install once from the repository root:

```sh
npm ci
test -f .env || cp .env.example .env
```

Set `CEREBRAS_API_KEY` and `JEV_KEY` in `.env`, then start the production UI:

```sh
npm run build
npm run start:demos:live
```

Open `http://127.0.0.1:3001`. Select a scene and press **Run demo** to launch both
models together. Each lane has its own model selector; Qwen and Jev are the defaults.
Run `npm run setup:needle` with the Hugging Face CLI installed to add **Needle 3 · Local**,
then restart the demo. Needle runs on this machine with no API fees; see
[setup, validation and measurement differences](docs/needle.md).
**Stop both** cancels both lanes. Each panel has its own timing,
cost, result inspection, contract viewer and export. Export both before changing
scenes. Live runs incur charges; use a bounded budget and retain partial/failed runs.
The published session used a $2 estimated budget; the interactive UI has no
cumulative spending cutoff.

If a provider rejects its API key, the affected lane stops and names the setting
to update. Replace that key in the root `.env`, restart `npm run start:demos:live`,
and reload the page to refresh its session. An authentication failure is distinct
from a timeout or rate limit; no automatic retries or replacement answers are used.

For a local UI preview without inference, use `npm run dev`. Fixture mode uses
synthetic answers/tokens and is labeled explicitly; its timings are not model
performance. **Single model** retains individual runs and the seven-scene slideshow.

| Scene | Workload |
| --- | --- |
| Tickets | 100 customer tickets; team, priority, action and escalation |
| Routing | Model-selected moves through a street graph |
| Driving | Ten seconds of WebGPU steering and throttle decisions |
| Guardrails | 100 allow/block checks |
| Approvals | 100 proposed agent commands; none executed |
| Scoring | 100 candidate answers against golden references |
| Home | 24 commands operating simulated lights, blinds and temperature |

Static scenes share shuffled inputs and use two concurrent requests per model.
Stateful scenes start from matching setup and follow each model's own decisions.
Driving needs WebGPU on localhost or HTTPS. No real devices or external commands
are operated. [Runner guide](apps/theater/README.md).

## Interpreting the benchmark

Valid output shape, judgment quality and performance are separate measurements.
Fixture agreement is exact agreement with local expected outputs, not evidence of
calibration or general security guarantees. Repeated synthetic cases are not an
independent population sample. Native Jev questions and joint Qwen generation have
different inference semantics, especially rubric scoring. Stateful trajectories
may diverge. No retries, repaired answers or fallback outputs are hidden in results.

This is an independent benchmark, not a TypeSafe implementation or parity claim.
Raw exports preserve mistakes and native Jev probabilities. See the
[methodology](docs/benchmarks/README.md), [mapping](docs/jev.md), and
[security boundaries](docs/security.md).

## Repository and development

```text
apps/theater/   Side-by-side benchmark UI, workloads and native Jev adapter
packages/gateway/     Cerebras structured-output adapter, validation and supporting API
scripts/          Offline benchmark summarizers and media tooling
docs/benchmarks/  Raw exports, source hashes, metrics and quality comparisons
```

`npm run check` runs strict type checks, lint, offline tests and both builds.
Normal tests never use provider credentials. The standalone API and CLI examples
remain available for compatibility experiments; their separate benchmark commands
do not regenerate the paired theater report.

- [Benchmark results, methodology and reproduction](docs/benchmarks/README.md)
- [Add or inspect a workload](apps/theater/README.md#add-a-scene)
- [Architecture and delivery record](docs/plan.md)
- [Supporting API setup and examples](docs/standalone-api.md)
- [API workspace](packages/gateway/README.md) and [HTTP contract](docs/context/api_reference.txt)
- [CLI examples and separate microbenchmarks](packages/gateway/examples/README.md)
- [Engineering conventions](CONVENTIONS.md)
