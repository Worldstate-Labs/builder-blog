# Cloud Worker Terminal Accounting Design

## Problem

The admin cloud-fetch monitor can show mutually contradictory facts for the same
post task:

- a worker lane remains `RUNNING` with `0/N synced`,
- the expanded post row is already `SYNCED`,
- the lifecycle can say the local agent is still waiting for server sync even
  though the server has accepted and persisted the post,
- an all-skipped lane can be labelled `SYNCED`.

Production data confirms this is not just stale rendering. The cloud sync API
persists authoritative per-post outcomes in `CloudFetchRunTask.details`, but
`sync-cloud-builders` does not apply the API response to the cloud worker's
fetch-progress state. The lane aggregator then gives the stale live task status
precedence over the persisted terminal outcome, while the child `TaskRow` gives
the persisted outcome precedence. Parent counts and child rows therefore use
different sources of truth.

## Goals

1. Make the cloud sync API response the canonical source for terminal post-task
   outcomes in worker progress.
2. Make worker-lane counts, lane status, child status, and child lifecycle agree.
3. Correct `synced`, `skipped`, `failed`, `action needed`, and `pending` counts.
4. Keep partial checkpoint sync idempotent and prevent late worker heartbeats
   from regressing a terminal task.
5. Preserve regular-user fetch behavior; the behavior change is scoped to
   cloud sync and the admin cloud-fetch monitor.

## Non-goals

- Changing cloud task scheduling, leasing, execution budgets, or retry policy.
- Reconstructing old worker-host aggregate counters from unrelated historical
  delivery batches.
- Changing the regular personal fetch log's status precedence.
- Adding a database migration or a new status vocabulary to persisted tables.

## Status Authority

There are two representations of a post task:

- **Persisted delivery outcome**: returned by `/api/admin/cloud-fetch/sync` and
  serialized from `CloudFetchRunTask.details`. This is authoritative once it is
  terminal.
- **Live worker progress**: heartbeat-oriented state used before server
  acceptance. It is authoritative only while the persisted outcome is not
  terminal.

Terminal persisted statuses are:

- `synced`
- `skipped`
- `failed`
- `action_needed`
- `blocked` (normalized to `action_needed` for display/accounting)

For a task with a persisted terminal outcome, a live `planned`, `queued`,
`running`, `fetched`, `summarized`, or missing status must not override it.
When the live task still contains that stale nonterminal state, it is not passed
to `TaskRow`; this prevents banners such as “waiting for server sync” from
appearing beside an already-synced row.

## Cloud Sync Progress Reconciliation

After `sync-cloud-builders` receives a successful API response:

1. Read the current fetch-progress state.
2. Flatten `result.taskResults[*].details.posts` into terminal task outcomes.
3. Normalize the server statuses to the existing progress vocabulary:
   - `synced` -> `synced`
   - `skipped` -> `skipped`
   - `blocked` or `action_needed` -> `action_needed`
   - `failed` and other explicit terminal failures -> `failed`
4. Preserve task identity, worker assignment, failure reason, and content-size
   facts included by the server.
5. Apply the outcomes through the existing
   `applyFetchProgressTaskOutcomes` helper. Its completed-task set makes repeat
   checkpoint responses idempotent.
6. Emit progress immediately:
   - partial checkpoint sync returns to `workers_running`,
   - final sync emits `reconciled`.

The server response is used instead of the upload payload because server-side
reconciliation can turn an attempted item into a skip or failure and is the
only authoritative statement of what was persisted.

If web sync is disabled, no terminal reconciliation is emitted because nothing
was accepted by the server.

## Worker Lane Accounting

The admin monitor uses one pure status-resolution function for every lane task.
Lane counts are derived from the resolved status:

- `synced`
- `skipped`
- `failed`
- `actionNeeded`
- `pending` (every nonterminal task)

The sum of these buckets must equal the number of tasks in the lane.

Lane presentation precedence:

1. any pending task -> `RUNNING`
2. no pending, any action-needed task -> `ACTION NEEDED`
3. no pending/action-needed, failures mixed with successes or skips -> `PARTIAL`
4. all terminal failures -> `FAILED`
5. at least one synced task and no failures/action-needed -> `SYNCED`
6. all tasks skipped -> `SKIPPED`

The textual count summary includes action-needed tasks. A stale live timestamp
is not displayed for a task whose persisted terminal status overrides the live
state.

## Worker Host Aggregate Counters

New and upgraded cloud workers update the canonical fetch-progress counters
after every successful server sync, so the host-level `Completed / planned`,
`Synced`, `Failed`, `Skipped`, and `Action needed` values advance together.

The UI does not guess host counters by summing arbitrary paginated delivery
history. Delivery rows are not durably linked to a specific host job instance,
so such a fallback could count a previous host session. Persisting the
authoritative response into job progress is the stable fix.

## Compatibility

- `applyFetchProgressTaskOutcomes` remains shared and unchanged in semantics.
  The cloud command now calls it with server-authoritative outcomes.
- The personal `sync-builders` flow keeps its current code path.
- Existing installed cloud workers that have not received the new runtime can
  still produce stale heartbeat state; the admin lane UI defensively resolves
  persisted terminal outcomes first, so their lane rows remain truthful.
- Host-level aggregate counters become canonical when the upgraded runner emits
  its next successful sync.

## Verification

Regression tests must cover:

1. persisted `synced` + live `summarized` resolves to `synced`, not pending;
2. persisted `failed` or `skipped` overrides stale live nonterminal state;
3. persisted nonterminal + live running remains pending;
4. lane examples matching the observed failures:
   - four persisted synced + one failed reports `4/5`, not `2/5`;
   - two persisted synced + stale summarized heartbeats reports `2/2`;
   - an all-skipped lane reports `SKIPPED`, not `SYNCED`;
   - action-needed is terminal and separately counted;
5. cloud API response posts are converted to progress outcomes with worker and
   size metadata;
6. repeated partial sync responses do not double-increment counters;
7. partial and final sync emit the correct progress stage;
8. the full unit suite, lint, typecheck/build, and runtime trace verification
   remain green.

