# Runner-owned ASR Implementation Plan

> Execute test-first. Preserve unrelated dirty work in `builder-digest.mjs` and
> its tests.

## 1. Lock contracts with failing tests

- Extend CLI tests for `asr-doctor` profile output, persistent task artifacts,
  machine lock serialization, and `prepare-managed-media` task rewriting.
- Extend runner contract tests to require preparation before assignment and to
  forbid `extract-long-media` in the worker prompt.
- Extend Cloud sync tests with capability-deferred scheduling.
- Extend settings/user-journey tests for admin-only fetch prompt updates and
  semantic-only YouTube/podcast prompt text.

## 2. Add deterministic ASR capability and preparation commands

- Add executable-path probing and a versioned profile writer.
- Refactor local ASR to support stable work directories and stage reuse.
- Add a stale-safe machine-wide ASR lock.
- Add `prepare-managed-media --tasks <file> --out <file>` that rewrites
  successful tasks to `ready` and appends blocked/failed task outcomes.

## 3. Wire both fetch paths

- Invoke media preparation after discovery normalization and before dynamic
  shard assignment for personal and Cloud batches, including Cloud refills.
- Patch fetch/Cloud plans after preparation so logs contain actual backend and
  execution evidence.
- Remove long-media execution instructions and timeout estimation from the
  inner worker contract.

## 4. Add Cloud deferred semantics

- Reconcile an all-capability-blocked source as `deferred`.
- Finalize its run task without incrementing source failures or circuit breaker
  state; release it for a bounded retry and preserve post-level evidence.
- Keep mixed successful/blocked sources partial.

## 5. Align setup, prompts, settings, and migration

- Run `asr-doctor` in one-time, recurring, and Cloud-host setup flows; keep
  software installation interactive only.
- Rewrite default common/YouTube/podcast fetch guidance around content rules.
- Add a guarded SQL migration for known old defaults/copies.
- Enforce admin-only fetch prompt PATCH and update Settings language.

## 6. Verify

- Run focused CLI, Cloud scheduler/sync, prompt contract, and user journey
  tests while iterating.
- Run full test suite, ESLint, TypeScript/build, and prompt trace verification.
- Review the final diff for runtime parity, retry behavior, transcript
  retention, and preservation of unrelated dirty changes.
