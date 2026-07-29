# Cloud Worker Task Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Post task queue show only unassigned work with readable labels, while Worker lanes shows only tasks assigned to real local worker slots.

**Architecture:** Add a small pure presentation helper for assignment predicates and deterministic task labels. Keep the worker/API contract unchanged; `AdminCloudFetchLog` will consume the helper to create mutually exclusive queue and lane projections, then use existing components and styling for rendering.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router client components, Node test runner through `tsx --test`, CSS.

---

## File Structure

- Create `src/lib/cloud-worker-task-display.ts`: pure assignment and task-label formatting helpers.
- Create `tests/cloud-worker-task-display.test.ts`: behavioral unit tests for assignment and label formatting.
- Modify `src/components/AdminCloudFetchLog.tsx`: filter the queue, exclude unassigned lane entries, and update section copy.
- Modify `src/app/globals.css`: allow readable task labels to wrap without horizontal overflow.
- Modify `tests/cloud-admin-page.test.ts`: integration-contract assertions for the monitor component.

### Task 1: Lock the presentation contract with failing unit tests

**Files:**
- Create: `tests/cloud-worker-task-display.test.ts`
- Test: `tests/cloud-worker-task-display.test.ts`

- [ ] **Step 1: Write assignment tests**

Add task factories and tests that import the not-yet-created helper:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCloudWorkerTaskLabel,
  hasWorkerAssignment,
  resolveWorkerAssignment,
  selectUnassignedWorkerTasks,
} from "@/lib/cloud-worker-task-display";
import type { CloudWorkerHostTask } from "@/lib/cloud-fetch-run-log";

function task(overrides: Partial<CloudWorkerHostTask>): CloudWorkerHostTask {
  return {
    id: "fetch_post:source:BLOG_POST:provider%3Aowner%2Frepo",
    status: "planned",
    phase: null,
    message: null,
    reason: null,
    builder: "Source",
    builderId: "source",
    sourceType: "feed",
    title: null,
    url: null,
    workerId: null,
    bodyChars: null,
    bodyWords: null,
    headlineChars: null,
    headlineWords: null,
    summaryChars: null,
    summaryWords: null,
    updatedAt: null,
    ...overrides,
  };
}

test("worker assignment requires a non-blank worker id", () => {
  assert.equal(hasWorkerAssignment(null), false);
  assert.equal(hasWorkerAssignment("   "), false);
  assert.equal(hasWorkerAssignment("worker-3"), true);
});

test("worker assignment resolves the first usable worker id", () => {
  assert.equal(resolveWorkerAssignment("   ", " worker-3 "), "worker-3");
  assert.equal(resolveWorkerAssignment(null, ""), null);
});

test("queue selection returns only unassigned tasks", () => {
  const waiting = task({ id: "waiting" });
  const assigned = task({ id: "assigned", workerId: "worker-1" });
  assert.deepEqual(selectUnassignedWorkerTasks([waiting, assigned]), [waiting]);
});
```

- [ ] **Step 2: Write label-formatting tests**

Cover the complete precedence and fallback contract:

```ts
test("existing task titles take precedence", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(task({ title: "Original title", url: "https://example.com/post" })),
    "Original title",
  );
});

test("URLs become readable host and path labels", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(task({ url: "https://www.example.com/posts/one/?ref=queue#top" })),
    "example.com/posts/one",
  );
});

test("GitHub Trending task ids become repository labels", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(task({
      id: "fetch_post:source:BLOG_POST:github-trending%3Avorukot%2Fsuperfile",
    })),
    "vorukot/superfile",
  );
});

test("tweet and podcast ids use compact content labels", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(task({
      id: "fetch_post:source:TWEET:2081732293161582930",
    })),
    "Tweet 20817322…582930",
  );
  assert.equal(
    formatCloudWorkerTaskLabel(task({
      id: "fetch_post:source:PODCAST_EPISODE:ffdR5fZTC5E",
    })),
    "Episode ffdR5fZTC5E",
  );
});

