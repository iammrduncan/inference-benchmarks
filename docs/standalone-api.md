# Supporting API and compatibility examples

The primary project is [typesafe-ai-benchmark](../README.md): LLM-native structured
output from Qwen 3.8 on Cerebras compared with native TypeSafe Jev. This page covers
the supporting Cerebras proxy and its separate compatibility examples. The paired
benchmark uses its joint-schema path, not the per-question compatibility endpoint.

## Standalone API quick start

Requires **Node 22** and **npm 10**. From this checkout, try all seven examples
without credentials or paid inference:

```sh
npm ci
npm run examples
```

To start the real Cerebras-backed server:

```sh
# Create the file only if it does not already exist.
test -f .env || cp .env.example .env
```

Edit `.env`: set `CEREBRAS_API_KEY` and a **different** `PROXY_API_KEY` of at least
16 characters. Keep both private; clients use only the proxy key. Then:

```sh
npm run build
npm start
```

The server loads `.env` and listens at `http://127.0.0.1:3000`. In another terminal,
set `PROXY_API_KEY` to the same proxy key from `.env`, then make a judgment:

```sh
export PROXY_API_KEY='your-proxy-key-from-.env'
curl --fail-with-body http://127.0.0.1:3000/v1/systemone \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "jev-latest",
    "state": "Please refund the duplicate charge.",
    "questions": {
      "refund": {"type": "noul", "instructions": "Is money requested back?"}
    }
  }'
```

The response contains `answers.refund.noul` in `[0,1]`, actual token usage, and
`model: "qwen-3.8-27b"`. `jev-latest` is only a compatibility alias; it does not
select Jev. The probability is model-estimated, not guaranteed to be correct.

For an ordinary OpenAI-compatible request:

```sh
curl --fail-with-body http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen-3.8-27b",
    "messages": [{"role": "user", "content": "Please refund the duplicate charge."}],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "routing", "strict": true,
        "schema": {
          "type": "object",
          "properties": {"department": {"type": "string", "enum": ["billing", "technical", "other"]}},
          "required": ["department"], "additionalProperties": false
        }
      }
    }
  }'
```

`choices[0].message.content` contains JSON such as `{"department":"billing"}`.
For an OpenAI SDK client, set `baseURL: 'http://127.0.0.1:3000/v1'`, use the proxy
key, and supply a supported strict schema. Set `maxRetries: 0` when measuring
calls and cost. [Complete SDK example](examples.md#ordinary-openai-sdk-call).

## Want a different inference backend?

Ask your coding agent to make the swap. This currently requires code changes;
changing an environment variable alone will not configure another provider.
Copy this prompt and replace the bracketed provider name:

> Replace Cerebras with [provider and model] as the inference backend. Read
> AGENTS.md and CONVENTIONS.md first. Trace packages/gateway/src/cerebras.ts and its callers in
> packages/gateway/src/evaluate.ts, then inspect model validation in packages/gateway/src/contracts.ts, startup
> configuration in packages/gateway/src/index.ts, and pricing in packages/gateway/src/metrics.ts. Verify the target
> provider's official structured-output support, tuple schemas, reasoning controls,
> usage fields and cancellation behavior. Adapt the compact numeric schema if
> necessary while preserving local type/range/length/distribution checks and both
> public HTTP contracts. Keep keys server-side, sanitize errors, and retain bounded
> bodies, queueing, deadlines, cancellation and zero automatic retries. Reject
> unsupported behavior explicitly. Update model IDs, .env.example, examples,
> benchmark preflight/pricing/timing extraction and documentation. Do not invent
> provider timings or infer parity from its OpenAI-compatible URL. Run the HTTP
> stub tests, npm run check and offline examples. Keep live verification separate,
> synthetic and within an explicit spend bound. Keep the change small; a provider
> plugin framework is unnecessary.

