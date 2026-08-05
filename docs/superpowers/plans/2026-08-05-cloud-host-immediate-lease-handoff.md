# Cloud Host Immediate Lease Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Immediately requeue unfinished Cloud source leases after an explicitly controlled host replacement, but only for the authenticated admin and exact stopped `AgentJobRun` whose local process tree is proven absent.

**Architecture:** New Cloud runs persist server-derived admin/job ownership. A focused transactional release helper resolves that ownership, joins the global reset fence, locks run-task rows in deterministic order, terminalizes only unfinished run tasks, and requeues only their still-leased queue rows. A narrow admin endpoint and CLI command expose the operation; the shell runner calls it only after exact local absence and terminal job accounting, preserving `current.json` on every ambiguous failure.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Prisma/PostgreSQL, Node CLI (`.mjs`), POSIX shell, Node test runner.

**Design spec:** `docs/superpowers/specs/2026-08-05-cloud-host-immediate-lease-handoff-design.md`

**Baseline:** isolated worktree `/Users/jie/code/builder_blog/.worktrees/cloud-host-lease-handoff`; `npm test` passes 1113 tests before implementation.

---

## File map

- `prisma/schema.prisma` — durable Cloud-run-to-worker ownership relation and lookup index.
- `prisma/migrations/000092_cloud_fetch_worker_ownership/migration.sql` — nullable forward-only ownership migration; intentionally no legacy backfill.
- `src/lib/cloud-source-scheduler.ts` — require trusted ownership inputs and stamp every newly leased Cloud run.
- `src/app/api/admin/cloud-fetch/lease/route.ts` — derive ownership from authenticated admin plus public worker instance ID.
- `scripts/smoke-cloud-source-fetch-rollback.mts` — create a real smoke `AgentJobRun` before invoking the now ownership-required scheduler.
- `src/lib/cloud-fetch-run-task-lock.ts` — canonicalize lock order for sync and release callers.
- `src/lib/cloud-fetch-worker-release.ts` — one responsibility: release unfinished work for one authenticated Cloud worker inside a reset-fenced transaction.
- `src/lib/cloud-fetch-run-lifecycle.ts` — existing `recomputeCloudFetchRun` aggregate helper reused without modification.
- `src/app/api/admin/cloud-fetch/release/route.ts` — admin-only HTTP adapter for the release helper.
- `src/lib/cloud-fetch-conflict.ts` — shared machine-readable release conflict codes.
- `scripts/builder-digest.mjs` — deterministic `release-cloud-fetch` command.
- `scripts/builder-agent-runner.sh` — invoke release only after process absence and terminal update; retain recovery marker until a safe outcome.
- `tests/cloud-source-api.test.ts` — schema, migration, lease-route, and release-route contracts.
- `tests/cloud-source-scheduler.test.ts` — Cloud run ownership stamping.
- `tests/cloud-fetch-run-task-lock.test.ts` — sorted/deduplicated lock ordering.
- `tests/cloud-fetch-worker-release.test.ts` — transactional isolation, idempotency, reset-fence, and aggregate behavior.
- `tests/builder-digest-cli.test.ts` — real CLI/HTTP request contract.
- `tests/cloud-source-cli-contract.test.ts` — shell handoff ordering and marker-retention behavior.
- `tests/reset-fence.test.ts` — ownership-aware lease and release reset-fence contracts.

## Central contract vocabulary

Keep these values exported from `src/lib/cloud-fetch-worker-release.ts`; the route, CLI expectations, and runner tests must use these spellings:

```ts
export const CLOUD_WORKER_RELEASE_OUTCOME = {
  released: "released",
  alreadyReleased: "already_released",
} as const;

export const CLOUD_WORKER_RELEASE_ERROR = {
  jobNotFound: "cloud_release_job_not_found",
  resetFenced: "agent_job_reset_fenced",
} as const;
```

The successful JSON shape is:

