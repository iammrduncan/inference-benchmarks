# Embeddings

Proposed 2026-10-06, prompted by the release of EmbeddingGemma 2. Not built yet. The
build lands in M4 (the protocol and fidelity check) and M7 (the first comparison
set).

## Why embeddings belong here

An embedding model's score depends on the same factors as a chat model's, and a few
more:

| Factor | Examples | Effect |
| --- | --- | --- |
| **Version** | BF16 vs. Q8 vs. Q4 GGUF, QAT checkpoints, ONNX int8 | Vectors drift. Retrieval rankings flip near the top-k boundary first. |
| **Engine** | sentence-transformers, TEI, vLLM `/v1/embeddings`, llama.cpp, Ollama, ONNX Runtime, transformers.js, MLX | Pooling, normalization, truncation and tokenizer handling differ between engines. A wrong pooling setting silently costs points. |
| **Output dimension** | Matryoshka truncation: EmbeddingGemma 2 offers 768, 512, 256 and 128 | A deliberate quality-for-size trade. It is part of the subject, like a quant. |
| **Prompting** | Task prefixes, e.g. `task: search result \| query: …` / `title: … \| text: …` | Required by many models. Leaving them off is a harness bug, not a model property. |
| **Modules loaded** | EmbeddingGemma 2 as 740M (all), 440M (text + image), 570M (text + audio) or 270M (text only) | Different footprints for the same text quality. Worth measuring. |

The model card's numbers are for full precision at 768 dimensions. What on-device
users actually run (a 4-bit file on a phone or a laptop, at 256 dimensions) is
unmeasured. That gap is exactly what this project is for.

## Subject identity

Embedding subjects use the same key, with the output dimension added to the quant
segment:

```
embeddinggemma-2/hf-<rev>/gguf-q4_k_m-<producer>-d256/llamacpp-<build>
embeddinggemma-2/hf-<rev>/bf16-d768/sentence-transformers-<ver>
```

- `identity.output: {dims, normalize, modules}` is recorded on every subject.
  `modules` lists the encoders loaded (`[text]`, `[text, vision]`, …).
- The reference subject is the release checkpoint at full precision and native
  dimension, in the model card's own runtime (sentence-transformers here).

## Protocol: `embeddings`

| Engine family | Wire format | Adapter |
| --- | --- | --- |
| vLLM, llama.cpp server, TEI, Ollama, Infinity, most clouds | OpenAI `POST /v1/embeddings` (`input`, `dimensions`) | `openai-embeddings` |
| Multimodal inputs | No common standard. vLLM accepts chat-style `messages` with image and audio parts; others have their own shapes. | One adapter per engine, recorded in `engine` |
| sentence-transformers, MLX, ONNX Runtime, transformers.js | No server | A small pinned serve wrapper per runtime, as an `inference-engines` generic recipe (`generic/st-embed`, …) that exposes `/v1/embeddings` |

`bench` applies the model card's documented prefixes from the subject's
`prompting` record. The prefixes used are hashed into the run, and a run without
the card's prefixes is labeled.

## Harness: bench embeds, MTEB scores

This follows the same rule as everything else ([harness.md](harness.md)): one
client generates, and the pinned scorer never calls a model.

1. **Export.** A pinned `mteb` environment lists every input string, image and clip
   for the chosen tasks, with its role (query or document) and modality. It writes
   them as a manifest with content hashes.
2. **Embed.** `bench` sends them through the subject's endpoint, in batches, with
   the card's prefixes. It stores the vectors in `.artifacts/` (float32, hash-checked).
   Vectors are large, so raw data is always behind a pointer (5 MB rule). `raw.jsonl`
   keeps the requests, timings, counts and hashes, not the vectors.
3. **Score.** `mteb` runs its own task logic with a lookup encoder that returns the
   stored vectors. If an input has no stored vector, scoring fails loudly. Results
   are MTEB's own metrics (NDCG@10, MRR@10, Spearman, V-measure, accuracy).

Calibration: before a suite is `ready`, run the reference subject through both
`bench`-embed + lookup-score and plain `mteb` with the model loaded directly. The
two must agree to within 0.1 points per task.

