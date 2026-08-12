# Cloud Worker Pre-Assignment Failures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop terminal cloud post failures from appearing as waiting for worker assignment and explain failures that occur before assignment.

**Architecture:** Keep lifecycle classification and failure-copy fallback in the pure `cloud-worker-task-display` helper module. The admin monitor consumes two disjoint subsets, renders active unassigned tasks in the existing waiting section, and conditionally renders failed unassigned tasks in a second section using the shared failure taxonomy.

**Tech Stack:** TypeScript, React, Next.js, Node test runner.

---

### Task 1: Split active and failed unassigned task selection

**Files:**
- Modify: `tests/cloud-worker-task-display.test.ts`
- Modify: `src/lib/cloud-worker-task-display.ts`

- [x] **Step 1: Write failing selection and copy tests**

Import `selectFailedBeforeAssignmentWorkerTasks` and `formatPreAssignmentFailureMessage`. Extend the queue-selection test with an unassigned failed task and assert:

```ts
assert.deepEqual(selectUnassignedWorkerTasks([waiting, failed, assigned]), [waiting]);
assert.deepEqual(selectFailedBeforeAssignmentWorkerTasks([waiting, failed, assigned]), [failed]);
```

Add focused copy cases:

```ts
assert.equal(
  formatPreAssignmentFailureMessage(task({
    status: "failed",
    reason: "workload_exceeds_max_budget",
    message: "failed.",
  })),
  "The planned extraction workload exceeded the supported four-hour execution ceiling, so the run stopped before attempting extraction.",
);
assert.equal(
  formatPreAssignmentFailureMessage(task({ status: "failed", reason: "new_failure_code", message: "failed." })),
  "new_failure_code",
);
assert.equal(
  formatPreAssignmentFailureMessage(task({ status: "failed", reason: null, message: "Downloader rejected the request." })),
  "Downloader rejected the request.",
);
assert.equal(
  formatPreAssignmentFailureMessage(task({ status: "failed", reason: null, message: "failed." })),
  "Failure reason unavailable.",
);
```

- [x] **Step 2: Run the focused unit test and verify RED**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts
```

Expected: FAIL because terminal failed tasks remain in `selectUnassignedWorkerTasks` and the new helpers do not exist.

- [x] **Step 3: Implement minimal pure helpers**

In `src/lib/cloud-worker-task-display.ts`:

```ts
import { fetchFailureInfo } from "@/lib/fetch-failure-taxonomy";

export function selectUnassignedWorkerTasks(tasks: CloudWorkerHostTask[]) {
  return tasks.filter(
    (task) =>
      !hasWorkerAssignment(task.workerId) &&
      !isCloudWorkerTerminalStatus(task.status),
  );
}

export function selectFailedBeforeAssignmentWorkerTasks(tasks: CloudWorkerHostTask[]) {
  return tasks.filter(
    (task) =>
      !hasWorkerAssignment(task.workerId) &&
      normalizeCloudWorkerTaskStatus(task.status) === "failed",
  );
}

export function formatPreAssignmentFailureMessage(task: CloudWorkerHostTask): string {
  const reason = task.reason?.trim() ?? "";
  const failure = fetchFailureInfo(reason);
  if (reason && failure.known) return failure.operatorMessage;

  const message = task.message?.trim() ?? "";
  if (message && !/^failed[.!?]?$/iu.test(message)) return message;
  if (reason) return reason;
  return "Failure reason unavailable.";
}
```

- [x] **Step 4: Run the focused unit test and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts
```

Expected: PASS.

### Task 2: Render pre-assignment failures separately

**Files:**
- Modify: `tests/cloud-admin-page.test.ts`
- Modify: `src/components/AdminCloudFetchLog.tsx`

- [x] **Step 1: Write a failing component contract test**

Require the component to import and use both new helpers, to declare `waitingTasks` and `failedBeforeAssignmentTasks`, and to render `Waiting for assignment` before a conditional `Failed before assignment` section. Require the failure section to call `formatPreAssignmentFailureMessage(task)` and to use its own row count.

- [x] **Step 2: Run the focused component contract and verify RED**

Run:

```bash
npx tsx --test tests/cloud-admin-page.test.ts
```

Expected: FAIL because the monitor still has one broad unassigned task list and no failure section.

- [x] **Step 3: Implement the monitor split**

In `WorkerHostPanel`, derive both memoized subsets:

```ts
const waitingTasks = useMemo(
  () => sortedWorkerTasks(selectUnassignedWorkerTasks(workerHost.tasks)),
  [workerHost.tasks],
);
const failedBeforeAssignmentTasks = useMemo(
  () => sortedWorkerTasks(selectFailedBeforeAssignmentWorkerTasks(workerHost.tasks)),
  [workerHost.tasks],
);
```

Update the existing waiting section to use `waitingTasks`. Immediately after it, render a second `cloud-worker-task-section` only when `failedBeforeAssignmentTasks.length > 0`. Reuse the current task row and status chip markup, use the heading/count `Failed before assignment` / `${failedBeforeAssignmentTasks.length} failed`, and render `formatPreAssignmentFailureMessage(task)` for the message.

- [x] **Step 4: Run both focused suites and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts tests/cloud-admin-page.test.ts
```

Expected: PASS.

### Task 3: Verify regression surface and commit

**Files:**
- Verify all modified files.

- [x] **Step 1: Run directly related suites**

```bash
npx tsx --test \
  tests/cloud-worker-task-display.test.ts \
  tests/cloud-admin-page.test.ts \
  tests/cloud-fetch-run-log.test.ts \
  tests/fetch-failure-taxonomy.test.ts
```

Expected: PASS.

- [x] **Step 2: Run repository quality gates**

```bash
npm test
npm run lint
npm run build
```

Expected: all commands exit 0. If the isolated worktree lacks `.env`, load the main workspace environment into the build process without copying or printing secrets.

- [x] **Step 3: Review and commit only task-owned changes**

Run `git diff --check`, inspect the complete diff, and commit the helper, component, tests, and this plan with a Lore-format message. Do not change cloud execution budgets or persisted task data.
