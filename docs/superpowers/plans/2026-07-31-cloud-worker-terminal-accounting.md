# Cloud Worker Terminal Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cloud worker progress, worker-lane counts, child task lifecycle, and host counters agree with server-authoritative terminal sync results.

**Architecture:** Convert the existing cloud sync API response into the fetch-progress outcome shape and reuse the idempotent progress reconciler after every partial or final cloud sync. Add pure cloud-worker status/accounting helpers so the admin UI consistently prefers persisted terminal outcomes over stale live heartbeats while leaving regular-user fetch behavior unchanged.

**Tech Stack:** Node.js CLI (`scripts/builder-digest.mjs`), TypeScript/React, Next.js admin UI, Node test runner via `tsx --test`.

---

## File Structure

- Modify `scripts/builder-digest.mjs`: translate authoritative cloud sync response posts into progress outcomes and emit reconciled progress.
- Modify `tests/builder-digest-cli.test.ts`: cover response translation, metadata preservation, idempotent repeated partial outcomes, and command wiring.
- Modify `src/lib/cloud-worker-task-display.ts`: centralize status normalization, terminal precedence, bucket accounting, and lane presentation.
- Modify `tests/cloud-worker-task-display.test.ts`: unit-test the observed lane contradictions and every terminal bucket.
- Modify `src/components/AdminCloudFetchLog.tsx`: consume the pure helpers, suppress stale live overlays, render correct counts and status chips, and preserve the newest persisted task when history repeats an id.
- Modify `tests/cloud-admin-page.test.ts`: update the component contract away from live-first precedence and assert action-needed/skipped lane presentation.

### Task 1: Lock Server-Authoritative Cloud Progress Behavior

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/builder-digest.mjs`

- [ ] **Step 1: Write failing outcome-conversion tests**

Add a test that imports a new exported helper and supplies the same shape returned
by `/api/admin/cloud-fetch/sync`:

```ts
const outcomes = cli.cloudSyncProgressOutcomesForTest([
  {
    details: {
      posts: [
        {
          id: "post-synced",
          status: "synced",
          workerId: "worker-10",
          summaryChars: 657,
          summaryWords: 93,
        },
        {
          id: "post-blocked",
          status: "blocked",
          failureReason: "x_token_invalid",
          workerId: "worker-11",
        },
      ],
    },
  },
]);

assert.deepEqual(outcomes, [
  {
    fetchTaskId: "post-synced",
    status: "synced",
    workerId: "worker-10",
    summaryChars: 657,
    summaryWords: 93,
  },
  {
    fetchTaskId: "post-blocked",
    status: "action_needed",
    workerId: "worker-11",
    failureReason: "x_token_invalid",
  },
]);
```

Also cover:

- `skipped` and `failed`;
- native server `action_needed` passthrough in addition to
  `blocked -> action_needed`;
- malformed posts;
- repeated server replay responses passed twice through
  `applyFetchProgressTaskOutcomes`;
- partial and final progress counters/stage messages when action-needed work is
  present.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/builder-digest-cli.test.ts
```

Expected: FAIL because `cloudSyncProgressOutcomesForTest` does not exist.

- [ ] **Step 3: Implement the response translator**

In `scripts/builder-digest.mjs`, add a pure helper that:

```js
function cloudSyncProgressOutcomes(taskResults = []) {
  // flatten result.details.posts
  // accept only posts with an id and explicit terminal status
  // normalize blocked -> action_needed
  // keep workerId, failureReason, body/headline/summary chars and words
}

export function cloudSyncProgressOutcomesForTest(taskResults = []) {
  return cloudSyncProgressOutcomes(taskResults);
}
```

Do not infer success from the request payload.

- [ ] **Step 4: Reconcile progress after successful cloud sync**

Update `syncCloudBuilders(args)` to:

```js
const partialOutcomes = args.includes("--partial-outcomes");
// ... POST uploadPayload ...
const taskOutcomes = cloudSyncProgressOutcomes(result.taskResults);
const fetchProgress =
  (await readFetchProgressState()) ??
  createFetchProgressState({ stage: "syncing" });
applyFetchProgressTaskOutcomes(
  fetchProgress,
  taskOutcomes,
  plannedTasks.map((task) => String(task?.id || fetchTaskId(task))).filter(Boolean),
);
await emitFetchJobProgress(config, fetchProgress, {
  stage: partialOutcomes ? "workers_running" : "reconciled",
  current: partialOutcomes ? { task: null } : {},
  event: {
    type: partialOutcomes ? "checkpoint_synced" : "reconciled",
    message: /* exact reconciled count */,
  },
});
```

Only perform this after a successful server response. Keep `--no-web-sync`
behavior unchanged.

- [ ] **Step 5: Add command-level contract assertions**

Update the existing `sync-cloud-builders` test to require:

- `--partial-outcomes` handling,
- `result.taskResults` conversion,
- `applyFetchProgressTaskOutcomes`,
- `emitFetchJobProgress`,
- partial `workers_running` and final `reconciled` stages.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/builder-digest-cli.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Commit only the CLI and CLI-test changes with a Lore-format message recording
that server response outcomes, not upload intent, are authoritative.

### Task 2: Centralize Cloud Worker Terminal Precedence and Accounting

**Files:**
- Modify: `src/lib/cloud-worker-task-display.ts`
- Modify: `tests/cloud-worker-task-display.test.ts`

