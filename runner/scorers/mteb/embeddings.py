"""Offline MTEB scoring for bench. This program never calls a model.

collect  Run the MTEB tasks with an encoder that only records each input, with the model's own
         prompt applied by MTEB's priority rules. Writes manifest.jsonl: {"text", "sha256"},
         one line per unique final text. bench embeds these through the subject's endpoint.
score    Run the same tasks with an encoder that looks vectors up by text hash, once per output
         dimension (truncate, then L2-normalize). Optionally compare with a reference run's
         vectors (fidelity). Writes scores.json.

Vectors are float32 .npy files whose rows follow the manifest order.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import tempfile
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)

import mteb  # noqa: E402
from mteb.cache import ResultCache  # noqa: E402
from mteb.models import ModelMeta  # noqa: E402
from mteb.models.abs_encoder import AbsEncoder  # noqa: E402

DIM = 768


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def meta(name: str) -> ModelMeta:
    return ModelMeta(loader=None, name=f"bench/{name}", revision="0", release_date=None, languages=None,
                     n_parameters=None, memory_usage_mb=None, max_tokens=None, embed_dim=DIM, license=None,
                     open_weights=None, public_training_code=None, public_training_data=None, framework=[],
                     similarity_fn_name="cosine", use_instructions=None, training_datasets=None)


class Prompted(AbsEncoder):
    """Applies the model's prompts exactly as MTEB's SentenceTransformer wrapper selects them."""

    def __init__(self, prompts: dict[str, str], name: str):
        self.model_prompts = prompts
        self.mteb_model_meta = meta(name)

    def texts(self, inputs, task_metadata, prompt_type) -> list[str]:
        key = self.get_prompt_name(task_metadata, prompt_type)
        prefix = self.model_prompts.get(key, "") if key else ""
        out: list[str] = []
        for batch in inputs:
            out.extend(prefix + t for t in batch["text"])
        return out


class Collector(Prompted):
    def __init__(self, prompts: dict[str, str]):
        super().__init__(prompts, "collector")
        self.seen: dict[str, str] = {}

    def encode(self, inputs, *, task_metadata, hf_split, hf_subset, prompt_type=None, **kwargs):
        texts = self.texts(inputs, task_metadata, prompt_type)
        for t in texts:
            self.seen.setdefault(sha(t), t)
        rng = np.random.default_rng(len(self.seen))  # placeholder vectors; these scores are discarded
        v = rng.standard_normal((len(texts), DIM)).astype(np.float32)
        return v / np.linalg.norm(v, axis=1, keepdims=True)


class Lookup(Prompted):
    def __init__(self, prompts: dict[str, str], index: dict[str, int], vectors: np.ndarray, dim: int):
        super().__init__(prompts, f"lookup-d{dim}")
        self.index, self.dim = index, dim
        v = vectors[:, :dim].astype(np.float32)
        self.vectors = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)  # re-normalize after truncation

    def encode(self, inputs, *, task_metadata, hf_split, hf_subset, prompt_type=None, **kwargs):
        texts = self.texts(inputs, task_metadata, prompt_type)
        missing = [t for t in texts if sha(t) not in self.index]
        if missing:
            raise SystemExit(f"{len(missing)} input(s) have no stored vector (e.g. {missing[0][:80]!r}); re-run collect and embed")
        return self.vectors[[self.index[sha(t)] for t in texts]]


def evaluate(model, task_names: list[str]) -> dict[str, dict]:
    tasks = mteb.get_tasks(tasks=task_names)
    with tempfile.TemporaryDirectory() as tmp:
        result = mteb.evaluate(model, tasks, cache=ResultCache(tmp), overwrite_strategy="always", show_progress_bar=False)
    out = {}
    for tr in result.task_results:
        out[tr.task_name] = {"main_score": round(float(tr.get_score()), 6), "revision": tr.dataset_revision}
    return out


def fidelity(manifest: list[dict], cand: np.ndarray, ref: np.ndarray, dim: int) -> dict:
    def norm(v):
        v = v[:, :dim].astype(np.float64)
        return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    a, b = norm(cand), norm(ref)
    cos = np.sum(a * b, axis=1)
    # Neighbor overlap: queries against documents, within the pooled manifest.
    q = [i for i, m in enumerate(manifest) if m["role"] == "query"][:1000]
    d = [i for i, m in enumerate(manifest) if m["role"] == "document"][:20000]
    overlap = None
    if q and len(d) >= 10:
        ta = np.argsort(-(a[q] @ a[d].T), axis=1)[:, :10]
        tb = np.argsort(-(b[q] @ b[d].T), axis=1)[:, :10]
        overlap = float(np.mean([len(set(x) & set(y)) / len(set(x) | set(y)) for x, y in zip(ta, tb)]))
    return {"n": int(len(cos)), "mean_cosine": round(float(cos.mean()), 6), "p1_cosine": round(float(np.percentile(cos, 1)), 6),
            "min_cosine": round(float(cos.min()), 6), "top10_overlap": None if overlap is None else round(overlap, 6),
            "queries": len(q), "documents": len(d)}


def verdict(f: dict) -> str:
    # docs/design/embeddings.md: provisional thresholds, revisited after the first runs.
    if f["mean_cosine"] < 0.90 or (f["top10_overlap"] is not None and f["top10_overlap"] < 0.50):
        return "broken"
    if f["mean_cosine"] >= 0.999 and (f["top10_overlap"] is None or f["top10_overlap"] >= 0.98):
        return "lossless"
    if f["mean_cosine"] < 0.98 or (f["top10_overlap"] is not None and f["top10_overlap"] < 0.80):
        return "degraded"
    return "faithful"


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect"); c.add_argument("--tasks", required=True); c.add_argument("--prompts", required=True); c.add_argument("--out", required=True)
    s = sub.add_parser("score")
    for a in ("--tasks", "--prompts", "--manifest", "--vectors", "--out"):
        s.add_argument(a, required=True)
    s.add_argument("--dims", default="768,512,256,128")
    s.add_argument("--reference", help="reference run's vectors (same manifest) for fidelity")
    a = p.parse_args()
    prompts = json.loads(Path(a.prompts).read_text())
    tasks = a.tasks.split(",")
    if a.cmd == "collect":
        col = Collector(prompts)
        roles: dict[str, str] = {}
        orig = col.texts
        def texts(inputs, task_metadata, prompt_type):  # remember each text's role for fidelity sampling
            out = orig(inputs, task_metadata, prompt_type)
            for t in out:
                roles.setdefault(sha(t), "query" if str(prompt_type) == "PromptType.query" or getattr(prompt_type, "value", None) == "query" else "document")
            return out
        col.texts = texts  # type: ignore[method-assign]
        evaluate(col, tasks)
        with open(a.out, "w") as f:
            for h, t in sorted(col.seen.items()):
                f.write(json.dumps({"sha256": h, "text": t, "role": roles.get(h, "document")}) + "\n")
        print(json.dumps({"texts": len(col.seen), "mteb": mteb.__version__}))
        return
    manifest = [json.loads(line) for line in open(a.manifest)]
    vectors = np.load(a.vectors)
    if vectors.shape != (len(manifest), DIM):
        raise SystemExit(f"vectors {vectors.shape} do not match the manifest ({len(manifest)} x {DIM})")
    index = {m["sha256"]: i for i, m in enumerate(manifest)}
    ref = np.load(a.reference) if a.reference else None
    out = {"mteb": mteb.__version__, "tasks": tasks, "by_dim": {}}
    for dim in [int(x) for x in a.dims.split(",")]:
        scores = evaluate(Lookup(prompts, index, vectors, dim), tasks)
        entry = {"tasks": scores, "mean_main_score": round(float(np.mean([v["main_score"] for v in scores.values()])), 6)}
        if ref is not None:
            f = fidelity(manifest, vectors, ref, dim)
            entry["fidelity"] = {**f, "verdict": verdict(f)}
        out["by_dim"][str(dim)] = entry
    Path(a.out).write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({d: v["mean_main_score"] for d, v in out["by_dim"].items()}))


if __name__ == "__main__":
    main()
