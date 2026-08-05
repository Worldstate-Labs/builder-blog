# Cloud Host Immediate Lease Handoff Design

**Date:** 2026-08-05

## Goal

Make an explicitly confirmed Cloud worker-host replacement immediately recover
unfinished Cloud source work after the old local process tree is proven absent.
The new host must not wait for the old lease TTL, and the handoff must not
release work owned by another admin, another worker instance, or a still-live
process.

## Current Problem

Cloud source leases outlive the local worker process by design. A lease lasts for
the greater of the configured TTL and the source execution budget plus ten
minutes, so a long-media source can remain leased for up to four hours and ten
minutes.

That safety behavior is correct for an unexpected worker disappearance, but the
admin override flow is a controlled stop:

1. setup records the old host as `replaced`;
2. the shared service is unloaded;
3. `stop-current` terminates and verifies the exact recorded process tree;
4. the runner records a terminal `AgentJobRun` state and clears its marker;
5. a new host is installed.

The stop path never finalizes or releases the old worker's unfinished
`CloudFetchRunTask` / `CloudFetchQueueItem` rows. A new host can process unrelated
sources, but the affected canonical sources remain blocked until lease expiry.

## Invariants

1. A live or unprovably stopped worker never has its leases released.
2. Release happens only after the exact recorded runner and cached descendant
   set are proven absent.
3. A release request is scoped to the authenticated admin and the exact
   `AgentJobRun` that created the Cloud runs.
4. Already-finalized run tasks and queue items never regress.
5. Release is idempotent and safe to retry after a transport or process crash.
6. A release/sync race is serialized by the same run-task row locks used by
   Cloud sync. Whichever terminal transition wins remains authoritative.
7. Handoff is not counted as a source failure: source backoff, circuit-breaker,
   and consecutive-failure fields do not change.
8. The old run remains an honest audit record; released unfinished tasks are
   terminal with reason `cloud_worker_replaced`, while their queue items become
   immediately eligible again.
9. Failure to confirm release preserves the local recovery marker and prevents
   installation of the replacement host.
10. Ordinary crashes and network partitions retain TTL-based recovery; only the
    explicit, verified stop/override path uses immediate release.

## Approaches Considered

### 1. Bind Cloud runs to `AgentJobRun` and release by worker identity (selected)

Persist the authenticated admin and creating agent job on every new
`CloudFetchRun`. After exact local shutdown, call a server endpoint that releases
only unfinished runs created by that worker.

This adds a narrow schema migration, but gives the server a durable and
auditable ownership boundary and supports safe retries after local artifacts are
cleaned.

### 2. Release run IDs saved in the local run directory

The host already writes Cloud run IDs locally. The controller could collect
those IDs and submit them after shutdown.

This avoids a schema change, but signal cleanup removes ordinary run artifacts,
crash recovery may lose the list, and the server cannot prove that submitted
legacy run IDs belong to the stopped worker. It is rejected as a fragile trust
boundary.

### 3. Shorten leases or continue waiting for expiry

Short leases increase duplicate execution risk for valid long-running media
work, while natural expiry does not meet the immediate-handoff requirement. This
is rejected.

## Data Model and Ownership

Add an optional `agentJobRunId` to `CloudFetchRun` and relate it to
`AgentJobRun`. Multiple Cloud runs may belong to one persistent host job because
the host refills work repeatedly. Keep and populate the existing
`createdByUserId` field.

Add an index suitable for the release lookup:

```text
(createdByUserId, agentJobRunId, status)
```

The lease route already authenticates an admin and verifies that the submitted
worker instance maps to that admin's `cloud-library-fetch` `AgentJobRun`. It must
pass the selected database job-run ID and authenticated user ID into the
scheduler. The scheduler, not the request body, writes ownership onto the new
Cloud run.

Rows created before this migration have null ownership and cannot be safely
attributed. They retain natural TTL recovery. No heuristic backfill or
cross-admin legacy release is allowed.

## Server Release Operation

Add a transaction-level helper that accepts authenticated `userId` and the
public worker instance ID, resolves the database `AgentJobRun` inside its
transaction, and never accepts a caller-supplied database job ID.

Within one transaction:

1. resolve the authenticated admin's `cloud-library-fetch` `AgentJobRun` from
   the submitted public instance ID; a missing or wrong-job row is a fatal
   `cloud_release_job_not_found` response, not a successful no-op;
2. call `lockResetFenceForWorker` with that job's database `createdAt` and the
   global reset fence before reading or mutating generated Cloud state;
3. select `RUNNING` Cloud runs with matching `createdByUserId` and
   `agentJobRunId`, ordered by run ID;
4. load their still-`RUNNING` source-task IDs;
5. for each ordered run, acquire the existing deterministic Cloud run-task row
   locks with source-task IDs in sorted order;
6. re-read still-running tasks after the locks;
7. update those run tasks to `FAILED`, set `finishedAt`, and set
   `failureReason=cloud_worker_replaced`;
8. update only matching `LEASED` queue items to `QUEUED`, clearing `leasedAt`,
   `leaseExpiresAt`, `leaseOwner`, and `runId`;
9. recompute every affected Cloud run from its final task states.

The helper does not update `CloudSourceTask` scheduling or failure counters.
Tasks released by handoff therefore remain immediately eligible under the
existing failed-only canonical retry rule.

The global reset-fence lock serializes release against lease, sync, and RESET.
If RESET wins, release returns the existing exact non-retryable
`agent_job_reset_fenced` result and performs no writes. If release holds the
worker lock first, RESET waits, release commits, and RESET then deletes the
generated Cloud state normally.