```ts
type CloudWorkerReleaseResult = {
  outcome: "released" | "already_released";
  releasedRuns: number;
  releasedSourceTasks: number;
  requeuedQueueItems: number;
};
```

### Task 1: Add durable Cloud worker ownership

**Files:**
- Modify: `tests/cloud-source-api.test.ts`
- Modify: `prisma/schema.prisma:84-107,604-626`
- Create: `prisma/migrations/000092_cloud_fetch_worker_ownership/migration.sql`

- [ ] **Step 1: Write the failing schema/migration contract test**

Add a focused test that reads the schema and new migration and asserts:

```ts
assert.match(schema, /model AgentJobRun \{[\s\S]*cloudFetchRuns\s+CloudFetchRun\[\]/);
assert.match(schema, /model CloudFetchRun \{[\s\S]*agentJobRunId\s+String\?/);
assert.match(schema, /agentJobRun\s+AgentJobRun\?\s+@relation\(fields: \[agentJobRunId\], references: \[id\], onDelete: SetNull\)/);
assert.match(schema, /@@index\(\[createdByUserId, agentJobRunId, status\]\)/);
assert.match(migration, /ADD COLUMN "agentJobRunId" TEXT/);
assert.match(migration, /ON DELETE SET NULL ON UPDATE CASCADE/);
assert.doesNotMatch(migration, /UPDATE "CloudFetchRun"[\s\S]*"agentJobRunId"/);
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `npx tsx --test --test-name-pattern 'Cloud worker ownership' tests/cloud-source-api.test.ts`

Expected: FAIL because the relation, index, and migration do not exist.

- [ ] **Step 3: Add the nullable relation and migration**

Add `cloudFetchRuns CloudFetchRun[]` to `AgentJobRun`. Add these fields/index to `CloudFetchRun`:

```prisma
agentJobRunId String?
agentJobRun   AgentJobRun? @relation(fields: [agentJobRunId], references: [id], onDelete: SetNull)

@@index([createdByUserId, agentJobRunId, status])
```

Create a migration that adds the nullable column, composite index, and foreign key with `ON DELETE SET NULL`. Do not backfill pre-migration rows.

- [ ] **Step 4: Validate Prisma and rerun the test**

Run: `npx prisma format && npx prisma validate && npx tsx --test --test-name-pattern 'Cloud worker ownership' tests/cloud-source-api.test.ts`

Expected: schema valid and focused test PASS.

- [ ] **Step 5: Commit**

Stage only the three Task 1 files and create a Lore-format commit whose intent is to establish auditable Cloud worker ownership. Record schema validation and the focused test in `Tested:`.

### Task 2: Stamp server-derived ownership on every new lease run

**Files:**
- Modify: `tests/cloud-source-scheduler.test.ts:1-30` and the lease-run creation assertion
- Modify: `tests/cloud-source-api.test.ts:549-570`
- Modify: `tests/reset-fence.test.ts:143-158`
- Modify: `src/lib/cloud-source-scheduler.ts:407-445,557-566`
- Modify: `src/app/api/admin/cloud-fetch/lease/route.ts:35-65`
- Modify: `scripts/smoke-cloud-source-fetch-rollback.mts:285-325`

- [ ] **Step 0: Confirm every scheduler callsite before tightening its type**

Run: `rg -n 'leaseCloudFetchTasks\(\{' src scripts tests --glob '!docs/**'`

Expected: production lease route, rollback smoke, and scheduler tests only. If another real callsite appears, update it to provide server-derived ownership in this task rather than making the ownership parameters optional.

- [ ] **Step 1: Make ownership expectations fail first**

Update the scheduler test wrapper to supply stable test ownership unless overridden:

```ts
const leaseCloudFetchTasks = (
  options: Omit<Parameters<typeof leaseCloudFetchTasksInternal>[0], "createdByUserId" | "agentJobRunId"> &
    Partial<Pick<Parameters<typeof leaseCloudFetchTasksInternal>[0], "createdByUserId" | "agentJobRunId">>,
) => leaseCloudFetchTasksInternal({
  createdByUserId: "admin_user_1",
  agentJobRunId: "agent_job_1",
  ...options,
});
```

Capture `cloudFetchRun.create()` data in one lease test and assert it contains both IDs. Extend route contracts to require `select: { id: true, createdAt: true }` and that both selected values are passed to `leaseCloudFetchTasks`.

- [ ] **Step 2: Run focused scheduler/API tests and verify failure**

Run: `npx tsx --test --test-name-pattern 'ownership|lease routes' tests/cloud-source-scheduler.test.ts tests/cloud-source-api.test.ts tests/reset-fence.test.ts`

Expected: FAIL because scheduler parameters and create data lack the IDs.

- [ ] **Step 3: Require and persist trusted ownership**

Add required `createdByUserId: string` and `agentJobRunId: string` parameters to both scheduler entry points and add them to `cloudFetchRun.create({ data })`. In the lease route, resolve `id` plus `createdAt` using the existing authenticated `userId`, `jobType`, and public `instanceId`, then pass:

```ts
createdByUserId: admin.user.id,
agentJobRunId: jobRun.id,
workerStartedAt: jobRun.createdAt,
```

Never accept either database ID from the request body.

- [ ] **Step 4: Keep the rollback smoke valid**

Before the smoke lease, create a transaction-local `cloud-library-fetch` `AgentJobRun` owned by the active Cloud library admin. Pass its ID/user ID/createdAt to the scheduler. Use the smoke marker in its unique public `instanceId` so cleanup remains transaction-scoped.

- [ ] **Step 5: Run focused tests and Prisma generation**

Run: `npx prisma generate && npx tsx --test tests/cloud-source-scheduler.test.ts tests/cloud-source-api.test.ts tests/reset-fence.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit**

