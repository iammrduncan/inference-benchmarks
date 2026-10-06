# Hardware fit: choosing quant × engine × hardware

These are estimates for picking options in step 3. They aren't results. Label every
number you show the user as an estimate, and replace it with measurements once
engine health has run.

## Memory fit

```
weights_bytes ≈ params × bits_per_weight / 8          (use real file sizes when they exist)
kv_bytes      ≈ 2 × layers × kv_heads × head_dim × context × batch × kv_bytes_per_elem
total         ≈ weights_bytes + kv_bytes + engine overhead (≈ 1–2 GB on GPU; more for vLLM's preallocation)
```

- Read `layers`, `num_key_value_heads`, `head_dim` (or `hidden_size / num_attention_heads`)
  and the context from `config.json`.
- Hybrid or SSM layers carry no KV cache. Count only the attention layers.
- For MoE models, the **total** parameters must fit in memory. The **active**
  parameters set the speed.
- Leave ≥ 10% headroom. A fit at 98% will fail at the long-context workloads.
- Typical effective bits per weight:

| Quant | Bits/weight |
| --- | --- |
| BF16/FP16 | 16 |
| FP8 / Q8_0 | ~8.5 |
| Q6_K | ~6.6 |
| Q5_K_M | ~5.7 |
| Q4_K_M | ~4.8 |
| AWQ/GPTQ 4-bit | ~4.25 |
| NVFP4 | ~4.5 |
| IQ3_XXS | ~3.1 |
| MLX 4-bit | ~4.5 |

## Speed estimate (single stream)

Decode is usually memory-bandwidth-bound:

```
decode_tok_s ≈ effective_bandwidth / bytes_read_per_token
bytes_read_per_token ≈ active_params × bits / 8      (+ KV read at long context)
effective_bandwidth ≈ 50–70% of the spec bandwidth   (lower for immature kernels/old GPUs)
```

Prefill is compute-bound, so estimate it from earlier runs on the same hardware
(`results/**/perf`). If there are none, say "unknown" and let engine health measure
it. Then plug both into `core-set.md`'s time formula to project `core` hours.

## Hardware notes

Verify each entry against the user's inventory and the engine's current docs. Engine
support changes.

| Hardware | Memory | Notes for choosing |
| --- | --- | --- |
| **Tesla P100** (Pascal, sm_60) | 16 GB HBM2 per card, ~732 GB/s | No FP8, no BF16 math, no tensor cores. Current vLLM and FlashAttention don't target it. Use llama.cpp-family engines (our P100 work is llama.cpp-derived with custom sm_60 kernels), GGUF and EXL-style quants. Prefill is the bottleneck, so keep long-context categories small. A 27B model needs ≤ ~4.5 bpw on one card, or a split across cards. **Measured (owner, 2026-10-06, Qwen 3.8 27B on our private engine): ≈ 130 tok/s prefill at 32K, ≈ 28 tok/s decode with MTP-1.** Use these instead of the bandwidth formula when sizing P100 runs. Agentic suites need the engine's **prefix caching** on; without it they don't fit the budget. |
| **DGX Spark / GB10** | 128 GB unified LPDDR5x, ~273 GB/s | Blackwell: NVFP4 and FP8 are native, vLLM is the reference engine. Large models fit, but decode is bandwidth-limited. Two Sparks give TP=2 (the `mia-tp2` recipe pattern). It is the usual home for **reference subjects** (BF16). |
| **Apple M-series** | unified; bandwidth depends on the chip | MLX (mlx-lm) and llama.cpp Metal. Take the chip's memory and bandwidth from the inventory. Good for MLX-vs-GGUF engine comparisons on the same quant level. |
| **ESP32-S3** (16 MB PSRAM, 32 MB flash) | tiny | Only purpose-built engines (esp32-needle-3). Model depth or size is the knob; recipes flash the device (`device_writes`), which always needs approval. |
| **B60, BC-160, Radeon VII, V100** | — | Placeholders in inference-engines. No recipe has run on them yet, so treat any fit as unknown and say so. |
| **Cloud API** | n/a | No quant or engine choice; checkpoint and quant are opaque. Needs a `--budget-usd`. |

## Building the options

Good option sets vary **one axis at a time** around the recommendation, so the
results answer a question:

- *Same engine, different quants* (Q8_0 vs Q4_K_M vs IQ3) → the quant tax.
- *Same quant level, different engines* (GGUF/llama.cpp vs MLX vs vLLM AWQ) → engine
  drift.
- *Same subject, different hardware* → speed only. Quality should match, and if it
  doesn't, that's a bug worth reporting.

Always include the option the model card recommends, and say which option that is.
