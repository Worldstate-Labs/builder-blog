# Reset-Fenced Cloud Stop Design

## Goal

Make the account-scoped Cloud worker stop flow idempotent after a global RESET
without weakening the reset fence or ignoring unrelated HTTP conflicts.

The stop flow must finish local cleanup when the target worker has already
exited, its server-side `AgentJobRun` was intentionally discarded by RESET, and
the server returns an exact non-retryable reset-fenced result. Every ambiguous
failure must continue to preserve the local marker and runtime pins.

## Current Problem

The Cloud stop prompt first unloads the account-owned machine service, then asks
`builder-agent-runner.sh` to stop or reconcile the worker recorded in the
account's `current.json`.

For a recorded PID that no longer identifies the exact FollowBrief runner,
`cloud_host_control_current_file` submits a strict terminal `stale` update before
clearing the marker. This is normally correct: local cleanup should not erase
the only recovery evidence when the server could not record the terminal state.

A global RESET creates a legitimate exception:

1. RESET advances the global reset fence and removes old `AgentJobRun` rows.
2. The machine can retain an account-scoped `current.json` from before RESET.
3. `stop-current` proves the recorded PID is absent or belongs to another
   process, then submits `status=stale`.
4. `/api/skill/job-runs` cannot find the old row and rejects every non-`starting`
   write with `StaleWorkerWriteError`.
5. Strict runner cleanup treats the rejection as ambiguous, preserves the
   marker, and prevents the prompt from removing runtime pins.

Repeating the stop prompt cannot heal this state. The service is already absent,
but the local lifecycle remains permanently incomplete.

## Recommended Design

### Preserve the reset fence

Do not create a missing terminal `AgentJobRun`, accept arbitrary old writes, or
turn generic HTTP 409 responses into success. The server remains authoritative
that a reset-fenced run no longer exists.

Extend `StaleWorkerWriteError` with a stable public response code:

```text
agent_job_reset_fenced
```

The job-run API returns:

```json
{
  "error": "This worker started before the latest global reset. Start a new run.",
  "code": "agent_job_reset_fenced",
  "retryable": false
}
```

The same response applies when an existing run predates the fence and when a
non-starting update targets a run RESET has already removed. The distinction is
not needed by the client: both mean the old run is intentionally outside the
current server state.

### Reuse the structured HTTP diagnostic

`builder-digest.mjs` already converts HTTP error metadata into one bounded
machine-readable stderr line:

```text
FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}
```

The runner must capture the stderr for strict terminal updates instead of
discarding it. Add one narrow predicate that matches the complete diagnostic
shape for this response. It must require all of:

- HTTP status `409`
- sync code `http_status`
- response code `agent_job_reset_fenced`
- `retryable: false`

Do not infer this condition from prose and do not accept a generic 409.

### Scope the exception to safe local terminal states

The reset-fenced response can complete cleanup only after local process safety
has already been proven:

1. **Recorded PID absent:** no process is signaled; clear the matching marker
   only after the terminal update is recorded normally or receives the exact
   reset-fenced response.
2. **Recorded PID reused by another process:** never signal it; clear the
   matching marker only after the exact reset-fenced response proves the old
   server run is obsolete.
3. **Exact FollowBrief PID live:** terminate the verified process tree first.
   After proving the exact runner is gone, accept the exact reset-fenced
   response and clear the matching marker.

For every `stop-current` branch, marker cleanup happens only after the terminal
update is either recorded normally or classified as the exact reset-fenced
outcome. Process absence alone never permits cleanup.

The reset-fenced exception applies only to `stop-current`, whose requested
terminal outcome is local absence. `mark-replaced` never treats
`agent_job_reset_fenced` as success, whether the recorded PID is exact, absent,
or reused. Replacement retains the existing strict handoff requirement and
preserves the marker whenever its server update is rejected.

Marker deletion continues to use `clear_current_file`, which verifies the
expected `instanceId` immediately before removal. Account ownership checks in
the generated stop prompt remain unchanged.

### Error propagation

Strict job-run updates return one of three outcomes to Cloud host control:

- **recorded:** the server accepted the terminal state;
- **reset-fenced:** the server explicitly discarded the old run and local
  process absence has already been proven;
- **failed:** every other CLI, authentication, network, timeout, HTTP, or
  malformed-diagnostic result.

Only the first two outcomes allow marker cleanup and a successful runner exit.
Failure preserves the marker, causes `stop-current` to exit non-zero, and
prevents the prompt from removing runtime pins.

Human-facing stderr should distinguish reset-fenced reconciliation from a normal
recorded terminal update without exposing credentials or raw response bodies.

## Architecture and File Boundaries

### `src/lib/reset-fence.ts`

Own the stable reset-fenced response code on `StaleWorkerWriteError`. This keeps
the code tied to the error's semantics rather than duplicating a string in the
route.

### `src/app/api/skill/job-runs/route.ts`

Serialize `StaleWorkerWriteError` as a structured non-retryable 409. Do not
change transaction or lifecycle merge behavior.

### `scripts/builder-digest.mjs`

No new transport format is needed. Continue using the existing
`FOLLOWBRIEF_ERROR` diagnostic, which already includes `responseCode` and
`retryable`.

### `scripts/builder-agent-runner.sh`

Capture strict terminal update diagnostics in a bounded temporary file, expose a
small exact-match predicate, and let `stop-current` distinguish reset-fenced
obsolescence from other failures. Keep PID verification, termination, marker
instance checks, and account scoping unchanged.

### Generated runtime assets

The downloadable agent bundle already includes the runner, CLI, and prompt
assets. Existing bundle integrity tests must continue to prove the changed
runner is distributed.

## Testing

Add regression coverage at the behavior boundaries.

### API contract

- `StaleWorkerWriteError` serializes status 409, code
  `agent_job_reset_fenced`, and `retryable: false`.
- Other API errors do not receive this code.
- The API still refuses to create a missing terminal run.

### CLI diagnostic

- The existing diagnostic retains the exact response code and retryability.
- Malformed or absent response metadata does not produce the accepted shape.

### Runner lifecycle

- Dead recorded PID plus exact reset-fenced response clears the matching marker
  and exits successfully.
- Reused PID is not signaled; exact reset-fenced response permits only marker
  cleanup.
- Exact live FollowBrief PID is terminated and verified absent before an exact
  reset-fenced response permits cleanup.
- Generic 409, 401, 429, 5xx, network failure, timeout, and malformed diagnostic
  preserve the marker and return non-zero.
- `mark-replaced` does not accept the reset-fenced exception while an exact
  worker remains live.
- A marker whose `instanceId` changes during cleanup is never removed.

### Prompt ordering

- Runtime pins remain after any failed runner cleanup.
- Runtime pins are removed only after the runner reports success.

Run focused tests first, then lint, TypeScript, the full test suite, production
build, and `git diff --check`.

## Non-goals

- No weakening or removal of the global reset fence.
- No recreation of RESET-deleted job history.
- No generic HTTP 409 suppression.
- No changes to Cloud content, submissions, source tasks, leases, or ordinary
  Fetch sources / AI Brief schedules.
- No new dependency.
- No redesign of the Cloud monitor UI.
- No broad refactor of the runner or HTTP client.
