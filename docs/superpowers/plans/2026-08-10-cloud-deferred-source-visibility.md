# Cloud Deferred Source Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every outstanding cloud source before lease, with the scheduler gate that explains why it is not yet in deliveries or worker lanes.

**Architecture:** Add a focused diagnostic module that reads the same queue, budget, estimate, canonical-activity, and active-demand data used by the scheduler, then returns a serializable snapshot. Load that snapshot in the existing admin page and live runs endpoint, and render it in the worker monitor before post-task assignment. Keep diagnostics derived and read-only; do not change scheduler behavior or database schema.

**Tech Stack:** TypeScript, Prisma 7, Next.js 16 App Router, React 19, Node test runner via `tsx --test`.

---

## File structure

- Create `src/lib/cloud-fetch-pending-sources.ts`: pending-source types, pure classification, and Prisma-backed snapshot loader.
- Create `tests/cloud-fetch-pending-sources.test.ts`: pure regression tests for budget and scheduling-reason classification.
- Modify `src/lib/cloud-source-scheduler.ts`: expose the existing token estimate and lease-budget calculations for diagnostic reuse.
- Modify `src/app/(workspace)/settings/cloud-library/page.tsx`: load and pass the initial diagnostic snapshot.
- Modify `src/app/api/admin/cloud-fetch/runs/route.ts`: return fresh pending-source diagnostics on non-paginated live polls.
- Modify `src/components/AdminCloudFetchLog.tsx`: keep pending-source state in the existing live refresh cycle and render the source-level queue.
- Modify `src/lib/i18n-phrases.ts`: register new operator-facing labels and explanations.
- Modify `tests/cloud-admin-page.test.ts` and `tests/cloud-source-api.test.ts`: lock page, endpoint, and component wiring.

### Task 1: Shared scheduler diagnostics

**Files:**
- Create: `tests/cloud-fetch-pending-sources.test.ts`
- Create: `src/lib/cloud-fetch-pending-sources.ts`
- Modify: `src/lib/cloud-source-scheduler.ts`

- [ ] **Step 1: Write failing pure classification tests**

Test a `buildPendingCloudFetchSnapshot` API with representative inputs:

```ts
const snapshot = buildPendingCloudFetchSnapshot({
  now,
  config: { ...DEFAULT_CLOUD_FETCH_CONFIG, tokenBudgetPerHour: 1_000_000 },
  tasks: [youtubeTask({ estimatedTokenCost: null, consecutiveDeferrals: 8 })],
  activeSubmissionCounts: new Map([["builder-youtube", 1]]),
  activeQueueItems: [],
  recentRunTasks: [{ startedAt: minuteAgo, usageTokens: 939_325 }],
  recentCanonicalRuns: [],
});

assert.equal(snapshot.sources[0]?.reason, "token_budget");
assert.equal(snapshot.sources[0]?.estimatedTokens, 120_000);
assert.equal(snapshot.budget.remainingTokens, 60_675);
```

Add separate assertions for `queued`, `circuit_breaker`, `retry_backoff`, `canonical_active`, `canonical_cooldown`, and `scheduler_capacity`, plus exclusion of normally scheduled future work, inactive demand, and a currently leased source.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/cloud-fetch-pending-sources.test.ts`

Expected: FAIL because `@/lib/cloud-fetch-pending-sources` and its exported builder do not exist.

- [ ] **Step 3: Expose shared pure scheduler helpers**

In `src/lib/cloud-source-scheduler.ts`:

- export a pure `estimateCloudFetchTaskTokens({ estimatedTokenCost, sourceType })` wrapper around the existing source-type priors;
- export a pure `calculateCloudFetchLeaseBudget({ tokenBudgetPerHour, recentUsageTokens, activeEstimatedTokens, requestedLimit })` helper;
- make `computeLeaseBudget` call the new helper so diagnostics and leasing cannot drift.

Keep output equivalent to the current `{ limit, tokenBudget, tokenBudgetPerHour, recentUsageTokens, activeEstimatedTokens }` contract.

- [ ] **Step 4: Implement the pure pending-source snapshot builder**

Create serializable types:

```ts
export type CloudPendingSourceReason =
  | "queued"
  | "circuit_breaker"
  | "retry_backoff"
  | "canonical_active"
  | "canonical_cooldown"
  | "token_budget"
  | "scheduler_capacity";

export type CloudPendingSourceSnapshot = {
  budget: {
    tokenBudgetPerHour: number;
    recentUsageTokens: number;
    activeEstimatedTokens: number;
    remainingTokens: number;
  };
  sources: CloudPendingSource[];
};
```

Use `createCanonicalActivityPolicy`, `estimateCloudTaskRuntime`, and the new shared helpers. Include queued work; exclude active leases, inactive demand, and ordinary successful work scheduled for the future. Sort rows by reason priority, descending deferrals, last deferred time, and source name for stable rendering.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npx tsx --test tests/cloud-fetch-pending-sources.test.ts`

Expected: PASS with all classification cases.

- [ ] **Step 6: Add and test the Prisma-backed loader**

