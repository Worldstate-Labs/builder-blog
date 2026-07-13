# Workspace Live Data Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all workspace data, schedule controls, and Fetch/AI Brief/cloud logs synchronized with background server changes without manual browser refresh.

**Architecture:** Retain `WorkspaceAutoRefresh` as the single route-refresh coordinator. Expand its server fingerprint, add a shared local-to-global refresh request event, and let focused log panels poll at a consistent 5-second running / 15-second idle cadence. Add a reusable user cloud-log data loader and authenticated endpoint so the FollowBrief fetch log is live rather than server-snapshot-only.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Node test runner.

---

### Task 1: Lock the live-refresh contract with failing tests

**Files:**
- Create: `tests/workspace-live-refresh.test.ts`
- Modify: `tests/performance-ux.test.ts`
- Modify: `tests/cloud-source-ui.test.ts`
- Modify: `tests/cloud-admin-page.test.ts`

- [ ] Add assertions for immediate workspace heartbeat, 15-second visible polling, hidden-tab pause, shared refresh-request event, and request coalescing.
- [ ] Add assertions that the fingerprint covers agent jobs/events, cloud submissions/tasks/runs, read/favorite/recommendation state, channel/visibility state, shared library/pipeline membership, and admin-only candidate/config/cloud state.
- [ ] Add assertions for the authenticated no-store FollowBrief fetch-log endpoint and shared data loader.
- [ ] Add assertions for 5-second running and 15-second idle cadence in Agent fetch, AI Brief, user FollowBrief fetch, admin cloud fetch, and admin cloud library panels.
- [ ] Add assertions that local log snapshot changes request a workspace refresh.
- [ ] Run `npx tsx --test tests/workspace-live-refresh.test.ts tests/performance-ux.test.ts tests/cloud-source-ui.test.ts tests/cloud-admin-page.test.ts` and confirm the new assertions fail for missing behavior.

### Task 2: Add reliable monotonic timestamps for in-place mutations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/000088_workspace_live_refresh_versions/migration.sql`
- Test: `tests/workspace-live-refresh.test.ts`

- [ ] Add `updatedAt @updatedAt` to `FeedItem`, `FeedRead`, `FeedFavorite`, `UserLibraryVisibility`, `CloudFetchRun`, and `CloudFetchRunTask`.
- [ ] Add indexes supporting user/builder-scoped max-`updatedAt` fingerprint queries.
- [ ] Write a forward migration that backfills current rows, removes temporary defaults, and creates the indexes.
- [ ] Run the focused schema contract test and `npx prisma generate`.

### Task 3: Expand the workspace freshness fingerprint

**Files:**
- Modify: `src/lib/builder-library-state.ts`
- Modify: `src/lib/content-sync-state.ts`
- Modify: `src/app/api/content-state/route.ts`
- Modify: `src/app/(workspace)/layout.tsx`
- Test: `tests/workspace-live-refresh.test.ts`
- Test: `tests/performance-ux.test.ts`

- [ ] Make `contentSyncState` accept admin context and include it in the short-lived cache key.
- [ ] Include `FeedItem.updatedAt` in builder-library state.
- [ ] Add user-scoped aggregates for agent job runs, cron events, cloud submissions/task progress, reads, favorites, recommendation snapshots, channel preferences, and library visibility.
- [ ] Fingerprint shared library/pipeline metadata and exact membership without including view counters.
- [ ] Run candidate/global config/cloud-admin aggregates only for admins.
- [ ] Pass consistent admin context from both the workspace layout and `/api/content-state`.
- [ ] Run focused tests and confirm the expanded contract passes.

### Task 4: Centralize browser refresh coordination

**Files:**
- Modify: `src/lib/content-sync-events.ts`
- Modify: `src/components/WorkspaceAutoRefresh.tsx`
- Test: `tests/workspace-live-refresh.test.ts`
- Test: `tests/performance-ux.test.ts`

