# Admin Cloud Library Management Page Design

**Date:** 2026-06-28
**Branch / worktree:** `codex/cloud-source-fetch`
**Builds on:** the cloud-source-fetch feature (already on `main`) and the
overwrite-on-resubmit change.

## Problem

Admins can configure cloud fetch scheduling and language-library owners (the
`AdminCloudFetchConfigForm` panel in Settings), but they have no surface to:

1. Kick off the cloud polling fetch from their local agent.
2. See the history of each cloud polling round (what the runner fetched each
   time it leased a batch).
3. Inspect each cloud library's sources — their fetch status, who submitted
   them, and the posts already fetched.

## Goal

A dedicated, admin-only management page reached from Settings that bundles these
into one place. Built in two phases.

## Decisions (locked)

- **Form: dedicated route** at `/settings/cloud-library`, linked from the
  existing "Cloud source fetching" Settings panel. Non-admins are redirected.
- **Copy-prompt: both variants.** The page offers a "set up recurring polling"
  prompt and a "run once now" prompt for the admin's local agent.
- **Phasing.** Phase 1 = page shell + copy-prompt actions + cloud fetch-log
  history. Phase 2 = per-library source explorer (sources, posts, submitters).

## Reuse Map

| Need | Existing building block |
| --- | --- |
| Admin gating | `isAdminEmail(session.user.email)`; `requireCloudFetchAdmin(request)` |
| Settings entry pattern | `<details className="settings-rules-panel fb-panel">` in `settings/page.tsx` |
| Copy-prompt mechanism | `/api/settings/tokens/{id}/exchange-code` + `Read <origin>/api/skill/jobs/<job>/skill.md?ec=...`; job whitelist in `src/lib/skill-job-files.ts`; renderer `/api/skill/jobs/[job]/skill.md/route.ts` |
| Cloud polling runner | `builder-agent-runner.sh cloud-library-cron` (admin agent) |
| Fetch-log data | `CloudFetchRun` (one row per lease+run) + `CloudFetchRunTask` (per-source detail) |

## Phase 1: Page Shell + Copy-Prompt + Fetch Log

### Route & entry

- New `src/app/(workspace)/settings/cloud-library/page.tsx` → `/settings/cloud-library`.
  Server component; redirects non-admins (mirror the Settings `isAdmin` check).
- In `settings/page.tsx`, the "Cloud source fetching" admin panel gains a link
  button: "Open cloud library management →" to the new route.

### Section A — Run cloud fetch (copy-prompt actions)

New client component `AdminCloudFetchRunActions`:

- Picks the admin's agent token, exchanges it for a one-time code via
  `/api/settings/tokens/{tokenId}/exchange-code`, and copies
  `Read <origin>/api/skill/jobs/<job>/skill.md?ec=<code> and follow the instructions.`
- Two buttons:
  - "Set up recurring polling" → job `cloud-library-cron-setup` (agent installs a
    cron that runs `builder-agent-runner.sh cloud-library-cron` every N minutes).
  - "Run once now" → job `cloud-library-once` (lease a batch, fetch, stop).
- Brief inline note: run the readiness check
  (`scripts/check-cloud-source-fetch-readiness.mts --language <lang>`) before the
  first real run.

Backend wiring:

- Add `cloud-library-cron-setup` and `cloud-library-once` to
  `src/lib/skill-job-files.ts`.
- Author two setup skill `.md` templates (modeled on the existing
  `library-cron-setup` / `library-once`, but invoking the cloud runner job).
- Extend `/api/skill/jobs/[job]/skill.md/route.ts` so its cron-setup recognition
  (`isCronSetupJob`, `cronTimeoutJob`) and runtime/frequency substitution cover
  `cloud-library-cron-setup`.
- The exchange code resolves to the admin's agent token, so the agent
  authenticates as admin and the cloud lease/sync endpoints accept it via
  `requireCloudFetchAdmin`'s bearer path.

> This template-authoring + renderer extension is the heaviest, most error-prone
> part of Phase 1. Everything else is straight reuse.

### Section B — Cloud fetch log history

- New `GET /api/admin/cloud-fetch/runs?before=<cursor>` — `requireCloudFetchAdmin`,
  cursor paginated by `startedAt`. Returns each `CloudFetchRun`
  (startedAt, finishedAt, status, requestedLimit, tasksClaimed, tasksSucceeded,
  tasksFailed, usageTokens, usageCostUsd, summary, durationMs) plus its
  `CloudFetchRunTask` rows (builder/source name, summaryLanguage, status,
  plannedPosts, syncedPosts, failedPosts, actualDurationSeconds, failureReason).
- Serialization lives in `src/lib/cloud-fetch-run-log.ts` (pure, testable).
- New client component `AdminCloudFetchLog`: most-recent-first list, each run
  expandable to its per-source task rows; auto-refreshes (polling) while any run
  is `RUNNING`, idle otherwise. Simpler than the user-facing `FetchLogPanel`
  (different data shape — it is NOT reused).

## Phase 2: Cloud Library Source Explorer (outline)

- Section C — "Cloud libraries": for each `CloudLanguageLibrary`, list its
  sources (`CloudSourceTask` → cloud-owner `Builder`) with:
  - source name / type;
  - task status (ACTIVE / PAUSED / ERROR), last success, last failure, next
    attempt, effective frequency, circuit-breaker state;
  - submitter count + list (`CloudSourceSubmission` → users);
  - fetched-post count, drilling into the source's `FeedItem` posts.
- Backend: `GET /api/admin/cloud-fetch/libraries`, `/sources`,
  `/sources/[id]/posts`, `/sources/[id]/submitters` (all `requireCloudFetchAdmin`).

## Error & Edge Handling

- Non-admin reaching the page → redirect; non-admin hitting any new API →
  401/403 via `requireCloudFetchAdmin`.
- Empty states: no runs yet, no cloud language libraries configured.
- Copy-prompt: no active agent token → guide the admin to create one first
  (reuse the existing token-picker affordance).
- Fetch-log polling stops when no run is `RUNNING` and when the tab is hidden.

## Files

Phase 1:

- Create `src/app/(workspace)/settings/cloud-library/page.tsx`.
- Create `src/components/AdminCloudFetchRunActions.tsx`.
- Create `src/components/AdminCloudFetchLog.tsx`.
- Create `src/lib/cloud-fetch-run-log.ts`.
- Create `src/app/api/admin/cloud-fetch/runs/route.ts`.
- Create cloud setup skill templates (e.g. under `skills/builder-blog-digest/jobs/`).
- Modify `src/lib/skill-job-files.ts`.
- Modify `src/app/api/skill/jobs/[job]/skill.md/route.ts`.
- Modify `src/app/(workspace)/settings/page.tsx` (entry link).
- Tests: `tests/cloud-fetch-run-log.test.ts` (serializer/query),
  `tests/cloud-admin-page.test.ts` (route + page admin gating, copy-prompt job wiring).

## Testing & Verification

```bash
npx tsx --test tests/cloud-fetch-run-log.test.ts tests/cloud-admin-page.test.ts
npm run build
```

Manual smoke: as an admin, open Settings → Cloud library management; copy the
"run once" prompt, run it on a local agent, confirm a `CloudFetchRun` row appears
in the fetch log with its per-source tasks.
