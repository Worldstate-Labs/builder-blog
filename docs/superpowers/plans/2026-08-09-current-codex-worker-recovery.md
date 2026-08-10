# Current Codex Runtime And Worker Recovery Implementation Plan

## 1. Lock model resolution behavior

- Add shell-level tests with a fake Codex executable for Luna success, Luna
  incompatibility followed by `gpt-5.4-mini` success, explicit-model failure,
  and total failure before fetch or cloud lease acquisition.
- Cover regular fetch, cloud fetch, and AI Brief entry points.

## 2. Implement current-executable preflight

- Add a portable bounded probe to `scripts/builder-agent-runner.sh`.
- Classify only explicit model incompatibility/unavailability as fallback-safe.
- Export and report the selected model before downstream Node commands run.

## 3. Lock worker exit recovery behavior

- Add tests proving a dead incomplete worker is terminalized before its lane is
  reused, and that the resulting failure contains log evidence.
- Add tests proving runtime-wide incompatibility opens the circuit breaker.
- Add cloud-specific tests proving leases are released instead of content being
  marked failed.

## 4. Implement terminalization and circuit breaking

- Persist worker exit status beside its worker artifacts.
- Add a focused `builder-digest.mjs` command that atomically finalizes one shard
  using the existing missing-result classifier.
- Reap dead workers inside the shared library loop before calculating available
  lanes.
- Stop the run on runtime-wide incompatibility and invoke existing cloud lease
  release only for cloud mode.

## 5. Improve failure semantics

- Add runtime model incompatibility to the fetch failure taxonomy.
- Surface classified worker evidence in existing log details without changing
  the overall fetch-log information architecture.

## 6. Verify

- Run targeted shell/CLI/taxonomy tests while iterating.
- Run the complete test suite, lint, typecheck, and production build.
- Review the final diff for regular/cloud behavior separation and ensure no
  managed Codex download or expensive-model fallback was introduced.
