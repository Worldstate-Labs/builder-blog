# Reset-Fenced Cloud Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `stop-current` finish local Cloud worker cleanup after RESET only when the server returns the exact non-retryable reset-fenced response and local process absence is proven.

**Architecture:** Keep the reset fence strict and add a structured 409 response code at the API boundary. Reuse the CLI's existing `FOLLOWBRIEF_ERROR` diagnostic, capture it only for strict lifecycle updates, map the exact diagnostic to a dedicated shell return code, and let only `stop-current` accept that code after PID safety checks.

**Tech Stack:** Next.js route handlers, TypeScript, Node.js CLI, POSIX shell, Node test runner.

---

## File Responsibilities

- `src/lib/reset-fence.ts`: owns the stable public code and retryability of a reset-fenced worker write.
- `src/app/api/skill/job-runs/route.ts`: serializes the structured non-retryable 409 without changing lifecycle persistence.
- `scripts/builder-digest.mjs`: existing structured HTTP diagnostic; no production change expected.
- `scripts/builder-agent-runner.sh`: captures strict job-update diagnostics and applies the exception only to safe `stop-current` branches.
- `tests/reset-fence.test.ts`: locks the error metadata contract.
- `tests/agent-job-runs.test.ts`: locks the API response shape.
- `tests/builder-digest-cli.test.ts`: proves the existing CLI diagnostic carries the new response code exactly.
- `tests/cloud-source-cli-contract.test.ts`: executes extracted runner functions against dead, reused, live, reset-fenced, and ambiguous-error scenarios.

### Task 1: Publish a structured reset-fenced API contract

**Files:**
- Modify: `tests/reset-fence.test.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `src/lib/reset-fence.ts`
- Modify: `src/app/api/skill/job-runs/route.ts`

- [ ] **Step 1: Write the failing reset-fence metadata test**

Add a test that constructs `StaleWorkerWriteError` and expects:

```ts
assert.equal(error.statusCode, 409);
assert.equal(error.responseCode, "agent_job_reset_fenced");
assert.equal(error.retryable, false);
```

- [ ] **Step 2: Write the failing route contract assertion**

Extend the agent job-run API test to require:

```ts
assert.match(
  route,
  /NextResponse\.json\(\{ error: error\.message, code: error\.responseCode, retryable: error\.retryable \}, \{ status: error\.statusCode \}\)/,
);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test tests/reset-fence.test.ts tests/agent-job-runs.test.ts
```

Expected: failures because `responseCode`, `retryable`, and the structured route response do not exist.

- [ ] **Step 4: Implement the minimal structured error**

In `StaleWorkerWriteError`, add:

```ts
readonly responseCode = "agent_job_reset_fenced";
readonly retryable = false;
```

Serialize those fields in the existing route catch:

```ts
return NextResponse.json(
  {
    error: error.message,
    code: error.responseCode,
    retryable: error.retryable,
  },
  { status: error.statusCode },
);
```

Do not change when the error is thrown and do not create missing terminal runs.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same focused command. Expected: all tests pass.

- [ ] **Step 6: Commit**

Commit with Lore trailers describing the strict reset-fence constraint and focused test evidence.

### Task 2: Classify only the exact CLI diagnostic

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `scripts/builder-agent-runner.sh`

- [ ] **Step 1: Write the failing CLI diagnostic expectation**

Add a test using `cliHttpErrorDiagnosticForTest` with:

```ts
{
  isHttpSyncError: true,
  httpStatus: 409,
  httpSyncCode: "http_status",
  httpResponseCode: "agent_job_reset_fenced",
  httpRetryable: false,
}
```

Expect the exact bounded line:

```text
FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}
```

This should pass immediately because the transport already supports the required
metadata; it is a characterization test, not the RED test for runner behavior.

- [ ] **Step 2: Write the failing executable strict-wrapper test**

In `tests/cloud-source-cli-contract.test.ts`, extract
`strict_job_run_update_for_instance` and the new classifier into the existing
temporary shell harness. Explicitly set:

```sh
JOB_UPDATE_RESET_FENCED=78
```

Stub `job_run_update_for_instance` to write the exact diagnostic into
`$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE` and return non-zero. Execute the wrapper
and assert:

- it returns `78`;
- a pre-existing `BUILDER_BLOG_JOB_UPDATE_ERROR_FILE` value is restored;
- the per-call capture file no longer exists;
- a generic 409, malformed line, or missing file returns the original failure
  code instead of `78`.

Add source contract assertions in `tests/agent-job-runs.test.ts` for a dedicated
numeric return code and for `job_run_update` redirecting stderr only when the
strict wrapper supplies an error file.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test \
  tests/builder-digest-cli.test.ts \
  tests/agent-job-runs.test.ts \
  tests/cloud-source-cli-contract.test.ts
```

Expected: the CLI characterization passes and runner assertions fail because
capture/classification is missing. The executable wrapper test must fail on its
expected return code or cleanup assertion, not from an undefined shell variable.

- [ ] **Step 4: Implement bounded strict-update capture**

Add a constant shell status such as:

```sh
JOB_UPDATE_RESET_FENCED=78
```

Add an exact classifier:

```sh
job_update_error_is_reset_fenced() {
  _file="${1:-}"
  [ -s "$_file" ] || return 1
  grep -Fqx \
    'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' \
    "$_file"
}
```