Implement `getPendingCloudFetchSources({ prisma, now })` to load:

- global config with `serializeCloudFetchConfig` defaults;
- active tasks in enabled language libraries with builder identity and estimate history;
- active submission counts;
- queued and unexpired leased queue items;
- rolling-hour task usage;
- canonical cooldown run activity.

Map the database rows into the already-tested pure builder. Add a source contract test that asserts the loader applies `status: ACTIVE`, enabled-library, active-demand, queue-status, rolling-hour, and canonical-cooldown filters.

- [ ] **Step 7: Run scheduler and pending-source tests**

Run: `npx tsx --test tests/cloud-fetch-pending-sources.test.ts tests/cloud-source-scheduler.test.ts`

Expected: PASS; existing lease behavior remains unchanged.

### Task 2: Live admin endpoint and page wiring

**Files:**
- Modify: `tests/cloud-source-api.test.ts`
- Modify: `tests/cloud-admin-page.test.ts`
- Modify: `src/app/api/admin/cloud-fetch/runs/route.ts`
- Modify: `src/app/(workspace)/settings/cloud-library/page.tsx`

- [ ] **Step 1: Write failing route and page contract tests**

Require:

- `getPendingCloudFetchSources` in the fresh `/api/admin/cloud-fetch/runs` response;
- `pendingSources: null` for paginated history so older loads cannot overwrite live diagnostics;
- isolated diagnostic failure handling: a fresh poll still returns `200` with normal worker/delivery data and `pendingSources: null`;
- `initialPendingSources` loaded by the server page and passed to `AdminCloudFetchLog`.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `npx tsx --test tests/cloud-source-api.test.ts tests/cloud-admin-page.test.ts`

Expected: FAIL on the missing imports, response field, and prop.

- [ ] **Step 3: Wire the loader into the initial page**

Add `getPendingCloudFetchSources()` to the existing `Promise.all` in the cloud-library admin page and pass the result as `initialPendingSources`.

- [ ] **Step 4: Wire the loader into fresh live polls**

In the runs route, load pending diagnostics only when `before` is absent. Isolate that loader in its own `try/catch`: diagnostic failure must not fail the worker/delivery endpoint and must return `pendingSources: null`. Return `null` for paginated history and preserve `Cache-Control: no-store`.

- [ ] **Step 5: Run the contract tests and verify GREEN**

Run: `npx tsx --test tests/cloud-source-api.test.ts tests/cloud-admin-page.test.ts`

Expected: PASS.

### Task 3: Render and live-refresh pending source rows

**Files:**
- Modify: `tests/cloud-admin-page.test.ts`
- Modify: `src/components/AdminCloudFetchLog.tsx`
- Modify: `src/lib/i18n-phrases.ts`

- [ ] **Step 1: Add failing monitor presentation assertions**

Require the component source to contain:

- `Waiting for source lease` and `{pendingSources.sources.length} waiting`;
- `No sources waiting for lease.`;
- reason-specific copy for all seven reasons;
- estimated/remaining token formatting;
- deferral count, last deferred time, and retry/circuit next attempt time;
- pending diagnostics in `liveDataSignature`, state refs, and fresh response handling.

- [ ] **Step 2: Run the admin component test and verify RED**

Run: `npx tsx --test tests/cloud-admin-page.test.ts`

Expected: FAIL because the component has no source-level waiting section or pending-source state.

- [ ] **Step 3: Add live state without changing pagination semantics**

Extend `CloudFetchRunsResponse`, `AdminCloudFetchLog` props/state/refs, and refresh signature with `CloudPendingSourceSnapshot`. Update it only when a fresh response contains a non-null snapshot; paginated history and an isolated diagnostic failure (`pendingSources: null`) must retain the current value.

- [ ] **Step 4: Render the source-level waiting section**

Pass the snapshot into `WorkerHostPanel` and render it before `Waiting for assignment`, reusing `cloud-worker-task-section`, `cloud-worker-task-list`, and `cloud-worker-task-row` styles. Show source name, source type, reason label, estimated versus remaining tokens, deferral metadata, and applicable relative timestamps.

- [ ] **Step 5: Register translation phrases**

Add every new exact UI sentence to `src/lib/i18n-phrases.ts`, following the existing multilingual phrase-map pattern.

- [ ] **Step 6: Run the admin test and verify GREEN**

Run: `npx tsx --test tests/cloud-admin-page.test.ts`

Expected: PASS.

### Task 4: Verification and handoff

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run targeted cloud tests**

Run: `npx tsx --test tests/cloud-fetch-pending-sources.test.ts tests/cloud-source-scheduler.test.ts tests/cloud-source-api.test.ts tests/cloud-admin-page.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 3: Run static checks**

Run: `npm run lint`

Run: `npx tsc --noEmit`

Expected: both exit 0.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: exit 0, including prompt runtime trace verification.

- [ ] **Step 5: Inspect the diff and commit implementation**

Run: `git diff --check && git status --short && git diff --stat HEAD`

Commit with a Lore-format message that records the live-derived diagnostic constraint, the rejected schema migration, and exact tests run.