Stage only Task 2 files and commit with a Lore-format message explaining that request bodies cannot choose Cloud run ownership.

### Task 3: Implement deterministic, reset-fenced worker release

**Files:**
- Modify: `tests/cloud-fetch-run-task-lock.test.ts`
- Create: `tests/cloud-fetch-worker-release.test.ts`
- Modify: `src/lib/cloud-fetch-run-task-lock.ts`
- Create: `src/lib/cloud-fetch-worker-release.ts`

- [ ] **Step 1: Write failing lock-order and lifecycle tests**

Extend the lock test with duplicate, unsorted input and assert query values are `runId`, then sorted unique task IDs.

Build an in-memory transaction fake for the new release helper. Cover:

1. lookup is exactly `{ userId, jobType: "cloud-library-fetch", instanceId }`;
2. reset fence occurs before Cloud run/task reads;
3. runs are processed by ascending ID and source IDs are locked sorted;
4. only `RUNNING` run tasks become `FAILED` with `cloud_worker_replaced` and `finishedAt`;
5. only matching `LEASED` queue rows become `QUEUED` with all lease fields plus `runId` cleared;
6. finalized run tasks and unrelated admin/job rows do not change;
7. source scheduling/backoff fields are never written;
8. affected run aggregates are recomputed;
9. first duplicate call returns `released`, second returns `already_released`, with the same lock order and no deadlock-prone inversion;
10. missing/cross-admin/wrong-job lookup throws `cloud_release_job_not_found` before Cloud writes;
11. `StaleWorkerWriteError` propagates without Cloud writes.

- [ ] **Step 2: Run new tests and verify failure**

Run: `npx tsx --test tests/cloud-fetch-run-task-lock.test.ts tests/cloud-fetch-worker-release.test.ts`

Expected: FAIL because sorting and the helper do not exist.

- [ ] **Step 3: Canonicalize the shared task-lock helper**

Change its normalized ID list to `.sort((left, right) => left.localeCompare(right))` after filtering/deduplication. This makes sync and release share one deterministic row-lock order.

