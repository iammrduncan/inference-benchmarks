# System One decision models: benchmarks and landscape

Research checked 2026-10-05. All the figures below are **as reported** by their
sources: vendor cards, blogs, and self-reported leaderboard entries. None of them has
been reproduced by us. They are here to shape the plan, not to be quoted as results.

## Why this matters for the plan

The repo's audience starred it for **Qwen (structured LLM output) vs. Jev (a decision
model)**. Since then a whole model class has formed around Jev's interface:

- **What these models do.** You send *state* plus typed questions:
  - **Choice**: pick one of N options.
  - **Score**: a position on an ordinal rubric.
  - **Noul**: P(true) for a statement.

  The model returns a calibrated probability distribution, usually from one
  forward pass, with no text generated.
- **Who makes them.** Open-weights models now exist at every size, from 17M (in the
  browser) to 27B and 80B. They are served by different engines (vLLM, Transformers,
  ONNX, GGUF, MLX), and there are at least two official and two community benchmarks.

That is exactly the **model × quant × engine** question, applied to a model class
nobody ranks across engines yet. It is the strongest way to keep the current
audience while widening the repo's scope.

## Benchmarks found

| Benchmark | Owner | What it is | Size | Metrics | License | Use for us |
| --- | --- | --- | --- | --- | --- | --- |
| **typed-decisions** ([dataset](https://huggingface.co/datasets/LocalLLaMA/typed-decisions)) | LocalLLaMA org on HF, tagged **`benchmark:official`** on the Hub | One unstructured state + 5 typed questions per row; gold answers are **probability distributions**, not labels | 4 workflows × (300 train / 100 test); `test` = 400 cases × 5 questions = **2,000 decisions** (the `all` config combines the four). Rev `d0e2f0c`. | accuracy (headline), KL from gold, Brier, ECE | Apache-2.0 | **Adopt.** This is the Hugging Face benchmark you remembered. It is the most standard, and it can feed the Hub's official leaderboard. |
| **S1MB**, System One Mosaic Benchmark ([blog](https://huggingface.co/blog/hotchpotch/system-one-mosaic-benchmark), [code](https://github.com/hotchpotch/S1MB), [data](https://huggingface.co/datasets/hotchpotch/s1mb-dataset), [board](https://huggingface.co/spaces/hotchpotch/S1MB-leaderboard)) | Yuichi Tateno (hotchpotch), community | Mosaic of existing NLP sets, Open-Jev and Laya tasks, and synthetic tasks; plus 6 **generalization** sets (600 questions, written by an LLM, not human-validated) | 137 benchmarks (59 Noul, 57 Choice, 21 Score), 14,009 cases / 26,269 judgments | Borda score; baseline-adjusted Task Avg (balanced accuracy for Noul; best-of-random/constant for Choice; MAE vs constant for Score); Choice target-mass; Noul Brier | code MIT; data per source | **Adopt** (card tier). It is broad, has an adapter contract and records provenance. Report **familiar** and **generalization** separately, as its author does. |
| **JevBench** ([repo](https://github.com/fstandhartinger/jevbench), board at benchmarkheaven.com/jev-models) | Benchmark Heaven (not affiliated with TypeSafe) | Hand-written decisions: routing, answer adequacy, policy yes/no, intent, ordinal severity, enum extraction; easy, standard, hard and judge tiers | v1.2: 534 decisions. Public: 72 original + 111 hard + 48 easy; the rest are held out. | chance-corrected accuracy; ECE / Brier; log-scaled speed; log-scaled $ per 1k decisions; **harmonic-mean composite**; ordinal MAE; paraphrase consistency | MIT (harness + 72 originals) | **Adopt the public items and the quality metrics only.** Don't adopt its composite: it assumes self-hosted latency ×2 + 0.15 s, and it measures latency from Germany. |
| **dhruvmehra/jevbench** ([repo](https://github.com/dhruvmehra/jevbench)) | community | Classic classification: SST-2, AG News, Banking77 (500 seeded each). Compares Jev, Laya, cheap and frontier LLMs, fine-tuned DistilBERT, and zero-shot NLI | 1,500 | accuracy, macro-F1, ECE (10 bins), p50/p95, throughput, $ per 1k | MIT | **Adopt as smoke.** It is cheap, and the only one that puts LLMs, encoders and decision APIs on the same label descriptions. |
| **jev-eval** ([repo](https://github.com/finnhll/jev-eval)) | community | A conformance harness, not a benchmark: 282 recorded Jev responses through OpenRouter | 282 | invariants; batched vs. separate; repeat stability; option-order sensitivity; monotonicity | — | **Adopt the checks** as our `decision-conformance` suite. |

Hub mechanics that matter (from [this write-up](https://dev.to/ward_ed_6b5e6aa8ded94a987/how-hugging-face-official-benchmark-leaderboards-actually-work-evalresults-yaml-the-basemodel-29bo); worth re-checking against Hugging Face's own docs before relying on it):

- A dataset tagged `benchmark:official` gets a leaderboard assembled from
  `.eval_results/*.yaml` files in model repos. Anyone can propose one by PR.
- About 48 benchmarks are official, including GPQA.
- **Every entry is self-reported.** None of the sampled rows were `verified: true`.
- The default view **hides any model whose card declares `base_model`**:
  quantizations, fine-tunes and adapters. That is about 30% of entries.

**Our gap to fill:** the Hub's default view hides exactly the quants and adapters we
care about, and nothing there is independently run. A site that runs every subject
itself, and treats quants as first-class, complements the Hub instead of competing
with it.

## Models and engines found

| Model | Params / base | How it is served | Reported results | License |
| --- | --- | --- | --- | --- |
| **TypeSafe Jev 1.13** | proprietary | TypeSafe API `POST /v1/systemone`; also **OpenRouter Decisions API** (`POST /api/alpha/decisions`, `typesafe/jev-latest`) | S1MB #1 (Borda 86.51); JevBench v1.4.1 #1 at 63.3 (2026-09-23); typed-decisions 0.727–0.754 | closed |
| **autotrust/JEV-27B** ([card](https://huggingface.co/autotrust/JEV-27B)) | **Qwen3.8-27B** + LoRA (r=16) + 24-slot decision head, 108.9M trainable | vLLM with `POST /v1/decide` (`serve_decide.py`); Transformers + PEFT. bf16 only. | JevBench 88.70% vs Jev 87.18% (its own numbers); 137 ms single / 4.2 ms batched on B200; System 2 HumanEval unchanged | Apache-2.0 |
| autotrust/JEV-9B | Qwen-based, System 1 + 2 | as above | — | open |
| **Open-Jev 9B / 27B** ([code](https://github.com/Zefan-Cai/Open-Jev)) | LoRA + scalar decision head on Qwen3.5-9B / 27B | Python | S1MB #3 / #4 | open |
| **Laya** (Convai) | ModernBERT-large 421M (English); mmBERT 322M (multilingual); a typed-decisions fine-tune | encoder, ~33 ms on T4 | zero-shot typed decisions 0.362 (below the 0.461 majority baseline, per its own card); td checkpoint 0.766 | Apache-2.0 |
| **Bekko System One v0** ([blog](https://huggingface.co/blog/hotchpotch/bekko-system-one-v0-release)) | 17M / 68M / 400M encoders, shared-prefix KV reuse | PyTorch; **ONNX in the browser** (17M ≈ 29 MB) | S1MB #2 (400M); generalization far below Jev. Its author discloses that 77 of its training subset names overlap S1MB. | open (check per model) |
| **OpenDecider** ([blog](https://huggingface.co/blog/manjunathshiva/opendecider-beats-laya-and-jev)) | nano ~400M encoder → 80B (Qwen3 + LoRA) | PyTorch, **MLX, GGUF** (Ollama / LM Studio), Docker | typed-decisions: nano 0.796, small-td 0.792 (**small-td trained on that benchmark's train split**) | Apache-2.0 (most) |
| meraGPT Decider 1, Liquid AI d1, Cloudflare Clef-flash (9B) | various | various | typed-decisions board: 0.768, 0.742 | check |

Patterns that matter for us:

1. **The same weights are served several ways.** Examples: OpenDecider in PyTorch,
   MLX and GGUF; Bekko in PyTorch and ONNX; Jev directly and through OpenRouter.
   Decision quality can shift with quant and engine, so these are our subjects.
2. **System 1 and System 2 share a base.** JEV-27B is Qwen3.8-27B plus a head. We can
   compare decisions from the head with Qwen3.8-27B's own structured output, on the
   **same backbone, in the same engine**. That pair gives the cleanest answer
   anywhere to "do you need a decision model?"
3. **Training contamination is common and only partly disclosed.** It shows up as
   checkpoints fine-tuned on a train split, and as overlapping subset names.
4. **Calibration doesn't transfer.** Several write-ups note that calibration belongs
   to a model *and a data distribution* (for example, a reported 0.976 AUROC with
   "shy" raw probabilities). Calibration on a benchmark is not calibration on your
   own traffic.
5. **Option order changes confidence,** even when the chosen option stays the same
   (jev-eval, JevBench). This is cheap to measure and rarely reported.

## What we add to the plan

These are reflected in the other documents. Summary:

1. **A `decisions` suite family** (see [benchmarks.md](benchmarks.md#decision-suites-system-one)):
   - `decisions-scenes`: our theater scenes, the existing suite.
   - `typed-decisions`: HF official.
   - `s1mb`: split into familiar and generalization.
   - `jevbench-public`
   - `decisions-classic`: SST-2, AG News, Banking77.
   - `decision-conformance`
2. **Decision-specific metrics**, alongside accuracy:
   - KL from gold, Brier, ECE, log loss;
   - chance-corrected accuracy;
   - ordinal MAE for Score;
   - option-order sensitivity and paraphrase consistency;
   - single-decision latency **and** batched per-decision cost / throughput;
   - $ per 1k decisions.

   When a subject returns no distribution, calibration is shown as **N/A, not 0**.
   Because of that, we never build a composite that a missing axis can sink or
   inflate.
3. **A decision protocol.** Subjects can speak one of:
   - `openai` (chat);
   - `decision` (canonical: TypeSafe's `/v1/systemone` shape);
   - an adapter mapped onto `decision`: OpenRouter `alpha/decisions`, vLLM
     `/v1/decide`, or a local encoder worker.

   Chat LLMs reach the decision suites through `packages/gateway`, the existing
   "imposter Jev" proxy, either in its JSON-schema mode or in a new **logprob mode**
   that reads option probabilities from engines that return logprobs. **This gives
   the gateway a clear job and settles open question Q3: keep it.**
4. **Contamination metadata on subjects.**
   - The `trained_on` field lists datasets and splits.
   - `overlap` lists disclosed overlaps.

   The site flags a row "trained on this benchmark's train split", and the default
   view ranks unflagged rows only. The flagged rows stay visible with a toggle.
5. **Hub export.**
   - `bench export-hf <run>` writes `.eval_results` YAML for official benchmarks
     (`typed-decisions`, GPQA, …) with `source.url` pointing at our run.
   - We open the PR on our **own** model repos. On anyone else's model repo, only a
     person decides to open the PR, never automation.
6. **First decision-model run set** (see [benchmarks.md § First runs](benchmarks.md#first-runs)):
   - Jev, direct vs. via OpenRouter;
   - JEV-27B head vs. Qwen3.8-27B structured output on the same vLLM;
   - OpenDecider nano in PyTorch vs. MLX vs. GGUF quants;
   - Bekko 17M/68M in PyTorch vs. ONNX;
   - Laya base vs. its td checkpoint (flagged);
   - Needle 3 in tool-call mode.

## Resolved questions (2026-10-06)

- **Q7. Hosted latency.** *No same-region VM.* JevBench measures from Germany and
  scales self-hosted numbers by an assumed ×2. We do neither: latency is measured
  from wherever the runner runs, that location is recorded, and nothing is scaled.
- **Q8. Held-out data.** *Yes.* `decisions-sealed`: about 100 owner-labeled cases in
  the typed-decisions row shape. They live in the private repo
  `iammrduncan/inference-benchmarks-sealed`. Item hashes and scores are public, and an
  exposure log records every third-party endpoint the items were sent to. See
  [core-set.md](core-set.md).
- **Q9. typed-decisions size.** Checked on the Hub (`datasets-server`) at revision
  `d0e2f0c` (2026-10-01):
  - Four workflows (`agent_trace_observability`, `customer_service`,
    `invoice_processing`, `security_incidents`), each **300 train / 100 test**.
  - The `all` config is the four combined (1,200 / 400), not extra data.
  - So `test` = **400 cases × 5 questions = 2,000 decisions**, which matches
    OpenDecider's "2,000 questions".
  - Facts from the card that shape our suite:
    - The gold is a spread over three teacher samples, so teacher self-agreement
      (≈ 0.735 accuracy) is a soft ceiling, and much higher scores suggest the model
      learned the teacher's quirks.
    - The card scores each case **whole** (state + all five questions in one
      request) and notes that request shape changes scores, so we do the same.
    - The card keeps a separate table for models fitted on `train`. Our
      contamination flag matches that.
    - Two more zero-shot decision APIs on its board speak `/v1/systemone`:
      meraGPT Decider 1 and Liquid AI d1. That confirms the choice of the canonical
      protocol, and both are candidate subjects.