test("malformed ids render a safe fallback", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(task({ id: "fetch_post:source:BLOG_POST:%E0%A4%A" })),
    "%E0%A4%A",
  );
  assert.equal(formatCloudWorkerTaskLabel(task({ id: "not-a-fetch-task" })), "Untitled post task");
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts
```

Expected: FAIL because `@/lib/cloud-worker-task-display` does not exist.

### Task 2: Implement the pure assignment and label helpers

**Files:**
- Create: `src/lib/cloud-worker-task-display.ts`
- Test: `tests/cloud-worker-task-display.test.ts`

- [ ] **Step 1: Implement assignment helpers**

Implement:

```ts
import type { CloudWorkerHostTask } from "@/lib/cloud-fetch-run-log";

export function hasWorkerAssignment(workerId: string | null | undefined): boolean {
  return resolveWorkerAssignment(workerId) !== null;
}

export function resolveWorkerAssignment(
  ...workerIds: Array<string | null | undefined>
): string | null {
  for (const workerId of workerIds) {
    const normalized = workerId?.trim();
    if (normalized) return normalized;
  }
  return null;
}

export function selectUnassignedWorkerTasks(
  tasks: CloudWorkerHostTask[],
): CloudWorkerHostTask[] {
  return tasks.filter((task) => !hasWorkerAssignment(task.workerId));
}
```

- [ ] **Step 2: Implement safe deterministic label formatting**

Add private helpers:

- `safeDecode`: returns the original string when `decodeURIComponent` throws.
- `shortenMiddle`: leaves values at or below the threshold intact; otherwise returns first 8 characters, `…`, and last 6 characters.
- `formatUrlLabel`: accepts only parseable `http:` or `https:` URLs, removes `www.`, query, hash, and trailing slash, safely decodes the pathname, then shortens values longer than 64 characters.
- `formatCompoundTaskId`: matches `^fetch_post:([^:]+):([^:]+):(.+)$`, safely decodes the external ID, and applies the content-specific rules from the spec.

Export:

```ts
export function formatCloudWorkerTaskLabel(task: CloudWorkerHostTask): string {
  const title = task.title?.trim();
  if (title) return title;
  const urlLabel = formatUrlLabel(task.url);
  if (urlLabel) return urlLabel;
  return formatCompoundTaskId(task.id) ?? "Untitled post task";
}
```

For `BLOG_POST`, strip `github-trending:` before the 64-character shortening rule. For `TWEET` and `PODCAST_EPISODE`, prefix the 18-character shortened identity with `Tweet` or `Episode`. Unknown content types convert underscores to spaces, lowercase the result, capitalize its first character, and append the shortened identity.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts
```

Expected: all tests pass with zero warnings.

- [ ] **Step 4: Run focused lint and typecheck**

Run:

```bash
npx eslint src/lib/cloud-worker-task-display.ts tests/cloud-worker-task-display.test.ts
npx tsc --noEmit
```

Expected: both commands exit 0.

### Task 3: Make Queue and Worker lanes mutually exclusive

**Files:**
- Modify: `src/components/AdminCloudFetchLog.tsx`
- Modify: `tests/cloud-admin-page.test.ts`
- Test: `tests/cloud-admin-page.test.ts`

- [ ] **Step 1: Add failing component-contract assertions**

Extend the existing `cloud fetch log component reads the admin runs endpoint` test to require:

```ts
assert.match(log, /selectUnassignedWorkerTasks/);
assert.match(log, /formatCloudWorkerTaskLabel/);
assert.match(log, /resolveWorkerAssignment/);
assert.match(log, /Waiting for assignment/);
assert.match(log, /\{tasks\.length\} waiting/);
assert.match(log, /No tasks waiting for assignment\./);
assert.match(
  log,
  /Each lane is one local worker slot\. Assigned tasks appear here when a worker claims them\./,
);
assert.doesNotMatch(log, /No local worker assignment/);
```

