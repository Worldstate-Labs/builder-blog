# Interrupted Fetch Lifecycle Repair Design

## Goal

Make an interrupted personal library fetch report its runtime and post-task state truthfully without changing the existing source scheduling, per-source limits, dynamic worker queue, or successful timeout behavior.

## Confirmed failures

1. A `LibraryFetchRun` can reference an `AgentJobRun` that began a few seconds before the visible fetch-run page floor. The history query filters that linked job out, so the UI cannot show `Stopped` for a killed run.
2. The tracked-job `TERM`/`INT` handler kills workers and marks the job killed but does not run the checkpoint-first finalization used by the runtime-timeout path. Planned tasks can therefore remain `pending` or `fetched` indefinitely.
3. If cleanup cannot run, task rows use their old fetch-task state alone and can display `Queued` even though the parent job is terminal.
4. Generic availability probing invokes `ffmpeg --version`; the installed ffmpeg expects `-version`, so an available binary can be reported as missing.
5. The runner prints full fetch plans and every dynamic-assignment JSON document to stdout, creating multi-megabyte parent-agent output even though the canonical artifacts already exist on disk.

## Invariants

- Keep the personal fetch limit and candidate selection unchanged.
- Keep one post task per dynamic worker assignment and existing domain serialization unchanged.
- Keep transient `partial` plus unfinished tasks valid while a linked runtime is active.
- Never downgrade a synced task because of a late planned-task or failure patch.
- Preserve the timeout path's current job status, reason codes, checkpoint-first ordering, and recovery-directory fallback.
- Preserve unlinked Agent Job rows inside a history page so pre-fetch failures remain visible.
- Keep history account, job-type, schedule, trigger, and cursor isolation.
- Do not add a database migration or a background reconciliation service.
- Keep full fetch and assignment JSON artifacts on disk for recovery and diagnosis.

## Design

### Linked runtime history

Build the normal time-window predicates in `src/lib/agent-job-runs.ts`, with an explicit exception for `instanceId` values referenced by the visible fetch runs. The route will keep all ownership and job-kind predicates outside this window helper. The exception augments the existing floor query; it does not replace the query that retains unlinked failures within the page.

Apply the same principle to scheduled-job history so a linked scheduled job is not lost merely because its `expectedAt` precedes the fetch row. Continue to apply the `before` cursor to every result.

### Interrupted result reconciliation

Extract the file discovery, completed-checkpoint sync, and remaining-task backfill mechanics from the timeout-specific wrapper into one shell helper. Timeout continues to pass `runtime-timeout` / `runtime_timeout`. The signal handler passes `runtime-interrupted` / `runtime_interrupted`.

On the first signal the handler disables repeat `TERM` and `INT` traps, terminates and waits for children, aggregates usage, clears the current-run marker early, and records the job as killed. Only `library-once` and `library-cron` then perform best-effort library finalization and record `runner_interrupted_flush_finished` or `runner_interrupted_flush_failed`; digest jobs retain their existing interruption path and reason. The handler then cleans up. A second signal cannot re-enter or abort the first cleanup. A direct `SIGKILL` remains uncatchable, so the web UI also needs a truthful presentation fallback.

Completed checkpoints are synchronized before unfinished work is backfilled. Existing terminal outcomes remain authoritative. Assigned tasks can retain a more specific worker failure classification; otherwise unfinished tasks use the retryable, not-completed `runtime_interrupted` taxonomy entry.

### Stopped-task presentation

Pass whether the parent run can still make progress into task-detail rendering. Terminal task states retain their current labels. A non-terminal task whose parent can no longer progress uses the neutral/idle tone and displays `Not completed` in both its task pill and banner, not `Queued`, `Reading`, or `Failed`. This changes presentation only: it does not invent a server-side failure or increment `errorCount`.

Do not change `deriveFetchRunStatusFromDetails`. While work is active, `partial` with pending work remains valid. Once the linked job is returned, the existing run header correctly prefers `Stopped` for killed or stale jobs.

### ffmpeg capability probe

Allow `commandExists` to accept version arguments while retaining `--version` as the default. Only the ffmpeg call uses `-version`. Do not broaden availability to every non-zero exit or arbitrary stderr because that would change detection semantics for all tools.

### Bounded runner logging

Replace full fetch-plan and expanded-plan `cat` calls with a single-line summary containing phase, status, task count, outcome count, local-error count, and artifact path, capped below 2,048 UTF-8 bytes even for a large fixture. Replace assignment JSON output with one line containing round, assigned-worker count, and remaining-pending count. The files themselves stay unchanged and continue to drive scheduling, recovery, and synchronization.

## Error handling

- If no fetch plan exists at interruption time, do not fabricate task outcomes; retain the killed Agent Job record.
- If interrupted finalization cannot sync, retain recovery artifacts and report a killed job with a flush-failed reason. The UI fallback still prevents a false queued presentation.
- The reset fence remains authoritative; stale workers may not patch data after a reset.
- No server-side eager backfill occurs when a job becomes terminal because it could race unsynced local checkpoints and permanently inflate monotonic `errorCount`.

## Verification

- Unit-test history floor predicates for linked, unlinked, scheduled, cursor, and isolation cases.
- Shell-harness test checkpoint-first interrupted finalization, idempotence, repeated signals, early current-file clearing, and unchanged timeout semantics.
- UI-test stopped tasks as not completed without increasing failure counts.
- Test ffmpeg `-version`, real missing binaries, and remaining-budget behavior.
- Test stdout bounds with a large fixture while comparing the full artifact before and after logging.
- Finish with shell syntax, Node syntax, targeted tests, full tests, lint, typecheck, and production build.
