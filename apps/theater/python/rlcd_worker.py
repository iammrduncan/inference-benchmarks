#!/usr/bin/env python3
"""Pinned RLCD subprocess boundary. JSONL on stdio; no HTTP or dynamic imports."""

import argparse
import contextlib
import json
import os
import sys


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    if not os.path.isdir(args.source) or not os.path.isfile(os.path.join(args.model, "model.safetensors")):
        raise RuntimeError("Pinned RLCD artifacts are unavailable")
    sys.path.insert(0, args.source)
    with contextlib.redirect_stdout(sys.stderr):
        import core.engine_mlx as engine
        from core.schema import StructuredSchema
        engine.MODEL_ID = args.model
        _, tokenizer = engine.get_engine()
    emit({"type": "ready"})
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if not isinstance(request_id, int) or not isinstance(request.get("context"), str):
                raise ValueError("Invalid request")
            schema = StructuredSchema(request.get("schema"))
            metadata = schema.compile_parallel_metadata(tokenizer)
            collision_fields = [name for (name, _), collision in zip(metadata["field_items"], metadata["has_collisions"]) if collision]
            with contextlib.redirect_stdout(sys.stderr):
                result = engine.run_parallel_generation(request["context"], schema, temperature=1.0)
            result["collision_fields"] = collision_fields
            emit({"id": request_id, "ok": True, "result": result})
        except Exception:
            emit({"id": request_id, "ok": False, "error": "inference_failed"})


if __name__ == "__main__":
    main()