- [ ] **Step 4: Add the release helper**

Implement a public wrapper with an optional injected `PrismaClient`, a 60-second interactive transaction, and a testable in-transaction helper. The in-transaction algorithm must be exactly:

```ts
const job = await prisma.agentJobRun.findFirst({
  where: { userId, jobType: "cloud-library-fetch", instanceId },
  select: { id: true, createdAt: true },
});
if (!job) throw new CloudWorkerReleaseJobNotFoundError();
await lockResetFenceForWorker(prisma, job.createdAt);
const runs = await prisma.cloudFetchRun.findMany({
  where: { createdByUserId: userId, agentJobRunId: job.id, status: CloudFetchRunStatus.RUNNING },
  select: { id: true },
  orderBy: { id: "asc" },
});
```

For each run: read `RUNNING` task IDs ordered by `cloudSourceTaskId`, call `lockCloudFetchRunTaskRows`, re-read `RUNNING` rows, terminalize those rows with a guarded `updateMany`, requeue matching guarded queue rows, then call `recomputeCloudFetchRun`. Count only successful guarded writes. If no still-running tasks exist across the owned runs, return zero counts and `already_released` without aggregate mutation.

Use a lazy `@/lib/prisma` import so unit tests do not require `DATABASE_URL`.

- [ ] **Step 5: Run helper tests**

Run: `npx tsx --test tests/cloud-fetch-run-task-lock.test.ts tests/cloud-fetch-worker-release.test.ts`

Expected: all tests PASS, including repeat release and reset-fence cases.

- [ ] **Step 6: Commit**

Stage the four Task 3 files and create a Lore-format commit documenting lock order, reset serialization, and the deliberate choice not to mutate `CloudSourceTask` failure state.

### Task 4: Add the narrow admin release endpoint

**Files:**
- Modify: `tests/cloud-source-api.test.ts`
- Modify: `src/lib/cloud-fetch-conflict.ts`
- Create: `src/app/api/admin/cloud-fetch/release/route.ts`

- [ ] **Step 1: Read this repository's installed Next.js route docs**

Read completely before route code:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`

- [ ] **Step 2: Write the failing endpoint contract test**

Assert the route:

- uses `requireCloudFetchAdmin(request)`;
- accepts only a bounded public `jobRunId` string;
- passes `admin.user.id` and that public ID to `releaseCloudFetchWorkerLeases`;
- never accepts `runId`, `agentJobRunId`, or `createdByUserId` from the body;
- maps job-not-found to `cloud_release_job_not_found`, stale worker to exact `agent_job_reset_fenced`, both non-retryable 409;
- returns helper counts/outcome unchanged.

- [ ] **Step 3: Run the route contract and verify failure**

Run: `npx tsx --test --test-name-pattern 'release endpoint' tests/cloud-source-api.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 4: Implement the route and conflict types**

Add the two release codes to the shared conflict-code union. Implement `POST` with `dynamic = "force-dynamic"`, the existing admin guard, a trimmed/max-160 `jobRunId`, and the helper call. Missing IDs deliberately receive the same `cloud_release_job_not_found` response as unknown/wrong IDs. Catch only `CloudWorkerReleaseJobNotFoundError` and `StaleWorkerWriteError`; let unexpected failures surface.

- [ ] **Step 5: Run API/helper tests**

Run: `npx tsx --test tests/cloud-source-api.test.ts tests/cloud-fetch-worker-release.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Stage only the route, conflict helper, and API test. Commit with a Lore-format message noting that arbitrary Cloud run cancellation remains unavailable.

### Task 5: Expose one deterministic CLI command

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/builder-digest.mjs:625-650,12240-12325,13820-13855`

- [ ] **Step 1: Write failing real-process CLI tests**

Use a local `createServer` and invoke:

```bash
node scripts/builder-digest.mjs release-cloud-fetch --job-run-id host-1
```

