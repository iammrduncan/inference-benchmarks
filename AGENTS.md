# Agent instructions

## Mission

Maintain **inference-benchmarks** (renamed from typesafe-ai-benchmark): benchmarks
for **model × version × engine**. A score is never just the model's. It depends on
the checkpoint and quant being run, on the engine running it, and on the harness
measuring it. We vary and measure the first three, and hold the harness constant.

- Subjects come from three kinds of target: an `inference-engines` recipe, a hosted
  cloud model, or a Hugging Face link served by a standard engine.
- The `bench` runner sends every request and records every byte; pinned scorers
  grade the captured outputs offline.
- The flagship decisions comparison (Qwen 3.8 on Cerebras vs. TypeSafe Jev, now
  extended to System One decision models) and its theater remain central.
- Preserve raw results, failures and mapping differences. Never hide a retry, a
  repair or a fallback.

The plan, its decisions and the M0–M8 build order are in
[docs/design/](docs/design/README.md); read `build-plan.md` before structural
work. Benchmark API keys come from 1Password through `op run` (see the Secrets
section of `build-plan.md`); never write a resolved key to disk.

The repository uses TypeScript, Node 24, npm workspaces (`packages/*`, `apps/*`),
Fastify, Next.js and Zod. Inspect existing code before adding tooling. Preserve
validation and cancellation on every provider path. Do not claim universal rankings:
every result is for a stated subject, suite version, settings profile and tier.

## Read first

1. Read [CONVENTIONS.md](CONVENTIONS.md) for implementation and verification rules.
2. Read the relevant code, tests, package scripts, and any scoped `AGENTS.md` files.
   Trace the affected request path and callers before proposing a change.
3. Use the human-owned [engineering principles](.agents/skills/engineering/reference/GOOD_ENGINEERING_H.md)
   and [ladder](.agents/skills/engineering/reference/ladder.md) for judgment.
   Do not edit those references to justify an implementation.

This file owns agent workflow; `CONVENTIONS.md` owns technical rules. `CLAUDE.md`
imports both. Keep each rule in one place. Explicit user instructions take priority
over repository guidance. More specific directory instructions apply to their scope.
If guidance conflicts, state the conflict and resolve it explicitly.

## Engineering judgment

- Understand the problem before judging the proposed solution. State what you do
  not know; distinguish observed behavior, assumptions, and recommendations.
- Climb the ladder: is the work necessary; does the repo already solve it; can the
  standard library, platform, or an installed dependency solve it; what is the
  smallest readable implementation? Never simplify away boundary validation,
  security, failure handling, or an explicit requirement.
- For a significant design, compare at least two approaches on simplicity,
  latency, correctness, and reversal cost. Record the choice and its tradeoffs near
  the implementation or in a short decision document when it spans modules.
- Prefer a working vertical slice and deep modules with narrow interfaces. Avoid
  provider frameworks, plugin registries, speculative configuration, and wrappers
  that only forward calls. Let shared abstractions emerge from actual use.
- Respect existing behavior. Trace why a guard exists before removing it. Fix bugs
  at the shared cause, inspect sibling callers, and add a regression check.
- Refactor in small working steps. Preserve unrelated user changes. Do not expand
  a task into a cleanup, migration, or product feature without a concrete need.

## Working agreement

- Act on implementation requests and finish the authorized work. Investigate facts
  yourself. Ask only when a missing decision materially affects scope, correctness,
  expense, or an irreversible action; continue independent work meanwhile.
- A request to review is read-only. When the
  [engineering skill](.agents/skills/engineering/SKILL.md) is invoked, follow the
  requested command and its reference. A separate explicit instruction to implement
  authorizes implementation; a finding by itself does not.
- Referenced skills are optional tooling unless the task invokes them. If a skill
  is unavailable, say so and use a small equivalent workflow where possible. Do not
  invent commands or make missing companion skills a dependency of routine work.
- Before changing code, identify the observable result and the smallest meaningful
  check. Before adding a dependency, explain the complexity it removes.
- Make a short progress update for substantial work. Surface evidence that changes
  the approach. Communicate plainly; do not give unsupported completion estimates.
- Do not expose credentials, commit local environment files, or send real user data
  to an upstream provider as incidental verification. Use synthetic fixtures.

## Compatibility discipline

Treat the public contract as a product feature. Consult the linked official sources
in `packages/gateway/CONVENTIONS.md` when implementing a gateway endpoint, and record the source date and
supported behavior in tests or compatibility documentation. Upstream docs can change
or disagree. Never infer a missing rule from a plausible example and call it exact.

Keep the four claims in `CONVENTIONS.md` separate: wire compatibility, quality,
performance, and subject identity. A valid JSON response proves neither calibrated probabilities nor equivalent model
behavior. A benchmark of local validation proves neither provider latency nor total
request latency. Unsupported behavior must be rejected or documented as a deliberate
compatibility limitation, never silently approximated.

## Definition of done

- The requested behavior works end to end, including the relevant failure path.
- Changed boundaries and invariants have meaningful checks. Bug fixes have regression
  coverage. Performance claims have reproducible measurements.
- Run the repository's relevant type checks, lint, tests, and build when available.
  Use actual package scripts; do not invent a successful command or add unrelated
  tooling merely to check a documentation edit.
- Review the diff for scope, secrets, unnecessary dependencies, and documentation
  drift. Update setup commands and compatibility notes when behavior changes.
- Report what changed, why, checks actually run, and remaining limitations. If a
  check could not run, state that plainly. Never describe an approximation as parity.