- [ ] Add `workspaceRefreshRequested` and a `requestWorkspaceRefresh()` helper.
- [ ] Query immediately on mount, every 15 seconds while visible, and immediately on focus/visibility/pageshow.
- [ ] Handle local refresh requests through the same in-flight request path, forcing one route refresh even if the cached version has not advanced yet.
- [ ] Coalesce overlapping checks and carry a queued forced refresh through completion.
- [ ] Update the accepted version before dispatching `contentSyncStateChanged` and calling `router.refresh()`.
- [ ] Abort and clean up all listeners/timers on unmount.
- [ ] Run the focused coordinator tests.

### Task 5: Add a live FollowBrief fetch-log endpoint

**Files:**
- Create: `src/lib/user-cloud-fetch-log-data.ts`
- Create: `src/app/api/cloud-library/fetch-log/route.ts`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/components/SourceSyncLogTabs.tsx`
- Test: `tests/workspace-live-refresh.test.ts`
- Test: `tests/cloud-source-ui.test.ts`

- [ ] Move the current cloud-submission query out of the Sources page into `loadUserCloudFetchLog(userId)` and reuse the existing serializer.
- [ ] Serve the same payload from a session-authenticated, force-dynamic, browser-no-store GET route.
- [ ] Let `SourceSyncLogTabs` own and reconcile the latest cloud-log snapshot.
- [ ] Poll immediately and then every 5 seconds when a cloud source is running, otherwise every 15 seconds, only while the cloud tab is selected and visible.
- [ ] Request a workspace refresh when the cloud payload changes so Fetch/Stop controls update with the log.
- [ ] Preserve the last successful snapshot across transient failures.
- [ ] Run focused cloud-log tests.

### Task 6: Unify all log polling and bridge local changes to server controls

**Files:**
- Modify: `src/components/FetchLogPanel.tsx`
- Modify: `src/components/DigestLogPanel.tsx`
- Modify: `src/components/AdminCloudFetchLog.tsx`
- Modify: `src/components/AdminCloudLibraryLiveProvider.tsx`
- Test: `tests/workspace-live-refresh.test.ts`
- Test: `tests/cloud-admin-page.test.ts`
- Test: `tests/library-fetch-runs.test.ts`

- [ ] Normalize Agent fetch polling to 5 seconds during active work and 15 seconds while idle.
- [ ] Normalize AI Brief polling to the same cadence and keep immediate/focus refresh.
- [ ] Track the latest endpoint payload signature in each panel and call `requestWorkspaceRefresh()` only after a real change.
- [ ] Normalize admin cloud fetch and admin cloud library source polling to the same cadence.
- [ ] Keep each panel's immediate local state update and existing error behavior.
- [ ] Run focused log and cloud-admin tests.

### Task 7: Reconcile client-owned feed state after workspace changes

**Files:**
- Modify: `src/components/FollowingRecommendationSection.tsx`
- Modify: `src/components/FavoritePostsList.tsx`
- Modify: `src/components/BuilderLibraryActions.tsx`
- Modify: `src/components/BuilderDetailActions.tsx`
- Modify: `src/components/PostFavoriteControl.tsx`
- Modify: `src/components/LibraryVisibilityToggle.tsx`
- Modify: `src/components/DigestPipelineVisibilityToggle.tsx`
- Modify: `src/components/ChannelPreferenceToggle.tsx`
- Test: `tests/workspace-live-refresh.test.ts`
- Test: `tests/performance-ux.test.ts`
- Test: `tests/user-journeys.test.ts`

- [ ] Reload Following timeline on `contentSyncStateChanged` without losing its selected sort mode.
- [ ] Reconcile server-provided favorite, follow, visibility, and channel state when no local mutation is pending.
- [ ] Do not overwrite editor drafts or active optimistic operations.
- [ ] Run focused feed and user-journey tests.

### Task 8: Verify and publish

**Files:**
- All files touched above.

- [ ] Run targeted tests for workspace refresh, performance/UX, cloud source UI, cloud admin, fetch logs, and user journeys.
- [ ] Run targeted ESLint on every changed TypeScript/TSX file.
- [ ] Run `npx tsc --noEmit --pretty false`.
- [ ] Run `git diff --check` on the exact publish scope.
- [ ] Run `npm run build`.
- [ ] Review the final diff for unrelated files and migration safety.
- [ ] Commit with Lore trailers, push `main`, and verify local/remote commit parity.
