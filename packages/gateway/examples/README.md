# Supporting API examples and microbenchmarks

The primary [Qwen / Jev benchmark](../../../docs/benchmarks/README.md) runs through
the browser comparison UI. The commands below exercise the supporting Cerebras
API separately; their results do not constitute a paired Jev comparison.

From the repository root, run `npm run examples` for seven deterministic synthetic examples against a local
HTTP stub. Run `npm run examples:live` to use Cerebras with the key in `.env`.
`-- --only=E7` selects a single example. Live runs enforce at most 32 provider calls
and a conservative $1 list-price ceiling; there are no retries. A fresh random
proxy credential is created in memory and never printed. No real user records,
real devices, transfers, or external tools are involved.

`../src/examples/fixtures.ts` defines TypeSafe requests and normal OpenAI messages/json_schema
requests. `../src/examples/policies.ts` supplies caller-side routing, simulated device actions,
guardrail decisions, and a local chart preview. `run.ts` prints only validated
results and policy decisions. Errors produce no action. Thresholds are illustrative,
not calibrated safety guarantees. Live judgments can differ from fixture labels.

Sources and adaptations are recorded in [the example catalog](../../../docs/examples.md).
The live report at `docs/live-results.json` contains actual outputs, including
wrong judgments; it is not a quality certification.

## Benchmarks

```sh
npm run benchmark
npm run benchmark:live
npm run benchmark:live -- --samples=12 --warmup=1 --concurrency=2
```

Default live run: Qwen, 1 warmup, 12 measured requests, concurrency 1. Each request
has one bounded numeric judgment; the run alternates TypeSafe and OpenAI routes.
The local-stub default measures 100 requests. Optional `--model=gpt-oss-120b`
selects that model explicitly; it is not an automatic fallback. Live sample plus
warmup count cannot exceed 32 and the conservative price estimate must stay <= $1.

Reports: `docs/benchmarks/local-stub.json` and `docs/benchmarks/live.json`. These
fixed paths are overwritten on another run; archive reports before comparing runs.
They contain sample rows, p50/p95/p99, successful request throughput, failures,
upstream/queue timing, tokens, estimated cost, environment, settings, and pricing.

- End-to-end output tokens/s uses successful token counts divided by the sum of
  successful HTTP latencies. It includes input processing and network time.
- Aggregate output tokens/s divides successful tokens by measured wall time; it
  reflects concurrency and is not individual-request decode speed.
- Provider decode tokens/s uses reported completion_time only, with its own
  coverage count. If unavailable it is null, never inferred from total latency.
- Local-and-loopback time subtracts upstream round trip and local queue wait from
  HTTP time for these single-call requests. It is not isolated CPU time.
- Cost uses reported provider input/output tokens and dated list prices, including
  reasoning tokens. Cached-token discounts, taxes, credits and account pricing are
  not modeled. Failed calls without usage make the total incomplete. Warmup is
  excluded from latency statistics but included in whole-run cost.
- Stub token counts are synthetic and real cost is zero. Tiny output payloads and
  small live samples do not establish peak tok/s, tail SLAs, or model quality.
