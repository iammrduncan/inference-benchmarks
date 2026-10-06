# Supporting API examples

For the project’s main LLM-native Qwen / Jev comparison, see the
[benchmark runner](../apps/theater/README.md) and [results](benchmarks/README.md).
The examples below document the separate compatibility API.

Checked 2026-09-16. Seven synthetic workflows run through the actual proxy and
shared validation gate. The two public interfaces are demonstrated directly;
OpenAI messages do not contain a hidden TypeSafe request. Run instructions are
in [CLI instructions](../packages/gateway/examples/README.md); fixtures and policies live in
[fixtures.ts](../packages/gateway/src/examples/fixtures.ts) and [policies.ts](../packages/gateway/src/examples/policies.ts).

## Official source mapping

| ID | Workflow / endpoint | Official source | Implemented adaptation |
| --- | --- | --- | --- |
| E1 | Ticket triage / systemone | [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul) | Three isolated judgments: team, refund request, urgency; caller routes or reviews. |
| E2 | Smart home / systemone | [Smart-home demo](https://docs.typesafe.ai/demos/smart-home) | Five speculative judgments; caller validates the relevant combination and changes simulated lights only. |
| E3 | Thirteen questions / systemone | [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) | Eight Nouls, two Choices, three Scores over a synthetic policy memo; four-call concurrency limit. |
| E4 | Function selection / chat completions | [Function calling](https://docs.typesafe.ai/cookbooks/function_calling) | String enums and boolean select an allowlisted local list/summary/chart preview. No tools or generated code. |
| E5 | Guardrails / systemone | [LLM guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails) | Four hazard Nouls plus severity Score; caller pass/review/block policy and synthetic injection canary. |
| E6 | Structured rubrics / systemone | [Advanced structure](https://docs.typesafe.ai/primitives/advanced) | Object/array-valued state, descriptions and legend for an invoice judgment. |
| E7 | Ordinary OpenAI schema / chat completions | [Chat Completions](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions) | Normal messages and response_format; enum department and bounded refund number. |

The [TypeSafe demo index](https://docs.typesafe.ai/demos) links the smart-home
[video](https://www.loom.com/share/18c4dbcf8db546dfb2d7f2ef018e78e4); the video was
discovered, not watched. The page promises source at release without an inspected
repository link. These are documented workflow adaptations, not a source port.
The parallel-questions source uses a GDPR article; our demo uses synthetic text.

## Run and interpret

```sh
npm run examples
npm run examples:live
npm run examples:live -- --only=E7
```

Offline uses deterministic numeric provider fixtures, including a reasoning
sentinel that must never appear in public output. Live uses the key in `.env`,
Qwen, no retries, 31 total calls across the full seven examples, and a conservative
$1 per-run ceiling. Only synthetic data is sent. The live result file is overwritten
on the next live run; preserve it separately to compare experiments.

Each runner prints validated results, timings and caller decisions. Errors return
an error/no-action branch. Policies are demonstration thresholds, not calibrated
safety rules. Smart-home tests cover conversation/decomposition stubs, clarification
and ignored irrelevant fields. Guardrail tests cover pass/review/block and malformed
results. Function dispatch tests reject names outside the local allowlist.

The live run returned HTTP 200 for all seven examples with no canary or reasoning
leak in public output. That is a structural result, not seven correct judgments:

- E1 selected billing, a refund request, and the explicit-deadline urgency level.
- E2 selected kitchen even though the message said every lamp. Its simulated
  outcome would leave the hall unchanged. High confidence did not prevent the error.
- E3 returned all eight policy checks true and owner security; the burden score
  remained a fractional subjective estimate.
- E4 selected the requested chart preview for series B, week, with volume.
- E5 missed the secret-request and format-attack hazards. Other hazards/severity
  still made the caller policy block. This single case is not a detector evaluation.
- E6 selected Arbor Studio and matching invoice/terms judgments.
- E7 selected billing and a refund probability of 1.

Exact values, measured inference times and actual usage are in
[live-results.json](live-results.json). Caller policies were added to that saved
report through offline replay after inference; no live values were changed.
The examples' elapsed times use Fastify injection plus real upstream inference;
use the [dedicated benchmark](benchmarks/README.md) for actual local HTTP round trips.

## Ordinary OpenAI SDK call

The `openai` package is a development dependency and is exercised by integration
tests against a real local HTTP stub-backed proxy. A client of the running server
can use this normal request:

```ts
import OpenAI from 'openai';
const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3000/v1',
  apiKey: process.env.PROXY_API_KEY,
  maxRetries: 0,
  timeout: 20_000,
});
const completion = await client.chat.completions.create({
  model: 'qwen-3.8-27b',
  messages: [{ role: 'user', content: 'Please refund the duplicate payment.' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'routing', strict: true,
      schema: {
        type: 'object',
        properties: {
          department: { type: 'string', enum: ['billing', 'technical', 'other'] },
        },
        required: ['department'], additionalProperties: false,
      },
    },
  },
});
console.log(completion.choices[0]?.message.content, completion.usage);
```

Assistant content is JSON text such as `{"department":"billing"}`. Standard usage
stays in completion.usage. String outputs must be declared enums/constants;
arbitrary explanation fields fail before inference. For full Choice/Score
probability distributions and locally derived confidence, use `/v1/systemone`.
There is no automatic semantic interpretation of generic schema field names.

## Follow-on evaluations

The first examples are runnable vertical slices. Larger labeled corpora,
false-positive/negative rates, calibration/Brier scores, a reproduced GDPR workload,
batched/sequential comparisons, rendered UI and generative decomposition are future
work. None is claimed by these examples or required to run the proxy.

## Interactive Next.js application

The seven-scene reel lives in `apps/theater`: ticket dispatch, street routing,
WebGPU driving, guardrails, approvals, scoring and home automation. Home automation
runs 24 shuffled commands against current simulated device state. Scoring has an
adjustable strict >90% default validity threshold. Click scene items to inspect their
input/output. The original gallery routes have been removed. Run `npm run dev` for fixtures or
`npm run dev:live` for Cerebras. [Extension guide](../apps/theater/README.md).
