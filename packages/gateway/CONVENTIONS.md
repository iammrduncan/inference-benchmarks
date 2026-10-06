# Gateway conventions: TypeSafe compatibility

This package (`@decision/gateway`) is the compatibility proxy that speaks TypeSafe's
`/v1/systemone` decision protocol. In the benchmark it is the adapter that lets a
chat LLM answer decision suites (see `docs/design/harness.md`). These rules
apply to work in this package, in addition to the repository's
[CONVENTIONS.md](../../CONVENTIONS.md).

## Compatibility contract

The following upstream reference was checked on **2026-09-16**. It is a starting
contract, not a claim that this scaffold already implements it.

| Surface | Compatibility target | Source |
| --- | --- | --- |
| HTTP | `POST /v1/systemone`, bearer authentication, JSON; request contains `state`, `model`, `questions`; response contains `model`, `answers`, `usage` | [API](https://docs.typesafe.ai/api) |
| Questions | `choice`, `score`, `noul`; return answers under the caller's IDs; IDs are not inference context; questions share state and are evaluated independently | [Primitives](https://docs.typesafe.ai/primitives) |
| Choice | Option map; answer includes `type`, `choice`, `probabilities`, `confidence`; selection is a maximum-probability option; distribution covers every option; documented maximum is 255 options | [Choice](https://docs.typesafe.ai/primitives/choice) |
| Score | Ordered criteria with 2–10 levels; answer includes `type`, `score`, `legend`, `probabilities`, `confidence`; zero-based level indices become string keys in JSON; score is the probability-weighted mean | [Score](https://docs.typesafe.ai/primitives/score) |
| Noul | Optional `true`/`false` criteria descriptions; answer contains `type` and `noul`, a probability in `[0, 1]`; no separate confidence | [Noul](https://docs.typesafe.ai/primitives/noul) |
| Confidence | Derived from the distribution; the referenced page does not specify the exact formula | [Confidence](https://docs.typesafe.ai/confidence) |

## Resolve uncertainty explicitly

- The API reference and primitive guides differ on accepted criteria value shapes:
  the guides allow structured descriptions, while the API lists narrower types in
  places. Record the accepted subset and evidence before freezing a schema. Do not
  accidentally restrict `instructions` to strings; the API also allows objects and
  arrays. State accepts strings, objects, or arrays.
- The API documents `401`, `422`, `429`, and `529`, but does not fully define the
  error body. Define and test our stable error contract and mark deviations. Do not
  claim byte-for-byte error compatibility without evidence.
- Do not invent TypeSafe's confidence formula. Choose and document a deterministic
  approximation if needed, with edge cases and fixtures, and label the difference
  in compatibility documentation. Never substitute the winning probability without
  recording that decision.
- Define model alias resolution explicitly. A TypeSafe model name cannot silently
  imply that its proprietary model is running. Document aliases, actual provider
  models, and the response `model` policy; reject unknown names.
- Record unknown rules such as tie-breaking, unknown fields, empty maps, size limits,
  and partial failures as local decisions until verified. Keep extensions out of
  the compatibility payload unless explicitly designed and documented.
