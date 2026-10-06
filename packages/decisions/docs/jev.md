# Native Jev lane: mapping and benchmark semantics

The Jev lane in **typesafe-ai-benchmark** calls TypeSafe's real `jev-latest` model
directly, alongside LLM-native structured output from Qwen 3.8 on Cerebras. Set `JEV_KEY`
in the root `.env` (or `TYPESAFE_API_KEY`, which takes precedence), run
`npm run build && npm run start:demos:live`, then use the side-by-side view or choose **Single model → Jev · TypeSafe**.
The key stays on the server. Models without credentials are disabled. Jev-only
configuration works in Single model mode; its default is Qwen when both providers
are configured.
Restart an existing production server after rebuilding and refresh its browser tab.

This is a theater integration, not a change to the standalone compatibility API.
The standalone proxy's historical `jev-latest` alias still selects Cerebras.
The theater's Jev option instead sends `POST https://api.typesafe.ai/v1/systemone`
with the TypeSafe credential, never through that alias. The UI labels the provider
**TYPESAFE / JEV**. Exports retain both the requested alias and the actual returned
model revision (for example `jev-1.13.0`).

## Same scenes, native questions

Both providers use the same synthetic inputs, allowed actions, navigation graph,
physics, home state, rubric criteria and final scene validators. Native Jev asks
all questions for an item together in **one HTTP request**, with shared state.

| Scene | Native mapping |
| --- | --- |
| Tickets | Choice for team, priority and action; Noul for escalation |
| Routing | Choice among the current legal directions |
| Driving | Choice for steering and throttle |
| Guardrails / approvals | Choice between allow and block |
| Scoring | One Noul per weighted criterion, plus Noul for complete validity |
| Home | Choice for apply/clarify, four lights, blinds and allowed temperature |

Choice labels map directly, including numeric temperature labels. Noul becomes
true only when its probability is **strictly greater than 0.5**; a tie is false.
Scoring adds each criterion's existing points when its Noul passes that threshold.
This preserves the integer 0–100 output contract without pretending a native
weighted Score is an exact point total. The separate display threshold remains
strict `accuracy > 90` by default and is adjustable without inference.

The mapping is **`jev-scenes-v1`**. All native answers, probabilities and confidence
values remain in session exports, alongside the exact native request, returned
model revision, question count, usage, real timings and local decision. The contract
dialog shows native Choice/Noul questions and the actual `/v1/systemone` request.
No expected fixture labels are sent to the live provider.

## Design and limits

Two approaches were considered: extend the standalone generic schema proxy to
translate any schema to Jev, or add a narrow native adapter for the seven existing
scenes. The latter avoids changing public alias semantics or claiming support for
arbitrary schemas. It reuses scene descriptions and validators, adds no dependency,
and uses one upstream round trip per item. Its tradeoff is an explicit local
mapping for rubric scoring rather than a universal schema translator.

Cerebras produces one joint schema completion; Jev evaluates native questions.
Those are different inference tasks even with the same input/output application.
Latency or fixture-agreement comparisons must record that distinction and the
question count. No quality, calibration or speed parity is claimed.

Native responses must have exactly the requested answer IDs and types, every
Choice probability key, finite probabilities/confidence in [0,1], and a selected
maximum-probability option. Distribution sums tolerate at most 0.001 rounding
drift; native values are never normalized or rewritten. Bad output fails closed.
Requests have a 16-second deadline, bounded bodies and five-request admission;
cancellation propagates, permits are released on failure, and there are no retries,
repair or fallback to Cerebras. Upstream error bodies and credentials are not exposed.

Jev estimates use **$0.04 per million input tokens, free output**, supplied by the
account owner on 2026-09-17. Reported token usage is real; the displayed arithmetic
is an estimate, not an invoice. Failed/canceled requests with unknown usage are
excluded and may still be billed. Fixture mode is explicitly labeled, uses
synthetic probabilities/tokens and costs zero.

Offline HTTP-stub tests cover all seven scenes, credential isolation, native
payloads, answer validation, deadlines/cancellation, overload, error sanitization,
no retries and pricing semantics. The initial integration smoke test below used one synthetic request per scene.
The subsequent [full paired benchmark](https://github.com/iammrduncan/inference-benchmarks/blob/typesafe-v1/docs/benchmarks/README.md) now measures all
seven scenes through the production comparison UI.

Official contract checked **2026-09-17**:
[TypeSafe API](https://docs.typesafe.ai/api) and
[native primitives and batching](https://docs.typesafe.ai/primitives).

## Live integration smoke — 2026-09-17

Seven synthetic requests through the demo runtime reached real **jev-1.13.0**;
all seven returned complete, validated outputs. Reported usage was **6,705
input / 770 output tokens**, estimated **$0.00026820** at the supplied
price. No warmup, retries or fallback; this was one request per scene, not a full
reel or latency comparison. [Requests, native responses and timings](https://github.com/iammrduncan/inference-benchmarks/blob/typesafe-v1/docs/jev-smoke.json).

The home answer set the requested kitchen to bright and also returned hall=bright
instead of unchanged. The hall was already bright, so the simulated state did not
change there; this remains a judgment mismatch, not a perfect-match claim.
Routing and driving were single decisions, not complete navigation/control runs.
These smoke results remain separate from the later full paired benchmark.

## Side-by-side theater

The default theater view pairs **Qwen 3.8 27B / Cerebras** with **Jev / TypeSafe**.
Select a scene and press **Run demo** to start both; **Stop both** cancels both.
Each panel has its own results, wall time, throughput, estimated cost and export.
Both credentials are required in live mode. Single-model mode remains available.

The same shuffled workload is supplied to both players. Static scenes use two
requests per model at a time (four total, below the shared five-request limit).
Home, routing and driving remain sequential within each model, starting from
matching state and following that model's own decisions. Consequently their later
contexts can differ; driving request counts depend on inference speed. Navigation
destination and displayed scoring threshold are shared between panels.

The comparison reuses two existing player lifecycles rather than introducing a
paired backend endpoint. This preserves cancellation, validation and per-provider
exports without an extra server orchestration layer. Both runs are launched from
one click, without a response barrier that would slow the faster model; this is
concurrent observation, not a claim of identical network dispatch timestamps.
