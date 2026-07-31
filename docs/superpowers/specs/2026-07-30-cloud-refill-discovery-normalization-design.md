# Cloud Refill Discovery Normalization

## Problem

`fetch-cloud-library` can return `candidate_discovery_fallback` tasks when a
deterministic source fetch is blocked, such as Product Hunt returning HTTP 403.
The initial library batch runs a discovery pre-pass before counting post tasks,
but `fetch_more_cloud_sources` counts refill tasks immediately. Because
`library_fetch_task_count` intentionally excludes discovery tasks, a
discovery-only refill is mistaken for an empty batch and synced as a successful
source with no planned posts.

The defect is limited to batch orchestration. Deterministic fetching and
`expand-discovery` already model successful, blocked, missing, and empty
discovery results.

## Goals

- Give initial and refill batches the same discovery semantics.
- Ensure no batch is counted, merged, assigned, or terminally synced while it
  still contains `candidate_discovery_fallback` tasks.
- Preserve cloud-host availability: a discovery failure terminates the affected
  source task, not the persistent host.
- Reuse existing discovery expansion and terminal-outcome behavior.
- Keep refill-specific lease, heartbeat, merge, and worker-assignment behavior.

## Non-goals

- Moving discovery into the normal post-worker queue.
- Changing Product Hunt fetching or bypassing Product Hunt protection.
- Redesigning cloud leasing, scheduling, or source-status vocabulary.
- Adding a new runtime or dependency.

## Design

### Shared normalization boundary

Extract the discovery portion of `run_library_job` into a shell helper that
normalizes one fetch-result batch in place. The helper receives:

- the fetch-result JSON path;
- a batch scope used to namespace temporary artifacts, such as `initial` or
  `refill-3`.

The helper:

1. Returns immediately if the batch has no discovery fallback tasks.
2. Runs the existing unattended discovery agent against explicit input and
   output paths.
3. Always runs the existing `expand-discovery` command, including when the
   agent fails. If the agent did not create a valid result, the helper supplies
   an empty discovery payload so `expand-discovery` converts every unresolved
   fallback into a failed terminal outcome.
4. Writes expansion output to a temporary file and atomically replaces the
   batch file.
5. Verifies the postcondition that no discovery fallback tasks remain.

The initial batch and every refill batch call this helper before
`library_fetch_task_count`.

### Explicit discovery paths

The discovery prompt currently assumes `library-fetch-result.json` and
`library-discovery-result.json`. Replace those assumptions with:

- `BUILDER_BLOG_DISCOVERY_TASKS_FILE`
- `BUILDER_BLOG_DISCOVERY_RESULT_FILE`

The runner exports both variables for every discovery invocation. The prompt
uses the variables as authoritative paths. OpenClaw's generated wrapper also
exports them, preserving runtimes whose tool calls do not inherit the parent
environment.

Namespaced artifacts prevent initial and refill runs from overwriting one
another and make production debugging attributable to a specific lease batch.

### Refill behavior

`fetch_more_cloud_sources` performs these operations in order:

1. Lease and deterministically plan a cloud batch.
2. Record and heartbeat its cloud run ID.
3. Normalize discovery tasks in that batch.
4. Count ordinary post tasks.
5. If there are no post tasks, sync terminal outcomes for the batch and leave
   the worker queue drained.
6. Otherwise merge the normalized batch into the accumulated result and make
   the queue assignable.

A terminal-only refill does not fail the persistent host. Existing refill
limits and idle polling continue to bound subsequent lease attempts.

### Error semantics

- Discovery result `ok` with candidates: replace fallback with ordinary post
  tasks.
- Discovery result `blocked`: remove fallback and add a blocked outcome.
- Missing, invalid, or agent-failed result: remove fallback and add a failed
  outcome.
- Discovery result with no usable candidates: remove fallback and add the
  existing no-usable-candidates outcome.
- Expansion or postcondition failure: treat the batch as an internal runner
  failure; never count or sync it as an empty successful batch.

## Testing

Add contract coverage proving:

- a discovery-only refill expands into assignable post tasks;
- a blocked discovery-only refill syncs a terminal outcome instead of a
  successful `0/0` source;
- an agent failure produces a failed discovery outcome;
- a mixed refill preserves ordinary tasks while settling discovery tasks;
- initial and refill batches both normalize before counting;
- consecutive refills use isolated discovery artifact paths;
- the helper rejects any normalized batch that still contains fallback tasks.

Run the targeted cloud runner contract tests, Product Hunt/discovery CLI tests,
shell syntax validation, type checking, and the broader relevant test suite.

