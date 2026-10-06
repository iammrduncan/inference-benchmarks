# Output containment and prompt injection

The benchmark has two validated inference paths: LLM-native structured output
through the Cerebras adapter, and native Jev answers through the
[Jev adapter](../../decisions/docs/jev.md). Native Jev probabilities are validated and retained; they
are not computed by the compatibility proxy described below. Both paths can
return structurally valid but incorrect judgments.

The supporting proxy's two HTTP endpoints share the same numeric inference boundary. Cerebras receives a
strict closed schema for `{"p":[...]}`. Every element is a finite, bounded number
or a bounded integer index. Its raw response is never forwarded to a client.
The server validates the envelope, finish reason, output shape, count, types and
ranges, then reconstructs a new response from approved values. TypeSafe Choice
and Score probabilities must also cover their criteria and sum to one within the
documented tolerance. Selection, score, confidence and legends are computed locally.

OpenAI output schemas cannot contain unconstrained strings, open objects, variable
length arrays, tools, refs, or unsupported keywords. String outputs are fixed
caller-provided enum members or constants selected through numeric indices.
Boolean values are decoded from 0/1. TypeSafe text metadata (IDs, options, legends)
comes from the caller; it is not new model-generated prose. Input-supplied text can
therefore appear where the public contract explicitly echoes it.

Refusal, truncation, malformed JSON, duplicate keys, extra output fields, prose,
wrong types, out-of-range numbers, and invalid distributions fail closed with a
sanitized error. Provider reasoning, tool calls, errors, identifiers, and arbitrary
metadata cannot be copied into the public answer. Explicit non-null tool calls are
rejected. Optional numeric timing goes only to internal telemetry; validated token
counters also populate the public usage fields.
No tools, URLs, code, or device operations from model output are executed.

Cerebras and proxy keys are separate and never put into prompt content. Logs use
server-generated IDs, status, timing, model and token counts, not credentials,
state, prompts, completions or reasoning. Responses are bounded, jobs are admitted
atomically, disconnect/deadline aborts work, and no automatic repair/retry/fallback
can bypass the gate. Qwen reasoning is disabled; GPT OSS may reason internally,
but its reasoning channel is discarded.

## What this does not prove

This is **output containment**, not a proof that prompt injection cannot affect a
judgment or leak information through permitted selections/numbers. Even a boolean
can encode a bit of sensitive context. A bounded decimal can encode more. Never
supply secrets that the caller is not authorized to learn about and assume a type
gate makes them inaccessible. Malicious context can bias a perfectly valid answer.
Schema-valid estimates are not calibrated probabilities or guarantees of truth.

The live synthetic run demonstrates this distinction: every response passed the
gate, but the smart-home scope was wrong and two hazard checks were missed. The
injection canary string and reasoning did not escape. Those observations are kept
in `live-results.json`; they do not establish universal resistance.

## Verification

Offline HTTP-stub tests inject arbitrary explanation text, extra fields, malformed
content, duplicate keys, stringified numbers, out-of-range values, invalid sums,
refusals, tool calls, truncated output and oversized upstream responses. They check
that no raw error/reasoning sentinel appears in the reply. Additional tests cover
OpenAI SDK parsing, prototype-like keys, rejected input making zero calls,
queue admission, timeouts, disconnects, sibling cancellation and permit release.
Synthetic example tests cover caller action allowlists and review/error branches.
