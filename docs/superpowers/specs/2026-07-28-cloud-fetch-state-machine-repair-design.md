# Cloud Fetch State Machine Repair Design

**Date:** 2026-07-28
**Branch / worktree:** `codex/stable-agent-bundle`

## Problem

Production cloud fetching currently mixes three different sources of truth:

- server-side `CloudFetchRun` / `CloudFetchRunTask` terminal state;
- local worker progress and checkpoint artifacts;
- UI-derived display state.

The installed runner asks the CLI to split sync payloads with
`--granularity cloud-source`, while the CLI rejects that value before reaching
its implemented cloud-source branch. Completed summaries therefore remain
local, leases expire and are requeued, and repeated leases accumulate the same
post task IDs under multiple runs.

Two readers then obscure the failure:

- zero-post `FAILED` source tasks are normalized to `SUCCEEDED`;
- live tasks with `status=summarized` and `phase=summarize` are displayed as
  still summarizing.

## Approaches Considered

### 1. Minimal presentation patch

Allow `cloud-source`, preserve zero-post failures, and reverse the UI status
checks.

This is small, but expired run slices would remain in the local aggregate and
could keep an otherwise healthy persistent host in an endless failed-flush
loop.

### 2. Run-aware terminal repair (selected)

Fix the three direct defects and make sync recovery run-aware:

- accept the cloud-source CLI mode through the real command path;
- split checkpoint items and outcomes by `(cloudRunId, cloudSourceTaskId)`;
- when one post task ID belongs to repeated leases for the same source, make
  its completed evidence available to each matching run/source slice;
- classify only server-confirmed, non-retryable terminal conflicts as obsolete
  local slices, record their run-aware task IDs as resolved, and continue
  syncing current slices;
- keep reset fences, incomplete coverage, network errors, and retryable races
  as real failures;
- make raw server terminal state authoritative in delivery serialization;
- make live terminal status/evidence authoritative over a non-terminal phase
  label in work lanes.

This repairs current production data without a schema migration and prevents
one stale run from blocking unrelated current work.

### 3. Replace the local queue with a server-owned post-task ledger

This would remove duplicate identity problems at the architectural level, but
requires a new schema, leasing protocol, migration, and compatibility rollout.
It is too broad for the observed regression and would delay the production fix.

## State Ownership

### Server

The server remains authoritative for:

- whether a run/source lease is active;
- the persisted execution plan;
- terminal source status;
- accepted feed items and per-post terminal outcomes.

A raw terminal `FAILED` source with zero planned posts remains failed unless
the server explicitly persisted a successful zero-post outcome.

### Local worker

The worker owns:

- discovery and extraction progress;
- checkpointed bodies, summaries, and task outcomes;
- retrying transient transport failures.

Local evidence may advance the UI from reading to summarized before server
sync, but cannot rewrite a server failure as success.

### UI

The display precedence is:

1. terminal server status;
2. terminal live status or complete live summary/headline evidence;
3. active live status;
4. live phase;
5. persisted planned/default state.

Thus `status=summarized, phase=summarize` is “Ready to sync,” not
“Summarizing.”

## Sync and Recovery Flow

1. The runner leases sources and persists each run ID and source-task ID.
2. Execution plans are patched before worker execution.
3. Checkpoint results are grouped by run and source.
4. Repeated task IDs are copied only to matching run/source slices, never
   across unrelated source-task IDs.
5. Each slice is validated and submitted independently.
6. Successful/replayed slices append run-aware resolved task IDs.
7. A server response of `cloud_run_not_running` or
   `cloud_source_already_finalized` with `retryable=false` marks only that old
   slice obsolete locally.
8. Reset fences, incomplete coverage, and retryable conflicts stop the slice
   from being marked resolved.
9. Current slices continue even if an old slice is obsolete.

## Error Reporting

The CLI will emit a bounded machine-readable diagnostic for HTTP sync errors:
response code, HTTP status, and retryability. No token, query string, or
response body is included. The shell runner uses exact response codes rather
than matching human error prose.

## Testing

Regression coverage must exercise:

- the actual `split-sync-slices --granularity cloud-source` CLI command;
- repeated task IDs across two runs of the same source;
- stale terminal slice classification versus retryable/incomplete/reset
  failures;
- raw `FAILED + plannedPosts=0 + cloud_lease_expired`;
- a genuine successful zero-post source;
- `status=summarized + phase=summarize` in the banner, lifecycle row, and pill;
- representative cloud runner contract tests, lint, typecheck, build, and a
  web-sync-disabled end-to-end CLI smoke.

No production data mutation is part of automated verification.
