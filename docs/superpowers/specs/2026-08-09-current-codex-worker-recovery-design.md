# Current Codex Runtime And Worker Recovery Design

## Problem

Fetch jobs currently assume that the configured Codex model is usable by the
installed Codex executable. A model/CLI incompatibility is therefore discovered
inside every worker after source tasks have already been planned and, for cloud
fetch, leased. Those workers can exit without result files. Their dead entries
continue reserving lane IDs while managed media work is alive, so queued tasks
remain unassigned even though the configured concurrency is higher.

The same runner powers regular fetch and FollowBrief cloud fetch. AI Brief uses
the same Codex invocation policy but has a separate job function.

## Requirements

- Use only the Codex executable currently on `PATH`; do not install, download,
  bundle, or switch to a managed Codex executable.
- Prefer `gpt-5.6-luna` and fall back only to the allowlisted economical model
  `gpt-5.4-mini` when Luna is explicitly unavailable or incompatible.
- Do not fall back for authentication, network, quota, or unknown failures.
- Resolve the model before regular fetch starts work and before cloud fetch
  acquires source leases. Apply the same policy before AI Brief invokes Codex.
- Preserve an explicitly configured non-default model. It must either pass the
  probe or fail; it must not be silently replaced.
- Persist the selected model in job telemetry.
- When a worker exits without a complete result, turn its assigned shard into a
  terminal, evidence-bearing result immediately and release that lane.
- When the exit is a runtime-wide model incompatibility, stop assigning work.
  Regular fetch ends the run; cloud fetch releases this run's leases so another
  compatible host can retry rather than recording content failures.
- User-visible failures must expose the classified runtime reason instead of the
  generic `worker_missing_result` message when evidence is available.

## Model Preflight

At the start of a Codex-backed job, the runner performs a minimal, tool-free
`codex exec --json` invocation using the same installed executable, working
directory, model, and reasoning effort as the real job. A successful probe must
exit successfully and emit a completed turn.

The resolver tries models in this order:

1. Explicit `BUILDER_BLOG_CODEX_MODEL`, when set. No fallback is allowed.
2. `gpt-5.6-luna`.
3. `gpt-5.4-mini`, only when Luna's output identifies model unavailability or a
   Codex version incompatibility.

The selected model is exported through both `BUILDER_BLOG_CODEX_MODEL` and
`BUILDER_BLOG_AGENT_MODEL`. A failed resolution ends the job before fetching,
planning, or cloud leasing.

## Worker Lifecycle

Every spawned worker records its process exit status. During each parent-loop
reap, a dead worker with an incomplete result is finalized before scheduling
more work:

1. Read its shard, checkpoints, worker log, agent output, and exit status.
2. Classify the failure from concrete evidence.
3. Atomically write a terminal shard result for uncovered assigned tasks.
4. Mark the worker entry complete so its lane becomes available.
5. Recompute free lanes and assign queued tasks in the same loop iteration.

This keeps task terminalization and lane reuse ordered: a lane is never reused
while its previous shard is still unaccounted for.

## Runtime Circuit Breaker

Model/CLI incompatibility is a host capability failure, not a source-content
failure. Detecting it in any worker opens a run-scoped circuit breaker:

- stop assigning new shards;
- terminate sibling model workers cleanly;
- record the exact runtime failure on the job;
- for cloud fetch, release leases held by the current host/run;
- for regular fetch, fail the run without converting untouched planned posts
  into content failures.

The startup preflight should prevent this path normally; the circuit breaker
handles executable replacement, model withdrawal, or configuration drift during
a long-lived host process.

## Scope

The model policy covers regular fetch, cloud fetch, and AI Brief. Worker lane
recovery covers regular and cloud fetch because they share `run_library_job`.
Lease release is cloud-only. Existing source extraction, summarization, sync,
frequency, and source-selection rules remain unchanged.
