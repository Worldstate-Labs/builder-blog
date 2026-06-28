# Cloud Source Submission: Overwrite-on-Resubmit Design

**Date:** 2026-06-27
**Branch / worktree:** `codex/cloud-source-fetch`
**Builds on:** `docs/superpowers/plans/2026-06-27-cloud-source-fetch.md` (cloud submit feature, already implemented)

## Problem

When a user submits their private source library to FollowBrief Cloud from the Fetch
sources dialog, the current flow (`submitUserPrivateLibraryToCloud`) is a silent,
additive upsert:

- It never tells the user a prior submission already exists.
- It only upserts submissions for the user's *current* private sources. Sources the
  user previously submitted but has since removed from their library keep their
  `CloudSourceSubmission.active = true` and their `CloudSourceTask` keeps running — the
  old request is never cancelled.

## Goal

Treat each user as having **exactly one active cloud submission** = `(frequency,
summaryLanguage, current private-source set)`. Re-submitting must:

1. **Detect** a prior active submission and tell the user.
2. **Replace** it: the new submission cancels everything the old one set up that is not
   part of the new submission, then the new submission takes effect.
3. **Confirm**: the dialog warns the user that submitting will overwrite, before they
   submit.

## Decisions (locked)

- **Overwrite granularity: one submission per user.** A user has one logical active
  submission. Re-submitting — even with a different summary language — cancels the
  previous submission entirely. Switching language deactivates the old-language
  submission.
- **Cleanup scope: reconcile source set + cancel queued fetches.** Deactivate
  submissions for sources no longer in the new set, pause their now-orphaned
  `CloudSourceTask`, and cancel their `QUEUED` (not yet leased) `CloudFetchQueueItem`
  rows. Leased / in-flight runs are left alone.
- **Confirm UX: notice on open + one-click submit.** When the dialog is in Cloud mode,
  query existing submission state on open and show a notice if one exists. The primary
  button reads "Overwrite & submit" when a prior submission exists and submits in one
  click.

## Core Semantics: Reconcile to a Single Submission

`submitUserPrivateLibraryToCloud({ userId, frequency, summaryLanguage })` becomes a
reconcile operation, wrapped in a single `prisma.$transaction`:

```
newSet = user's active PERSONAL_SYNC private sources
         copied to the NEW language owner -> list of cloudBuilderId

1. Load all of this user's active CloudSourceSubmission rows (across every language).
2. Upsert the new set: active = true, frequency = new frequency, summaryLanguage = new.
3. Deactivate (active = false) every prior active submission whose cloudBuilderId is
   NOT in newSet.
   - Different language -> different cloudBuilderId -> all old-language submissions
     deactivated.
   - Same language, source removed from library -> that submission deactivated.
4. For every deactivated submission's cloudBuilder, run recomputeCloudSourceTask:
   - If that cloudBuilder still has any user's active submission, the task stays ACTIVE.
   - If no active submission remains, the task transitions to PAUSED.
5. For tasks that just transitioned to PAUSED, cancel their QUEUED CloudFetchQueueItem
   rows (status -> CANCELLED). Leave LEASED / running items untouched.
6. Recompute tasks for the new set (existing behavior).
7. syncCloudLanguageLibraryHub(new language).
```

The transaction guarantees "cancel old + activate new" is atomic. After any submit, the
user's active submissions exist in exactly one language.

## Detection Query (for the UI)

New `GET /api/cloud-library/source-submissions`, session-authenticated, backed by a new
helper `getUserCloudSubmissionSummary({ userId })`:

```jsonc
{
  "hasActiveSubmission": true,
  "activeSourceCount": 12,
  "summaryLanguage": "zh",      // most recent active submission's language
  "frequency": "DAILY",          // effective: DAILY if any active row is DAILY, else WEEKLY
  "lastSubmittedAt": "2026-06-24T..."
}
```

`frequency` uses the existing `effectiveCloudFetchFrequency` precedence. `summaryLanguage`
and `lastSubmittedAt` come from the most recent active submission. When the user has no
active submission, `hasActiveSubmission` is `false` and the rest are null/0.

## UI Changes (`SkillPromptActions.tsx`)

- On dialog open while `isCloudMode` is true (and when the user switches Runtime type to
  Cloud), `GET` the summary once and store it in component state.
- If `hasActiveSubmission`, render a notice above the Cloud fields:
  > You already submitted 12 sources · Daily · Chinese · 3 days ago. Submitting again
  > overwrites your previous settings (switching language deactivates the old language).
- Primary button label: **Overwrite & submit** when a prior submission exists, otherwise
  **Submit**.
- Submission stays one click. On success, keep the existing result message + ~700ms close.

## Cancellation Helper (`cloud-source-scheduler.ts`)

New `cancelQueuedCloudFetchForTasks({ prisma, taskIds })`: sets `status = CANCELLED` for
`CloudFetchQueueItem` rows whose `cloudSourceTaskId` is in `taskIds` and whose status is
`QUEUED` (via `updateMany`). Called by the reconcile step inside the transaction. Lives
in the scheduler because the scheduler owns queue concerns.

## Error & Edge Handling

- Empty private library: keep current 400 — "Add at least one private source before
  submitting to Cloud."
- No prior submission: reconcile degrades to pure insert; nothing is deactivated.
- Shared cloud builders (multiple users submitted the same source): a task is paused and
  its queue cancelled only when no active submission remains, so one user's withdrawal
  never affects another user's fetch.
- GET failure in the UI: degrade silently — hide the notice, button falls back to
  "Submit", do not block submission.
- Rate limiting: keep the existing 60s POST limiter; GET is not rate limited.

## Files

- Modify `src/lib/cloud-source-library.ts` — reconcile logic in
  `submitUserPrivateLibraryToCloud`; add `getUserCloudSubmissionSummary`.
- Modify `src/lib/cloud-source-scheduler.ts` — add `cancelQueuedCloudFetchForTasks`.
- Modify `src/app/api/cloud-library/source-submissions/route.ts` — add `GET`.
- Modify `src/components/SkillPromptActions.tsx` — notice + button label + GET fetch.
- Tests:
  - `tests/cloud-source-library.test.ts` — reconcile branches: removed source
    deactivated; language switch deactivates old language; orphaned task paused; shared
    task stays active; queued items cancelled for paused tasks only; summary query.
  - `tests/cloud-source-api.test.ts` — GET summary shape; POST reconcile end to end.
  - `tests/cloud-source-ui.test.ts` — notice rendered when prior submission exists;
    button label switches to "Overwrite & submit".

## Testing & Verification

```bash
npx tsx --test \
  tests/cloud-source-library.test.ts \
  tests/cloud-source-api.test.ts \
  tests/cloud-source-ui.test.ts \
  tests/cloud-source-scheduler.test.ts
npm run build
```

Manual smoke:
1. Submit private library as Chinese / Daily. Confirm `CloudSourceSubmission` +
   `CloudSourceTask` rows under the Chinese cloud owner.
2. Re-open the dialog — notice shows the prior submission; button reads "Overwrite &
   submit".
3. Remove one private source, re-submit — its submission is `active = false`, its task is
   PAUSED (if no other user holds it), its QUEUED queue item is CANCELLED.
4. Re-submit as English — all Chinese submissions deactivate; English submissions become
   the only active set.
```
