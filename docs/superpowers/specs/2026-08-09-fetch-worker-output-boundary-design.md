# Fetch Worker Output Boundary Design

## Problem

Fetch workers currently return complete builder and post records. The runner and
sync APIs trust too many worker-authored identity fields, so a model can attach
valid content to the wrong builder, task, post, or shard. This caused production
cloud fetches to fail when a worker copied `cloudSourceTaskId` into `builderId`,
and the same boundary permits quieter data corruption when other stable fields
are wrong.

## Contract

For normal post tasks, the plan owns identity and the worker owns content.

Runner-owned fields:

- builder identity and metadata, including `builderId` and `cloudSourceTaskId`
- post `kind`, `externalId`, `title`, `url`, `publishedAt`, and `sourceName`
- `rawJson.fetchTaskId`
- the actual worker identity recorded by the runner

Worker-owned fields:

- fetched primary `body` for tasks that require extraction
- `summary` and `headline`
- acquisition/provenance evidence
- a terminal reason and evidence for an assigned task

`fetch_builder_fallback` remains the only exception where a worker may discover
new post identities. Its output still must bind to the assigned fallback task
and canonical builder.

## Runner Rules

1. Match each shard result only against that shard's assigned tasks.
2. Rebuild normal post identity from the matching planned task.
3. Drop empty worker builders and all unbound items.
4. Accept outcomes only for tasks assigned to the producing shard.
5. Treat duplicate, missing, unbound, or cross-shard results as task failures.
6. Require exactly one terminal accounting result per planned post task.

## Server Defense

Both regular and cloud sync endpoints independently verify the runner output
against server-stored plans. A normal uploaded item must have an exact
`fetchTaskId -> builderId` mapping. Cloud sync additionally verifies
`cloudSourceTaskId` and scopes identity by cloud run/source/task. Unknown,
duplicate, or mismatched items are rejected before persistence.

## Error Reporting

Validation failures retain per-task evidence and expose a concrete reason in
the fetch log. Worker-authored metadata cannot replace runner-owned runtime
identity.

## Verification

Regression tests cover stable-field rewrites, off-plan extras, duplicate task
results, cross-shard outcomes, fallback discovery, regular sync, and cloud sync.
The existing fetch contract suites, lint, and production build must remain
green.
