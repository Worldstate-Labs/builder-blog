# Sync-Ready Item Contract Design

## Problem

Local fetch workers can successfully read and summarize a post but still send an
API-invalid item. The Cloudflare fallback run exposed two contract gaps:

- agent-produced dates were not normalized before sync, so an RFC 1123 date
  passed local validation and failed the API's ISO-8601 schema;
- when sync failed, the fallback outcome discarded the completed read and
  summary evidence, so the Fetch log incorrectly rendered Read as pending and
  Summarize as failed.

This is not specific to Cloudflare or RSS. Any runtime and source type can emit
an item that is semantically complete but structurally invalid at the API
boundary.

## Decision

Introduce one canonical **sync-ready item contract** in the deterministic CLI.
Every worker-produced item must pass through the same normalization and
validation before it can be split into sync slices or posted to FollowBrief.
The server schema remains strict and authoritative.

The contract has four responsibilities:

1. Normalize optional parseable timestamps to ISO-8601 without silently
   converting invalid values to null.
2. Require builder-fallback results to replace synthetic placeholder identity
   with real post identity while retaining `rawJson.fetchTaskId` for task
   accountability.
3. Produce structured validation errors before network sync when an item cannot
   become sync-ready.
4. Preserve completed lifecycle evidence when a valid sync-ready item later
   fails at the network/API boundary, and carry that evidence through the
   fetch-run PATCH schema without dropping fields.

## Data Flow

1. A worker writes a shard result.
2. The merge path binds each item to its planned fetch task.
3. The sync-ready contract normalizes the item and validates its identity,
   timestamp, body, summary, headline, provenance, and task binding.
4. Only normalized items enter sync slices.
5. If the API rejects a validated slice, the runner passes both the attempted
   slice payload and captured sync diagnostic to `fail-sync-slice`. The command
   creates a terminal `task_sync_failed` outcome containing item metadata,
   stage sizes, and the exact sync error.
6. The fetch-run PATCH schema accepts the bounded structured fields and
   fetch-run detail merging retains them on the task record.
7. The Fetch log renders Read and Summarize from preserved stage evidence and
   marks only Sync as failed.

## Fallback Identity

`fetch_builder_fallback` starts with a synthetic item only to create a planned
task. That synthetic item is not a post and must never be synced. A successful
fallback result must provide:

- a non-placeholder `externalId`;
- a non-empty title;
- the canonical post URL rather than a feed or channel placeholder when a
  distinct post URL was discovered;
- a null or valid timestamp, normalized to ISO-8601;
- `rawJson.fetchTaskId` equal to the planned fallback task ID.

Fallback results may contain multiple actual posts. Task accountability remains
bound by `fetchTaskId`; post deduplication remains based on each actual item's
identity.

## Failure Semantics

Failure stage and task terminal status are separate concepts. A task with
`status="failed"` and `failureReason="task_sync_failed"` has completed Read and
Summarize if its validated sync item was present. Its outcome must retain:

- actual title and URL;
- body, summary, and headline character/word counts;
- `completedStage: "summarize"`;
- exact API or network error text;
- the existing failure taxonomy code.

The UI must use this evidence instead of inferring every lifecycle stage from
the final task status.

The evidence must travel as typed, bounded top-level task-outcome fields where
the Fetch log queries them (`title`, `url`, stage sizes, `completedStage`, and
`syncError`) plus an optional `evidence` object for deeper diagnostics. Keeping
display fields only inside `evidence` would make them disappear during
fetch-run PATCH parsing and storage compaction.

Fetch-run compaction may discard verbose evidence, tool metadata, and other
reconstructable fields. It must retain the minimum lifecycle proof for a sync
failure at every compaction level: the actual attempted title and URL, stage
sizes, `completedStage`, failure taxonomy code, and bounded `syncError`. This is
a stage-level retention rule, not a source-specific exception.

## Error Handling

- Parseable non-ISO dates are normalized deterministically.
- Missing dates remain null.
- Invalid dates fail local validation with a field-specific error.
- Placeholder fallback identity fails local validation with field-specific
  errors.
- API failures remain `task_sync_failed`; their concrete message is preserved
  and displayed under Sync only.
- The API schema is not relaxed and does not coerce arbitrary input.

## Testing

Regression coverage must prove:

- an RFC 1123 timestamp becomes ISO before sync;
- an invalid timestamp is rejected locally;
- fallback placeholder identity cannot be synced;
- a real fallback post with a different identity remains bound to its planned
  task;
- sync-failure payloads retain completed stage metrics and exact error text;
- fetch-run detail merging keeps those fields;
- fetch-run compaction keeps the minimum sync-failure lifecycle proof while
  dropping verbose evidence;
- the Fetch log renders Read and Summarize as complete and Sync as failed;
- normal synced, validation-failed, content-failed, and skipped tasks keep their
  existing lifecycle display.

## Non-Goals

- Relaxing the server schema.
- Special-casing Cloudflare, RSS, or RFC 1123 in UI code.
- Retrying deterministic source fetches differently.
- Changing the meaning of validation, content, or worker timeout failures.