with temporary agent config environment. Assert exactly one authenticated POST to `/api/admin/cloud-fetch/release`, body exactly `{ "jobRunId": "host-1" }`, no retry, bounded JSON stdout, and no credential/source leakage. Add a missing-argument case that fails before contacting the server.

- [ ] **Step 2: Run the CLI test and verify failure**

Run: `npx tsx --test --test-name-pattern 'release-cloud-fetch' tests/builder-digest-cli.test.ts`

Expected: FAIL because the command is not routed.

- [ ] **Step 3: Implement the CLI command**

Add usage text and:

```js
async function releaseCloudFetch(args) {
  const config = await readConfig();
  requireLoggedIn(config);
  const jobRunId = String(argValue(args, "--job-run-id") || "").trim();
  if (!jobRunId) throw new Error("Missing --job-run-id <id> for release-cloud-fetch.");
  const result = await postJson(
    `${config.appUrl}/api/admin/cloud-fetch/release`,
    { jobRunId },
    config.token,
    { label: "cloud fetch release", retries: 0 },
  );
  console.log(JSON.stringify(result, null, 2));
}
```

Route `command === "release-cloud-fetch"` to it. Reuse the existing structured HTTP diagnostic; do not add another error format.

- [ ] **Step 4: Rerun focused CLI tests**

Run: `npx tsx --test --test-name-pattern 'release-cloud-fetch|HTTP diagnostics' tests/builder-digest-cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Stage the CLI and its test; create a Lore-format commit documenting the single accepted identity input and zero automatic retries.

### Task 6: Gate local handoff on confirmed server release

**Files:**
- Modify: `tests/cloud-source-cli-contract.test.ts:20-45,3260-3780`
- Modify: `tests/agent-job-runs.test.ts:910-930`
- Modify: `scripts/builder-agent-runner.sh:55,2629-2795`

- [ ] **Step 1: Extend the shell harness with a default release stub**

Add `release_cloud_worker_leases_for_instance() { return 0; }` after extracted runner functions so existing stop tests remain isolated. Focused tests can redefine the stub to record calls and return selected outcomes.

- [ ] **Step 2: Write failing handoff-order tests**

Cover these exact paths:

- exact live stop logs `terminate -> terminal-update -> release`, then removes the matching marker;
- dead and reused-PID reconciliation never signal another process, but do `terminal-update -> release` before marker removal;
- release failure leaves `current.json` and returns nonzero;
- retry success removes only a marker whose `instanceId` still matches;
- terminal-update exit 78 skips release and clears after proven local absence;
- release-time exact non-retryable `agent_job_reset_fenced` is accepted and clears;
- `cloud_release_job_not_found`, authentication, malformed JSON, generic 409, retryable reset fence, and network failure all preserve the marker;
- `mark-replaced` never calls release.

Update the static job-run contract test to assert release occurs after `strict_job_run_update_for_instance` and before `clear_current_file`.

- [ ] **Step 3: Run focused shell tests and verify failure**

Run: `npx tsx --test --test-name-pattern 'cloud host control|release' tests/cloud-source-cli-contract.test.ts tests/agent-job-runs.test.ts`

Expected: new assertions FAIL because stop currently clears immediately after terminal accounting.

- [ ] **Step 4: Implement a strict release wrapper**

Add `release_cloud_worker_leases_for_instance` that:

1. creates private temp stdout/stderr files under `JOB_STATE_DIR`;
2. runs `node "$AGENT_DIR/builder-digest.mjs" release-cloud-fetch --job-run-id "$instance"`;
3. accepts HTTP success only when stdout has exact `outcome` `released` or `already_released` and prints bounded counts;
4. maps only the exact full structured `agent_job_reset_fenced`, `retryable:false` diagnostic to exit 78;
5. prints bounded failure diagnostics, deletes temp files, and returns nonzero for everything else.

Do not rely on source/run IDs from local run directories.

- [ ] **Step 5: Insert the release gate in both stop branches**

For exact-live and dead/reused paths:

```sh
strict_job_run_update_for_instance ... || _chcc_update_code=$?
if [ "$_chcc_update_code" -eq "$JOB_UPDATE_RESET_FENCED" ]; then
  # RESET is authoritative; skip release.
  clear_current_file ...
  return 0
