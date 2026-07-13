# Workspace Live Data Refresh Design

## Goal

Keep every visible FollowBrief workspace surface synchronized with server and background-agent changes without requiring a manual browser refresh.

## Problem

The workspace already polls a compact content fingerprint and some log panels poll their own endpoints. The mechanisms are incomplete and disconnected:

- the workspace fingerprint omits cloud fetch state, interaction state, recommendations, source candidates, and in-place shared-library metadata changes;
- local Fetch and AI Brief logs update their own state but do not refresh sibling server-rendered controls such as schedule frequency and Stop buttons;
- the user-facing FollowBrief fetch log has no live query path;
- polling intervals range from 3 seconds to 60 seconds and duplicate focus/visibility handling;
- `router.refresh()` preserves client state, so components derived from initial server props can remain stale unless they explicitly reconcile new props.

## Chosen Approach

Extend the existing workspace heartbeat instead of introducing WebSockets/SSE or independent page-level polling. `WorkspaceAutoRefresh` remains the only page-level refresh coordinator. Log panels retain focused polling because they need faster progress updates, but they report detected changes back to the coordinator through a shared browser event.

This approach fits the current Next.js App Router architecture, works in serverless deployment, preserves scroll and unaffected client state, and avoids adding a new transport or dependency.

## Refresh Contract

### Workspace coordinator

- Query immediately after mount.
- Query immediately on `visibilitychange`, `focus`, and `pageshow` when visible.
- Query every 15 seconds while visible.
- Do not query while hidden.
- Compare a server-issued version and call `router.refresh()` only when it changes.
- Coalesce simultaneous heartbeat and log-originated refresh requests.
- Dispatch `contentSyncStateChanged` after accepting a newer version so live children can reconcile.

### Log panels

- Running work: poll every 5 seconds.
- Idle work: poll every 15 seconds.
- Query immediately on mount and when the page regains focus.
- Pause while hidden.
- Update log-local state immediately.
- When the fetched snapshot changes, dispatch a shared workspace refresh request. The coordinator refreshes server-rendered siblings and updates its version baseline.

The covered panels are:

- Agent fetch log;
- AI Brief log;
- user-facing FollowBrief fetch log;
- admin cloud fetch log;
- admin cloud library source status.

## Freshness Fingerprint

The fingerprint must cover mutable state that is rendered anywhere under the workspace layout.

### User-scoped state

- builder pool, builders, subscriptions, feed items;
- local fetch runs, AI Brief runs, agent job runs, schedule rows and schedule events;
- AI Briefs and imported/shared pipeline membership;
- cloud source submissions and their source-task/run progress;
- read and favorite state;
- recommendation snapshots;
- feed preferences, channel preferences, library visibility;
- agent tokens and per-user prompt/config rows.

### Shared state

- source-library and AI Brief-library metadata and membership;
- source candidates and backup candidates for admin surfaces;
- global source/AI Brief configuration for admin surfaces;
- cloud worker configuration and language-library state for admin surfaces.

Prefer counts plus monotonic `updatedAt` values. Add `updatedAt` to mutable models that currently cannot expose a reliable in-place change signal. Do not include view counters because they do not change visible workspace content and would cause refresh loops.

## FollowBrief Fetch Log

Add an authenticated, no-store endpoint returning the same `UserCloudFetchLogData` shape used for server rendering. `SourceSyncLogTabs` owns a live `cloudLog` snapshot, polls only while the cloud tab is mounted/visible, and reconciles new server props after a route refresh. A changed cloud snapshot requests a workspace refresh so the shared Fetch/Stop controls and source counts update together.

## Client-State Reconciliation

Only reconcile components whose displayed state is a direct projection of server data. Preserve unsaved editor drafts and in-flight optimistic mutations. Log state remains authoritative from its live endpoint; server-prop reconciliation is a fallback after route refresh.

## Failure Handling

- Keep the last successful data visible after a transient request failure.
- Retry on the next scheduled or focus check.
- Existing log-local error messages remain available for persistent endpoint failures.
- Do not add a global spinner, toast, or Refresh button.
- Abort in-flight checks during unmount and avoid overlapping requests.

## Performance

- The global endpoint remains cached per user for a short server-side TTL and returns `Cache-Control: no-store` to the browser.
- Admin-only aggregates run only for admin sessions.
- Cloud task aggregates are limited to builders submitted by the current user.
- Route refreshes are version-gated and coalesced.
- Hidden tabs perform no polling.

## Accessibility And UX

Refreshes are silent and preserve scroll, disclosures, selected tabs, and focused controls. No decorative motion is introduced. Status text and controls change in place through normal React updates, with existing status semantics retained.

## Verification

- Contract tests pin every mutable data group in the fingerprint.
- Component tests pin immediate/focus/visibility behavior, 5/15 second cadence, coalescing, and the local-to-global refresh event.
- User-journey tests pin schedule/Stop control synchronization and live cloud log updates.
- Existing fetch, AI Brief, cloud admin, performance, and workspace journey suites must pass.
- Run targeted ESLint, TypeScript, `git diff --check`, and a production build.