The guarded states make retries no-ops after the first successful release. A
concurrent sync that locks first may finalize the task normally; release then
skips it. If release locks first, a late sync observes a terminal task and is
rejected by the existing stale-write guard. Ordering runs and task IDs makes
duplicate release requests acquire locks consistently and avoids avoidable
deadlocks.

## API and CLI Contract

Add an admin-only release endpoint accepting the old worker's public
`instanceId` (`jobRunId` in the CLI contract).

The endpoint:

1. authenticates with the existing Cloud admin guard;
2. passes the authenticated user ID and submitted instance ID into the
   transactional release helper;
3. lets the helper resolve and reset-fence the exact `AgentJobRun` before
   mutation;
4. returns counts for released runs, source tasks, and queue items.

A normal response has one of two machine-readable outcomes:

- `released`: one or more unfinished source tasks were terminalized and
  requeued;
- `already_released`: the exact owned job exists but has no remaining matching
  running work.

A missing/wrong job returns `cloud_release_job_not_found` and is fatal. An exact
non-retryable `agent_job_reset_fenced` response is distinct: the global RESET
fence won serialization and the RESET transaction is authoritative for deleting
Cloud runs, run tasks, and queue items. Authentication, validation, generic
conflicts, and database failures remain fatal.

Expose this endpoint through one deterministic `builder-digest.mjs` command.
The command emits bounded JSON and retains the CLI's structured HTTP error
format. It never accepts arbitrary Cloud run IDs.

## Local Handoff Flow

`mark-replaced` remains unchanged and never releases work while the host is
live.

`stop-current` follows this order for an exact live worker:

1. cache the descendant PID set;
2. TERM/KILL as currently required;
3. verify the exact runner and every cached descendant are absent;
4. record the terminal agent job outcome;
5. if that update was recorded normally, call the new release command with the
   recorded instance ID and accept only `released`, `already_released`, or the
   exact non-retryable `agent_job_reset_fenced` race outcome;
6. if the terminal update itself returned the existing exact reset-fenced
   outcome, skip the release call because RESET already deleted all generated
   Cloud run and queue state;
7. clear the matching current marker only after one of those explicit safe
   outcomes.

The dead/reused-PID reconciliation branch performs the same server release after
it proves no exact old worker is running and records/reconciles the terminal job
state.

If release fails, the old process remains stopped but the marker is preserved.
The setup/stop prompt exits non-zero, leaves replacement pins untouched, and can
retry `stop-current` safely. A retry repeats the idempotent terminal update and
release request, then clears the marker.

If RESET deletes the job after a normal terminal update but before the release
helper resolves it, the endpoint returns `cloud_release_job_not_found`; the
runner preserves the marker and returns non-zero. On retry, the strict terminal
update returns the exact reset-fenced outcome, which safely skips release and
clears the marker. This deliberately favors a retriable extra stop command over
conflating an invalid instance ID with RESET.

Neither the terminal-update nor release reset-fenced path suppresses generic
409, network, authentication, or malformed-response failures.

## Error Handling and Observability

- Report release counts in the runner control output without source content or
  credentials.
- Use a stable release reason (`cloud_worker_replaced`) in server history.
- Preserve the current marker on every ambiguous release failure.
- Do not install the new machine-global service while release is unresolved.
- Do not add a general-purpose admin endpoint for arbitrary run cancellation.

## Testing

### Scheduler/lifecycle tests

- matching worker ownership releases only `RUNNING` tasks and `LEASED` queue
  items;
- an exact owned job with no remaining matching running work returns
  `already_released` without mutation;
- already-finalized tasks remain unchanged;
- source failure/backoff fields are untouched;
- a repeated release is a successful no-op;
- release recomputes affected run aggregates;
- release and sync row-lock ordering preserves the first terminal transition.

### API tests

- admin authentication is required;
- the public instance ID must resolve to the authenticated admin's Cloud job;
- cross-admin and wrong-job requests return `cloud_release_job_not_found`;
- a missing or wrong instance ID returns `cloud_release_job_not_found` and is
  never treated as release success;
- a release transaction that loses the global reset-fence race returns the
  exact `agent_job_reset_fenced` result without Cloud writes;
- a reset that deletes the job before release lookup yields
  `cloud_release_job_not_found`; the runner preserves its marker until the next
  strict terminal-update retry establishes reset fencing;
- lease creation persists `createdByUserId` and `agentJobRunId`.

### CLI and runner tests

- the new CLI command sends only `jobRunId` and authenticates normally;
- `mark-replaced` never calls release;
- exact stop invokes release only after process-tree absence and terminal update;
- dead/reused-PID reconciliation invokes release without signaling another
  process;
- release failure preserves `current.json` and returns non-zero;
- retry success clears only the matching marker;
- terminal-update reset fencing skips release only after local absence is
  proven;
- release-time reset fencing is accepted only through the exact structured
  response;
- a missing-job release response preserves the marker until the next strict
  terminal-update retry establishes reset fencing;
- Cloud setup installs the new host only after successful `stop-current`.

### Verification

Run focused lifecycle, scheduler, API, CLI, and shell-contract tests first, then
shell syntax validation, lint for changed TypeScript/tests, TypeScript checking,
the complete test suite, production build, and `git diff --check`.

## Non-goals

- No change to regular-user Fetch sources or AI Brief schedules.
- No shortening of ordinary Cloud lease TTLs.
- No requeue on an unverified crash, heartbeat gap, or network partition.
- No unsafe release of pre-migration unowned Cloud runs.
- No Cloud monitor UI redesign.
- No general Cloud run cancellation feature.
- No new dependency.