- [ ] **Step 2: Run the component-contract test and verify RED**

Run:

```bash
npx tsx --test tests/cloud-admin-page.test.ts
```

Expected: FAIL because the component still contains the old copy and synthetic lane fallback.

- [ ] **Step 3: Filter and relabel the queue**

In `AdminCloudFetchLog.tsx`:

- Import `formatCloudWorkerTaskLabel`, `resolveWorkerAssignment`, and `selectUnassignedWorkerTasks`.
- Remove the local `taskLabel`.
- Change the `WorkerHostPanel` task memo to:

```ts
const tasks = useMemo(
  () => sortedWorkerTasks(selectUnassignedWorkerTasks(workerHost.tasks)).slice(0, 20),
  [workerHost.tasks],
);
```

- Replace `Post task queue` with `Waiting for assignment`.
- Replace `<span>{tasks.length} recent</span>` with `<span>{tasks.length} waiting</span>`.
- Replace the normal empty state with `No tasks waiting for assignment.` while retaining the existing no-heartbeat diagnostic when applicable.
- Render `formatCloudWorkerTaskLabel(task)` as the row title.

- [ ] **Step 4: Exclude unassigned entries from lane groups**

In `buildWorkerShardGroups`, resolve the first usable worker ID and skip the
entry only when both persisted and live values are blank:

```ts
const workerId = resolveWorkerAssignment(
  entry.task.workerId,
  entry.liveTask?.workerId,
);
if (!workerId) continue;
const list = groups.get(workerId) ?? [];
list.push(entry);
groups.set(workerId, list);
```

Replace the lane explanatory copy with:

```text
Each lane is one local worker slot. Assigned tasks appear here when a worker claims them.
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-worker-task-display.test.ts tests/cloud-admin-page.test.ts
```

Expected: all tests pass.

### Task 4: Preserve readable wrapping and visual hierarchy

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/cloud-admin-page.test.ts`

- [ ] **Step 1: Add a failing style-contract assertion**

Add a test requiring `.cloud-worker-task-title` to use:

```css
overflow-wrap: anywhere;
white-space: normal;
```

and forbidding `text-overflow: ellipsis` in that rule.

- [ ] **Step 2: Run the style-contract test and verify RED**

Run:

```bash
npx tsx --test tests/cloud-admin-page.test.ts
```

Expected: FAIL because the current title rule forces one-line ellipsis.

- [ ] **Step 3: Update the existing title rule**

Change only `.cloud-worker-task-title`:

```css
.cloud-worker-task-title {
  color: var(--ink);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
  white-space: normal;
}
```

Do not add new colors, cards, animation, or dependencies.

- [ ] **Step 4: Run the style-contract test and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-admin-page.test.ts
```

Expected: all tests pass.

### Task 5: Full verification and visual QA

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: exit 0 with no errors.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: Next.js production build exits 0.

- [ ] **Step 5: Inspect the Cloud fetch monitor in a browser**

Open the existing local app, navigate to `/settings/cloud-library`, and verify:

- Queue contains only tasks without worker IDs.
- No raw `fetch_post:<source id>:...` value is used as a queue title.
- Queue labels wrap without horizontal overflow.
- Worker lanes contains only real worker IDs.
- No `No local worker assignment` lane appears.
- Expanding a lane still renders its task details.
- Light and dark modes retain readable contrast.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git diff --check
git diff -- src/lib/cloud-worker-task-display.ts tests/cloud-worker-task-display.test.ts src/components/AdminCloudFetchLog.tsx src/app/globals.css tests/cloud-admin-page.test.ts
```

Expected: no whitespace errors and no unrelated changes.

## Risks

- Older heartbeat records may omit `workerId`; they intentionally remain in Queue until a real assignment is reported.
- Some external IDs are opaque. The deterministic content-type label is still preferable to exposing the complete internal compound ID.
- URL formatting is presentation-only and must never be reused as a task identity or deduplication key.
