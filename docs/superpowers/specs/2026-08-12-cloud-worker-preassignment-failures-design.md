# Cloud Worker Pre-Assignment Failures Design

## Problem

The cloud worker monitor currently defines “Waiting for assignment” as every live-progress task whose `workerId` is blank. That includes terminal tasks which failed during deterministic planning, before a worker could be assigned. The row status says `FAILED`, while the section count says it is still waiting.

The observed `ghKTtfM-R6g` task is one such case: planning estimated 19,248 seconds of transcription work, rejected it against the 14,400-second long-media ceiling, and correctly persisted `workload_exceeds_max_budget` without a worker id. Only the monitor classification is wrong.

## Design

Split unassigned task selection by lifecycle state:

- “Waiting for assignment” contains tasks with no worker assignment and no terminal status.
- “Failed before assignment” contains tasks with no worker assignment and normalized status `failed`.
- Other terminal tasks do not enter either list. They remain visible in source-delivery history and existing outcome views.

Keep the existing list-row and status-chip components. Render the failure section only when it has rows, directly after the waiting section. This preserves the monitor's current hierarchy without adding styles or new interaction patterns.

For each pre-assignment failure, resolve `task.reason` through the shared fetch-failure taxonomy. Copy follows this exact precedence:

1. A known reason shows the taxonomy's operator message.
2. Otherwise, a non-generic task message is shown. Blank messages and values matching `failed` with optional terminal punctuation are generic and skipped.
3. Otherwise, a nonblank raw reason is shown so an unknown diagnostic code is not lost.
4. If neither field is useful, show `Failure reason unavailable.`

This replaces the uninformative `failed.` text while keeping one canonical definition of known failure semantics.

## Data and API Impact

This is a client classification change only. It does not alter job progress, worker assignment, cloud scheduling, retry policy, persisted outcomes, or API response shapes.

## Testing

- Unit-test `waitingTasks` selection so an unassigned planned task remains in the waiting list.
- Unit-test `failedBeforeAssignmentTasks` selection so an unassigned failed task is excluded from waiting and selected as a pre-assignment failure.
- Unit-test that assigned failures are not selected as pre-assignment failures.
- Unit-test known, generic, unknown-code, and unavailable failure copy fallbacks.
- Add a component contract test for the new section, count, section order, and shared taxonomy usage.
- Run the focused cloud worker display/admin monitor suites, then lint and the full test suite.

## Non-Goals

- Do not change the four-hour long-media policy.
- Do not implement resumable media extraction.
- Do not change how `workload_exceeds_max_budget` is produced or retried.
