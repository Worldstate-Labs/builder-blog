# Worker No-Progress Retry Design

## Scope

Add one bounded retry when a library shard worker reaches the existing
`worker_no_progress_timeout` before writing any result, task checkpoint, or
progress checkpoint.

Do not change Codex invocation flags, worker stall handling after prior
progress, general shard timeouts, task failure classification, setup verdict
classification, or UI copy.

## Behavior

- The first initial no-progress watchdog event terminates the worker process.
- A retry starts only after the original process tree is confirmed stopped.
- The retry reuses the same shard, stable worker lane, result path, and
  checkpoint directory.
- Each shard can consume this retry at most once per runner process.
- Attempt-one logs are archived before the retry starts so diagnostics survive.
- If the retry also reaches the initial no-progress watchdog, the existing
  terminal `worker_no_progress_timeout` path runs unchanged.
- Workers that previously wrote progress, exited, started a background tool,
  or exceeded the general shard timeout are not retried by this change.

## Safety Invariants

The retry gate is narrower than the terminal failure reason: it is entered only
when `worker_progress_mtime_seconds` returns zero. The supervisor must never
run two attempts for the same shard concurrently, so a failed process-tree
termination prevents retry. Completed checkpoint and result files remain the
source of truth.

## Verification

Add a shell-level regression test for the single-use per-shard retry gate and
source-contract assertions for termination-before-restart, log archival, lane
reuse, and the unchanged terminal fallback. Run shell syntax validation, the
focused library runner tests, lint, typecheck, and the full test suite.