When `BUILDER_BLOG_JOB_UPDATE_ERROR_FILE` is set, `job_run_update` sends only CLI
stderr to that exact file while continuing to discard stdout. The strict wrapper
creates a per-process file under `JOB_STATE_DIR`, restores any prior environment
value, removes the file, and returns `JOB_UPDATE_RESET_FENCED` only when the
underlying command failed and the exact diagnostic is present. Every other
failure retains its original non-zero status.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same focused command. Expected: all tests pass.

- [ ] **Step 6: Commit**

Commit the transport/classifier change separately with Lore trailers.

### Task 3: Make `stop-current` idempotent after RESET

**Files:**
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `scripts/builder-agent-runner.sh`

- [ ] **Step 1: Add failing dead-PID reset-fenced test**

Use the existing extracted-shell-function harness. Stub
`job_run_update_for_instance` or the strict wrapper so the terminal update
returns `JOB_UPDATE_RESET_FENCED`. Every extracted-function harness must
explicitly set `JOB_UPDATE_RESET_FENCED=78` before calling the function; top-level
runner constants are not included by `shellFunction`. Assert:

- `stop-current` exits zero;
- the matching marker is removed;
- no termination helper runs;
- output states that the reset-fenced stale worker was reconciled.

- [ ] **Step 2: Add failing exact-live reset-fenced test**

Simulate an exact verified runner, successful TERM/KILL verification, and the
reset-fenced return code. Assert the process tree is terminated before the
matching marker is removed and the command exits zero.

- [ ] **Step 3: Add failing reused-PID reset-fenced test**

Simulate a live PID whose argv/start identity does not match. Assert it is never
signaled and the marker is removed only after the exact reset-fenced outcome.

- [ ] **Step 4: Add failing rejection matrix tests**

For `stop-current`, verify generic 409/missing diagnostic/ordinary non-zero
updates preserve the marker and return non-zero.

For `mark-replaced`, cover exact, absent, and reused PID branches and prove
`JOB_UPDATE_RESET_FENCED` is never accepted as success.

Each harness injects `JOB_UPDATE_RESET_FENCED=78` explicitly, so it tests the
chosen shell protocol rather than depending on unextracted top-level source.

- [ ] **Step 5: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test tests/cloud-source-cli-contract.test.ts
```

Expected: new lifecycle cases fail because the dedicated return code is handled
as a generic failure.

- [ ] **Step 6: Implement explicit outcome handling**

Replace `if ! strict_job_run_update_for_instance ...` at Cloud host control
sites with captured status handling:

```sh
_update_code=0
strict_job_run_update_for_instance ... || _update_code=$?
```

Rules:

- Normal code `0`: preserve existing behavior.
- `JOB_UPDATE_RESET_FENCED`: accept only when action is `stop-current` and the
  exact process is already proven absent.
- Every other non-zero code: preserve the existing marker and failure message.
- `mark-replaced` never accepts the special code.

Use `clear_current_file` unchanged so an instance race cannot delete a newer
marker.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the same focused command, then:

```bash
node --import tsx --test \
  tests/reset-fence.test.ts \
  tests/agent-job-runs.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/cloud-source-cli-contract.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 8: Commit**

Commit lifecycle handling and regression coverage with Lore trailers.

### Task 4: Verify distribution, safety, and production build

**Files:**
- Verify only unless a focused failure identifies a required correction.

- [ ] **Step 1: Verify generated prompt ordering**

Run relevant prompt/runner contract tests and confirm runtime pins remain after
runner failure and are removed only after runner success.

Run the downloadable runtime coverage explicitly:

```bash
node --import tsx --test \
  tests/prompt-runtime-assets.test.ts \
  tests/agent-skill-bundle.test.ts \
  tests/agent-job-runs.test.ts \
  tests/cloud-source-cli-contract.test.ts
```

Expected: runner/CLI assets remain bundled and every lifecycle contract passes.

- [ ] **Step 2: Run lint and typecheck**

```bash
npm run lint
npx tsc --noEmit
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: zero failures.

- [ ] **Step 4: Run production build and runtime asset tracing**

```bash
npm run build
```

Expected: Next.js build succeeds and every downloadable runtime asset is traced.

- [ ] **Step 5: Verify diff hygiene**

```bash
git diff --check
git status --short
```

- [ ] **Step 6: Request independent code review**

Review specifically for:

- generic 409 suppression;
- reset-fence weakening;
- PID-reuse signaling risk;
- marker instance races;
- shell return-code loss;
- temporary diagnostic leakage or cleanup failure.

- [ ] **Step 7: Address findings with TDD and re-run verification**

Any behavioral correction starts with a failing regression test.

- [ ] **Step 8: Commit final review fixes**

Use a separate Lore commit when review changes are material.

### Task 5: Integrate and push `main`

**Files:**
- Git integration only.

- [ ] **Step 1: Fetch the latest remote main**

```bash
git fetch origin main
```

- [ ] **Step 2: Rebase the feature branch if main advanced**

Resolve only changes within this task's files and preserve unrelated work.

- [ ] **Step 3: Re-run focused tests after integration**

Run the four focused test files.

- [ ] **Step 4: Fast-forward local main and verify**

Merge the verified feature branch into local `main`, then run `npm test`.

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Confirm exact remote commit**

Verify local `HEAD` equals `origin/main`. Do not force-push.