fi
[ "$_chcc_update_code" -eq 0 ] || return 1

_chcc_release_code=0
release_cloud_worker_leases_for_instance "$_chcc_instance" || _chcc_release_code=$?
if [ "$_chcc_release_code" -ne 0 ] && [ "$_chcc_release_code" -ne "$JOB_UPDATE_RESET_FENCED" ]; then
  # Preserve marker for an idempotent retry.
  return 1
fi
clear_current_file ...
```

The exact-live path must continue proving all cached descendants absent before the terminal update. `mark-replaced` remains unchanged.

- [ ] **Step 6: Run shell syntax and contract tests**

Run: `sh -n scripts/builder-agent-runner.sh && npx tsx --test tests/cloud-source-cli-contract.test.ts tests/agent-job-runs.test.ts tests/builder-digest-cli.test.ts`

Expected: syntax valid and all tests PASS.

- [ ] **Step 7: Commit**

Stage only runner and related tests; create a Lore-format commit emphasizing marker preservation and exact reset-fence handling.

### Task 7: Full verification and independent review

**Files:**
- Modify only if verification exposes a defect in an already-scoped file.

- [ ] **Step 1: Run focused feature suite**

Run:

```bash
npx tsx --test \
  tests/cloud-fetch-worker-release.test.ts \
  tests/cloud-fetch-run-task-lock.test.ts \
  tests/cloud-source-scheduler.test.ts \
  tests/cloud-source-api.test.ts \
  tests/reset-fence.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/cloud-source-cli-contract.test.ts \
  tests/agent-job-runs.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run schema, syntax, lint, and type checks**

Run:

```bash
npx prisma validate
sh -n scripts/builder-agent-runner.sh
npx eslint \
  src/lib/cloud-source-scheduler.ts \
  src/lib/cloud-fetch-run-task-lock.ts \
  src/lib/cloud-fetch-worker-release.ts \
  src/lib/cloud-fetch-conflict.ts \
  src/app/api/admin/cloud-fetch/lease/route.ts \
  src/app/api/admin/cloud-fetch/release/route.ts \
  tests/cloud-fetch-worker-release.test.ts \
  tests/cloud-fetch-run-task-lock.test.ts \
  tests/cloud-source-scheduler.test.ts \
  tests/cloud-source-api.test.ts \
  tests/reset-fence.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/cloud-source-cli-contract.test.ts \
  tests/agent-job-runs.test.ts
npx tsc --noEmit
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run complete regressions and production build**

Run: `npm test && npm run build`

Expected: complete suite PASS and Next.js production build succeeds.

- [ ] **Step 4: Review isolation and migration safety**

Use `superpowers:requesting-code-review` with the design spec and this plan. Reviewer must specifically verify:

- regular-user Fetch/Digest paths are untouched;
- releases cannot cross authenticated admin or worker job boundaries;
- old null-owned runs retain TTL recovery;
- live/unproven processes cannot trigger release;
- reset, sync, duplicate release, and marker retry races match the design.

- [ ] **Step 5: Apply review fixes with failing regressions first**

For every accepted defect, add or strengthen a failing test, implement the minimum fix, and rerun the affected focused suite before the complete suite.

- [ ] **Step 6: Run `superpowers:verification-before-completion`**

Collect fresh final evidence from schema validation, shell syntax, lint, typecheck, complete tests, build, and `git diff --check`. Do not claim completion from earlier output.

- [ ] **Step 7: Commit any verification-only fixes**

If Step 5 changed code, stage only scoped files and use a Lore-format commit with exact `Tested:` and honest `Not-tested:` trailers. If no changes were needed, do not create an empty commit.