## Fidelity (P0, runs first)

This is the cheapest and most direct measure of quant and engine drift:

- 2,000 fixed texts: 1,000 queries and 1,000 passages from mixed MTEB sources,
  plus 200 images and 200 audio clips when the model has those encoders.
- Embed them with the reference subject and with the candidate, at the same
  dimension.
- Report:
  - **mean and p1 cosine** between paired vectors;
  - **top-10 neighbor overlap** (Jaccard) for every query against the passage pool;
  - **Spearman correlation** of the pairwise similarity matrix.

Verdicts follow D18:

| Verdict | Rule (provisional, revisited after the first runs) |
| --- | --- |
| broken | mean cosine < 0.90, or top-10 overlap < 0.50 |
| degraded | mean cosine < 0.98, or top-10 overlap < 0.80 |
| faithful | otherwise |
| lossless | mean cosine ≥ 0.999 and top-10 overlap ≥ 0.98 (an engine swap at the same precision should land here) |

Comparing different dimensions is not fidelity. A 256-dimension subject is checked
against the reference truncated to 256 dimensions.

## Core set: one category per modality

The rule is that each modality the subject supports is run; each is small enough
for the 24-hour budget on modest hardware. Embedding is mostly prefill, which fast
cards do easily. On the P100 or a phone-class device, the time planner measures
throughput first.

| Pri | Suite | Items | Why |
| --- | --- | --- | --- |
| P0 | **embedding-fidelity** | 2,000 texts (+ images / audio) | Catches broken quants and engines in minutes |
| P0 | **MTEB(eng, v2)** | the official 41-task English benchmark, already downsampled by its authors | The standard text comparison. The card reports 68.46 |
| P1 | **MTEB(Code, v1)** | official code retrieval tasks | The card's headline gain (78.68). Code search is a common local use |
| P1 | **MTEB(Multilingual, v2)** | official downsampled set, 250+ languages | The card reports 61.36. Heaviest text suite, so P1 |
| P1 *(vision)* | **MIEB(lite)** | 51 tasks | The card reports 64.64 |
| P1 *(audio)* | **MAEB** | 30 tasks | The card reports 49.39 |
| P2 | MMEB v2, MSEB, MVEB (video), visual-document retrieval | — | `full` tier only |
| P1 | **perf-embed** | 1k / 8k-token texts at batch 1, 8 and 64; images and clips | Inputs per second, latency per input, **peak memory**. On-device claims like "567 MB RAM" get measured, not quoted |

All MTEB sets are pinned by `mteb` version and task revision, and scored with MTEB's
own aggregation (mean over tasks, or over task types for MIEB) so they line up with
the official leaderboards. Our own interval is a bootstrap over tasks, so the number
of tasks is visible.

## First embeddings run set (M7)

Using EmbeddingGemma 2 as the forcing case:

| Axis | Subjects |
| --- | --- |
| Reference | BF16, 768 dimensions, sentence-transformers, all modules |
| Dimension | the same at 512, 256 and 128 |
| Quant | Q8_0 and Q4_K_M GGUF on llama.cpp, once community or official GGUFs exist; ONNX int8 |
| Engine | vLLM `/v1/embeddings`, TEI, Ollama, transformers.js (browser and on-device) |
| Modules | 270M text-only vs. 740M full, same text tasks: confirms the text scores do not change |
| Hardware | P100, Apple M-series, a phone-class device (perf-embed and memory) |
| Peers | Qwen3-Embedding (0.6B / 4B), BGE-M3, jina-embeddings-v4, a hosted API (OpenAI or Gemini embeddings) |

The site's model-matrix view works unchanged. For an embedding checkpoint, the
columns are engines and the rows are quant × dimension.

## Open questions

- **E1. Text-only first?** Recommendation: build text first (MTEB eng, Code and
  fidelity). Image and audio wait for a second engine besides sentence-transformers
  that serves EmbeddingGemma 2's encoders; otherwise there is no engine comparison
  to make.
- **E2. Rerankers.** Cross-encoder rerankers are a natural sibling category, sharing
  the same retrieval tasks. Recommendation: later, as their own category.
