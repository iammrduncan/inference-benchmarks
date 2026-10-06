# Needle in the demo

The comparison now accepts any available model independently in its left and right
lanes, including the same model on both sides. Qwen and Jev remain the defaults.
Changing a model clears that lane's results; selections are locked during a run.

## Local setup

Install the [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli),
then run `npm run setup:needle` from the repository root. This downloads the official
native executable and full 20-layer CQ2 weights into ignored `.artifacts/needle/`.
The repository and revision are pinned in `apps/theater/needle-release.json`.
No API key, Python runtime package, training dependencies, or cloud endpoint is used
for inference. Restart `npm run start:demos:live` after installation.

The launcher discovers those files on supported Mac, Linux and Windows platforms.
Keep the pinned executable and weights together so exports identify the model used.
Model files and generated verification results must never be committed.

## Mapping and measurement

Sources checked through 2026-09-19:
[native CLI](https://cactuscompute.com/blog/needle-supported-devices),
[tool design](https://cactuscompute.com/blog/designing-tools-for-needle),
[extraction](https://cactuscompute.com/blog/structured-extraction-with-needle),
[official model](https://huggingface.co/Cactus-Compute/needle3).

Each request exposes one record-only tool whose parameters use the existing scene
schema and policy descriptions. It is never executed. The CLI uses `--forced` to
require a structured selection, `--depth 20`, schema-sized response caps from 24 to
512 tokens, and `--fail-input-overflow` to reject oversized context instead of
silently trimming it.
The contract viewer records the actual input, schema, flags, and revision.
This is a deliberate adapter mapping, not wire or judgment parity with Cerebras
or Jev. Needle's native engine may perform its own deterministic grounding/repair;
our adapter never repairs or retries its answer.

Exactly one correctly named call is required. Missing calls, multiple/conflicting
calls, invalid types, extra fields, and illegal actions fail local validation.
Suppressed calls and reasoning are discarded, never promoted to successful output.
Small smoke checks returned valid results for five of seven scenes; guardrails and
scoring produced conflicting calls and were rejected. Valid responses also showed
judgment errors. These observations are not an accuracy benchmark.

Latency includes queueing, schema preparation, any cold native process startup/model
load, inference and validation; warm requests reuse loaded workers. The engine reports prefill/decode rates and peak
RAM; these are exported separately as `nativeMetrics`, not substituted for wall
time. It does not report token counts: `usage` is null and the UI says “Not reported”.
Per-request engine metrics appear inside the fixed-height output inspector so
incoming successes and failures do not resize the comparison lanes.
Cost is zero API fees only; local hardware/electricity are excluded. Fixture mode
remains explicitly labeled and does not invoke Needle.

## Response-cap correction — 2026-09-19

The v1 adapter copied Needle's 512-token default to every scene. Direct raw probes
showed that the model often produced one complete call, kept generating, and added a
second conflicting call. The public validator correctly rejected the ambiguity, but
the oversized budget both increased latency and turned usable first decisions into
failures. Taking the first call would hide a real conflict; changing worker count or
model depth did not address it.

Mapping v2 instead budgets enough native output for one complete scene schema:
24 tokens for routing, guardrails and approvals; 32 for driving and scoring; 160 for
Home. Dispatch retains 512 because its four-field call lost valid outputs at smaller
measured caps. The strict exactly-one-call boundary is unchanged.

On the full direct-runtime replay, guardrails changed from 78/100 validated in
8.46 seconds to 100/100 in 2.80 seconds, with exact fixture agreement improving from
43 to 70. Approvals changed from 91/100 in 19.54 seconds to 100/100 in 3.49 seconds;
scoring changed from 48/100 in 30.35 seconds to 100/100 in 9.53 seconds. Routing
completed all eight hops to the target instead of failing on hop two, and driving
produced 53 valid controls instead of none. Across the seven scene durations,
successful throughput rose from 3.47 to 8.42 decisions/s.

This fixes output validity and wasted generation, not every judgment. Tickets and
Home still had zero exact fixture matches, approvals stayed at 45/100, and scoring
fell from one exact match to zero. The official guidance describes Needle as strongest
at narrowly named tool selection and grounded argument extraction; these shared tasks
also require abstract judgment, planning and control. The
[mapping-v2 report](benchmarks/needle-capped-2026-09-19/README.md) retains all failures
and mismatches.

## Execution choice

The original adapter chose one native process per request for straightforward
isolation and cancellation. The [same-input rerun](benchmarks/needle-warm-2026-09-18/README.md)
measured enough overhead on static scenes to justify a bounded reset-worker path:
at most two workers per unchanged tool schema, one request at a time per worker,
with `POST /reset` before each independent completion. The pinned native server
binds localhost, and workers expire after five idle seconds. Canceling a request
kills and discards its worker; queued cancellations never reach the engine.
The shared five-request admission bound and 16-second deadline include queue wait.

An alternative was simply raising caller concurrency from two to four while keeping
fresh processes. On representative inputs that improved throughput much less and
increased individual/tail latency under CPU contention. Warm workers cost more
process lifecycle code and briefly retain model RAM between requests; the small
two-worker, idle-expiring pool trades that complexity for a measured 28.6% reduction
in the seven-scene duration. Navigation still uses one-shot processes because
legal-move schemas vary by junction. A changed schema for another scene falls back
to one-shot execution rather than reusing a worker with stale tools. Neither path
retries, repairs, or accepts invalid calls. This is concurrency across independent
inputs, not native batch inference or a TTFT measurement.

## Latency and routing investigation — 2026-09-17

Measured on this demo host (Apple M4 Pro, 14 CPU cores), using the pinned release
above, the installed macOS arm64 executable, requested depth 20, forced calls and a
512-token generation limit. These are small diagnostic samples, not provider
rankings. Only synthetic local inputs were used; no paid provider was called.

| Workload | Samples | Median request time | Median engine decode rate |
| --- | ---: | ---: | ---: |
| Short weather request, fresh process | 3 | 74.7 ms | 1,296 tok/s |
| Short weather request, reused process | 5 | 39.9 ms | 1,352 tok/s |
| Original routing first hop, fresh process | 3 | 1,329.2 ms | 547 tok/s |
| Original routing first hop, reused process | 5 | 1,254.9 ms | 553 tok/s |
| Original routing first hop, four simultaneous processes | 4 | 2,348.5 ms | 369 tok/s |

Fresh timings include process startup and inference. Reused timings include a
conversation reset and local HTTP request, but exclude worker startup; startup was
measured separately at 47.9 ms for weather and 81.0 ms for routing. They must not be
presented as equivalent cold measurements. The reused process was an investigation
only at that time; the static adapter adopted reset workers on September 18.
Four simultaneous graph
calls are a contention stress check: live navigation is sequential per lane, so two
Needle routing lanes normally produce at most two simultaneous graph calls.

The [vendor's Raspberry Pi 5 headline](https://cactuscompute.com/needle) is
400–4,000 decode tokens/s, not complete application decisions/s. Our simple request
already falls inside that range. The default navigation input is 3,253 UTF-8 bytes
plus the tool schema: all 25 junctions, coordinates, open roads, costs, closures,
legal moves and visited state. This is a graph-planning task rather than the short
command extraction examples on the vendor page. Native output also contains
generated reasoning that our response boundary discards. Its work still contributes
to elapsed time. No token counts or precise prefill/decode durations are reported
by this executable, so those phases are not assigned invented durations.

Keeping the routing worker loaded saved about 74 ms (5.6%); startup is not the main
bottleneck for this prompt. A compact representation preserving all open roads and
costs cut the initial prompt to 750 bytes and the first request to 567.5 ms (one
sample), but did not solve the decision failures.

### Historical routing failure at the 512-token v1 cap

The default route starts at junction 20 and targets junction 4. The first answer is
`north`, reaching 15. For state `{position:15,target:4,visited:[20,15]}`, Needle emits
two calls to `decide_navigate`, with `move: "south"` and `move: "east"`. Both are legal
enum values individually, but there is no single next decision. `decodeNeedle`
requires exactly one call and correctly rejects this with `invalid_provider_output`.
The live demo reproduced HTTP 200 for the first hop (1,432.2 ms server time), then
HTTP 502 for the second (1,446.0 ms). This is not a timeout.

One offered tool and `--forced` do not constrain the number of calls: Needle supports
multiple calls in one response. An experimental explicit “exactly one call” prompt
produced single calls but looped `20 → 15 → 20 → 15 → 20`. The compact graph instead
returned conflicting `east` and `west` calls on its second hop. These candidates
were not applied to the live demo. Silently taking the first call, replacing it
with a pathfinder, or retrying until success would conceal the failure.

### Earlier implementation choices

For latency, a reusable worker with explicit reset and cancellation is appropriate
for repeated short commands; a smaller equivalent graph representation targets the
larger routing cost. Neither change establishes graph-planning competence. For the
existing benchmark, keep failures visible and evaluate a routing-specific fine-tune
against unchanged held-out routes. For an application demo, another honest option
is a separately labeled hybrid: Needle extracts the destination and a conventional
planner computes the route. That changes what is being evaluated and must not replace
model-directed routing silently.

Raw synthetic responses, experiment scripts and summaries from this earlier diagnosis are preserved locally in
ignored `.artifacts/needle-diagnosis/`: `probe.ts`/`probe.json`, `warm.ts`/`warm.json`,
`variants.ts`/`variants.json`, `live-route.json` and `summary.json`. Run the scripts
from the repository root with `node --import tsx .artifacts/needle-diagnosis/<name>.ts`.
The diagnostic depth (4/8/20) and thread (1/2/4) sweeps did not show a material speed
change in this pinned executable; these flags are not treated as demonstrated
optimizations. No live inference code or benchmark timing was changed by this
investigation.

### Comparison with Cactus's interactive routing demos

Inspected the live [sandbox and its public source](https://cactuscompute.com/needle3/sandbox.html)
on 2026-09-17, including AR glasses, car and robot vacuum examples. The navigation
preset produces a `navigate_to` call with a destination and travel mode. In the AR
glasses handler, JavaScript derives the displayed turn and distance from a hash of
the destination. The car renderer draws a fixed SVG route once a destination is
set. The vacuum exposes actions such as `go_to_room`, `clean_room`, `move` and
`rotate`; application code assigns room coordinates and performs the movement and
cleaning sequence. Multiple calls are deliberately supported.

Those are real model tool-selection and argument-extraction demonstrations with a
simulated environment. They do not demonstrate the model finding a path through a
street graph. Our per-hop navigation benchmark asks a different question. Matching
their approach would mean adding an explicitly labeled command-to-navigation demo,
not treating a displayed animation as evidence that Needle chose each turn.

## Published seven-scene benchmark

The original [one-shot local run](benchmarks/needle/README.md), the
[reset-worker rerun](benchmarks/needle-warm-2026-09-18/README.md), and the current
[schema-capped rerun](benchmarks/needle-capped-2026-09-19/README.md) include all seven
shared workloads, unmodified per-request results, failures, fixture mismatches,
engine rates, environment hashes and reproduction commands. The final rerun
validated 470/486 requests with a 161 ms median successful direct-runtime latency;
the reset-worker v1 run validated 327/445 at 225 ms and the one-shot baseline
validated 327/442 at 403 ms. All are separate from the historical Qwen/Jev browser
run, not simultaneous latency comparisons.
