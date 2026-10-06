# Records this skill writes

The layout follows `subjects-and-results.md` in the plan. If the repo
has since diverged from it, follow the repo, and tell the user about the difference.

## `subjects/<subject-key>/subject.yaml`

One per subject, written in step 5 and updated only by later intakes or PRs.

```yaml
key: qwen3.8-27b/hf-4f2a91c/gguf-q4_k_m-unsloth/llamacpp-b6120     # quality key
hardware: [p100x1]                         # speed keys this subject has runs on
model: qwen3.8-27b
checkpoint:
  hf: Qwen/Qwen3.8-27B-Instruct
  revision: 4f2a91c…                        # full SHA
  adapter: null                             # {hf, revision} for LoRA/heads
quant:
  format: gguf
  scheme: Q4_K_M
  producer: unsloth
  repo: unsloth/Qwen3.8-27B-Instruct-GGUF
  revision: …
  files: [{name: …Q4_K_M.gguf, sha256: …}]
engine: {name: llama.cpp, version: b6120, image: …@sha256:…, flags: {kv_cache: f16}}
protocols: [openai]
purpose: [general, coding]
recipe: {id: qwen3.8-27b/p100/q4km, inference_engines_commit: …}   # or generic/<engine> + params
reference: qwen3.8-27b/hf-4f2a91c/bf16/vllm-0.14.2
settings_profiles: [greedy-nothink, card]
card_settings: {temperature: 0.7, top_p: 0.8, thinking: false, source: <model card URL>}
trained_on: []                               # [{dataset, split, source}]
overlap: []                                  # [{suite, note, source}]
source_link: {kind: hf, url: https://huggingface.co/Qwen/Qwen3.8-27B-Instruct}
engine_visibility: public                    # private → scores published with the
                                             # "private engine, not reproducible" badge;
                                             # no engine repo URL or commit anywhere public
```

## `subjects/<subject-key>/INTAKE.md`

The research record, written as you go. It needs these headings:

1. **Link and kind**: what was given, the date, and who asked.
2. **What it is**: the architecture and anything non-standard, with sources.
3. **Released artifacts**: weights, code and licenses, with pins. Note gated or
   non-commercial terms.
4. **Reported results**: a table with columns benchmark | score | settings | source.
   Mark these "reported, not measured here".
5. **Options considered**: the step-3 table, the recommendation, **the user's
   decision**, and the rejected options with reasons.
6. **Implementation**: the recipe ID (reused or new), the branch/PR, and the run-plan
   disclosure.
7. **Runs**: a link to each run folder, with its outcome (passed, partial or failed)
   in one line.
8. **TODOs and handoffs**.

## Run folders

`results/<subject-key>/<suite>/<YYYY-MM-DD>-<tier>-<profile>-<shortid>/`, holding
`run.json`, `summary.json`, `raw.jsonl` (or `raw.pointer.json` for raw data over
5 MB), and `harness/`. The runner writes these; don't write them by hand. If you
import results produced by the inference-engines launcher before the runner existed,
mark them `imported: true` with the source path and hash.

## Reference registry

`results/references.yaml` has one reference per checkpoint. Add one only through a
PR the user approves, and never point it at a provider-opaque, unverified-identity,
or `engine_visibility: private` subject.