- [ ] **Step 1: Write failing status-resolution tests**

Add tests for:

```ts
assert.equal(resolveCloudWorkerTaskStatus("synced", "summarized"), "synced");
assert.equal(resolveCloudWorkerTaskStatus("failed", "running"), "failed");
assert.equal(resolveCloudWorkerTaskStatus("skipped", "queued"), "skipped");
assert.equal(resolveCloudWorkerTaskStatus("blocked", "summarized"), "action_needed");
assert.equal(resolveCloudWorkerTaskStatus("pending", "running"), "running");
assert.equal(resolveCloudWorkerTaskStatus("pending", "synced"), "synced");
```

Add accounting fixtures matching production:

- four persisted `synced` tasks plus one `failed` task, with two stale live
  `summarized` statuses, must yield `synced: 4`, `failed: 1`, `pending: 0`,
  lane label `PARTIAL`;
- two persisted synced plus stale summarized live statuses must yield `2/2`
  and `SYNCED`;
- all skipped must yield `SKIPPED`;
- action-needed must be terminal and separately counted;
- all bucket counts must sum to the task count.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts
```

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement normalization and precedence**

Add pure exports:

```ts
export function normalizeCloudWorkerTaskStatus(status: string | null | undefined)
export function isCloudWorkerTerminalStatus(status: string | null | undefined)
export function resolveCloudWorkerTaskStatus(
  persistedStatus: string | null | undefined,
  liveStatus: string | null | undefined,
)
```

Persisted terminal status wins. Otherwise a live status wins, followed by the
persisted nonterminal status. Normalize `blocked` to `action_needed`.

- [ ] **Step 4: Implement accounting and presentation**

Add a pure summary helper returning:

```ts
{
  synced,
  skipped,
  failed,
  actionNeeded,
  pending,
  status: "running" | "action_needed" | "partial" | "failed" | "synced" | "skipped",
  label: "RUNNING" | "ACTION NEEDED" | "PARTIAL" | "FAILED" | "SYNCED" | "SKIPPED",
}
```

Use the precedence specified in the design document.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Commit the pure helper and test changes with a Lore-format message.

### Task 3: Make the Admin Cloud Monitor Consume One Truth

**Files:**
- Modify: `src/components/AdminCloudFetchLog.tsx`
- Modify: `tests/cloud-admin-page.test.ts`

- [ ] **Step 1: Update component contract tests to fail**

Replace the old assertion that requires:

```ts
entry.liveTask?.status ?? entry.task.status
```

with assertions that the component imports and uses the new resolver/accounting
helpers, renders `actionNeeded`, and supports `SKIPPED` and `ACTION NEEDED`
lane labels.

- [ ] **Step 2: Add a behavior-level merged-lane regression test**

Export `buildWorkerShardGroups` under a test-facing name and exercise it with:

- two persisted delivery batches containing the same post id, newest batch
  first and carrying the terminal `synced` result;
- an older duplicate carrying a nonterminal state;
- a live task for the same id still reporting `summarized`.

Assert the returned lane:

- contains that task once;
- retains the newest persisted `synced` state;
- reports `synced: 1` and `pending: 0`;
- passes `liveTask: null` to `TaskRow`, proving the stale “waiting for server
  sync” overlay is suppressed.

Add the corresponding five-task production fixture to prove four synced plus
one failed yields `4/5`, not `2/5`.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/cloud-admin-page.test.ts
```

Expected: FAIL because the component still uses live-first status and lacks the
new buckets.

- [ ] **Step 4: Resolve each merged task once**

Update `buildWorkerShardGroups` so:

- the newest persisted delivery post wins when history repeats an id;
- persisted post statuses are normalized before `TaskRow` rendering;
- `resolveCloudWorkerTaskStatus` determines the effective status;
- a persisted terminal task suppresses a conflicting/stale live overlay;
- a live terminal status can still finish a persisted nonterminal task;
- stale live timestamps are omitted when the live overlay is suppressed.

- [ ] **Step 5: Render derived lane state and counts**

Replace ad hoc filter/count logic and ternary status labels with the pure lane
summary. Extend `WorkerShardGroup` and `formatPostOutcomeSummary` with
`actionNeeded`, and pass the resolved lane status to `statusClass`.

- [ ] **Step 6: Run focused UI contract tests**

Run:

```bash
npx tsx --test tests/cloud-admin-page.test.ts tests/cloud-worker-task-display.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Commit the admin UI and component contract changes with a Lore-format message.

### Task 4: Verify the Complete Repair

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run all focused cloud tests**

Run:

```bash
npx tsx --test \
  tests/builder-digest-cli.test.ts \
  tests/cloud-worker-task-display.test.ts \
  tests/cloud-admin-page.test.ts \
  tests/cloud-fetch-run-log.test.ts \
  tests/cloud-fetch-terminal-reconcile.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run static verification**

Run:

```bash
npm run lint
npx tsc --noEmit
npm run build
git diff --check main...HEAD
```

Expected: zero lint/type/build/diff errors. The build includes prompt runtime
trace verification.

- [ ] **Step 4: Review the final diff**

Confirm:

- regular `sync-builders` code is behaviorally unchanged;
- cloud progress only updates after a successful API response;
- every worker-lane task belongs to exactly one accounting bucket;
- no historical delivery-batch sum is used to fabricate host totals;
- no unrelated user files or untracked main-worktree files are included.
