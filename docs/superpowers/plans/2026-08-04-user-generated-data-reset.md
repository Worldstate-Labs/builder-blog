# User-Scoped Generated Data Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every authenticated user clear only their own generated fetch and AI Brief data while preserving other users, shared Cloud state, sources, schedules, reads, and favorites.

**Architecture:** Replace the global admin reset with an account endpoint backed by a user-scoped transactional helper. Reuse the existing `ResetFence` table with `user:<userId>` keys for personal jobs while retaining `global` for Cloud work. Enforce ownership both in destructive query predicates and with a cross-user reference guard before personal posts are deleted.

**Tech Stack:** Next.js App Router route handlers, React client components, TypeScript, Prisma/PostgreSQL row locks, Node test runner through `tsx --test`, ESLint.

---

## Task 1: Add user-scoped reset fence primitives

**Files:**
- Modify: `src/lib/reset-fence.ts`
- Modify: `tests/reset-fence.test.ts`

- [ ] Add failing tests for `userResetFenceId(userId)`, lazy initialization of a personal fence, personal fence isolation, compatibility of the default global fence, and the generic stale-worker message.
- [ ] Run `npx tsx --test tests/reset-fence.test.ts` and confirm the new assertions fail because personal scopes are not supported yet.
- [ ] Extend the fence API with an optional scope/fence ID while keeping existing Cloud callers on the `global` default. Upsert only non-global fence rows with an epoch timestamp before acquiring `FOR SHARE` or `FOR UPDATE` locks.
- [ ] Ensure `lockResetFenceForWorker`, `lockResetFenceForNewWorker`, and `lockResetFenceForReset` accept the selected fence without changing lock ordering.
- [ ] Change `StaleWorkerWriteError` wording from “latest global reset” to “latest reset”.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit with a Lore message recording that global compatibility is intentional.

## Task 2: Fence every personal fetch and Brief write by authenticated user

**Files:**
- Modify: `src/app/api/skill/job-runs/route.ts`
- Modify: `src/app/api/skill/fetch-runs/route.ts`
- Modify: `src/app/api/skill/fetch-runs/[id]/route.ts`
- Modify: `src/app/api/skill/builders/route.ts`
- Modify: `src/app/api/skill/context/route.ts`
- Modify: `src/app/api/skill/digests/route.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `tests/reset-fence.test.ts`
- Modify: `tests/compliance-contract.test.ts`

- [ ] Add failing contract/behavior assertions that `library-fetch` and `digest-build` paths pass `userResetFenceId(session.user.id)` to every fence lock.
- [ ] Add a failing assertion that `cloud-library-fetch` job creation/update continues to select `GLOBAL_RESET_FENCE_ID` and Cloud scheduler/plan/lease/sync call sites retain their global behavior.
- [ ] Run `npx tsx --test tests/agent-job-runs.test.ts tests/reset-fence.test.ts tests/compliance-contract.test.ts` and observe the expected scope failures.
- [ ] Thread the authenticated user fence through all personal job-run, fetch-run, builder sync, digest context, and digest sync transactions.
- [ ] In the generic job-run route, derive the scope from the validated job type: global for `cloud-library-fetch`, user-scoped for the two personal types.
- [ ] Re-run the focused tests and confirm personal and Cloud scope assertions pass.
- [ ] Commit with a Lore message noting that Cloud work deliberately remains globally fenced.

## Task 3: Replace the global helper with an atomic user-owned reset

**Files:**
- Modify: `src/lib/fetch-digest-reset.ts`
- Add: `tests/user-generated-data-reset.test.ts`
- Modify: `tests/reset-fence.test.ts`

- [ ] Build a fake Prisma transaction client in the new test and add failing tests that require `resetUserFetchDigestState(userId, client)` to scope every mutation by `userId` or a non-Cloud `builder.ownerUserId` (`cloudSourceTask: null`).
- [ ] Add failing tests that current-user recommendation snapshots are deleted, Agent jobs are limited to `library-fetch`/`digest-build`, and no Cloud model client is read or mutated.
- [ ] Add failing negative assertions that preserved current-user models are never deleted or updated: `LibraryCronJob`, `DigestCronJob`, `AgentToken`, `Subscription`, `FeedRead`, `FeedFavorite`, `LibraryImport`, `DigestPipelineImport`, `LibraryHubEntry`, `LibraryHubItem`, `DigestPipelineShare`, `UserFeedPreference`, `UserSourceTypeConfig`, `UserDigestConfig`, `UserChannelPreference`, and `UserLibraryVisibility`.
- [ ] Add failing tests for the cross-user ownership guard covering recommendation snapshot items, read provenance, and favorite provenance; any nonzero count must abort before destructive mutations commit.
- [ ] Add a two-user regression fixture/fake proving reset A leaves representative B rows and counts unchanged.
- [ ] Run `npx tsx --test tests/user-generated-data-reset.test.ts tests/reset-fence.test.ts` and confirm failure against the global helper.
- [ ] Implement `resetUserFetchDigestState(userId, client = prisma)` in one bounded transaction: acquire the exclusive personal fence, run all cross-user reference counts, delete only user-owned derived rows, reset only personal builders, and return only personal counts plus `lastResetAt`. Keep the preserved current-user model list above completely outside the mutation set.
- [ ] Remove the all-users helper/export and all Cloud-table operations from this module.
- [ ] Re-run the focused tests and confirm atomic ownership behavior passes.
- [ ] Commit with a Lore message documenting the ownership guard and preserved state.

## Task 4: Expose only an account-scoped reset API

**Files:**
- Add: `src/lib/account-generated-data-reset-route.ts`
- Add: `src/app/api/account/generated-data/reset/route.ts`
- Delete: `src/app/api/admin/maintenance/fetch-digest-reset/route.ts`
- Modify: `tests/user-generated-data-reset.test.ts`
- Modify: `tests/compliance-contract.test.ts`

- [ ] Before writing the route, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` completely, and keep unsupported exports out of `route.ts`.
- [ ] Add failing handler-factory tests for unauthenticated `401`, non-exact confirmation `400`, session-derived user targeting, caller-supplied `userId`/email/scope having no effect, successful personal summary, and generic `500` errors.
- [ ] Add a failing contract assertion that the old admin endpoint file no longer exists.
- [ ] Run `npx tsx --test tests/user-generated-data-reset.test.ts tests/compliance-contract.test.ts` and confirm the missing account route behavior fails.
- [ ] Implement the dependency-injectable handler factory in `src/lib` and a minimal `POST` route wrapper at `/api/account/generated-data/reset`.
- [ ] Derive the only target from `session.user.id`; accept no target selector from JSON; trim and require exact `RESET`.
- [ ] Delete the old admin route and return generic failure responses.
- [ ] Re-run the focused tests.
- [ ] Commit with a Lore message recording the session-only trust boundary.

## Task 5: Make the reset UI universal, personal, translated, and honest

**Files:**
- Add: `src/components/GeneratedDataResetPanel.tsx`
- Delete: `src/components/AdminMaintenancePanel.tsx`
- Modify: `src/app/(workspace)/settings/page.tsx`
- Modify: `src/lib/i18n-phrases.ts`
- Add: `src/lib/generated-data-reset-summary.ts`
- Modify: `tests/compliance-contract.test.ts`
- Modify: `tests/i18n-phrases.test.ts`
- Modify: `tests/user-generated-data-reset.test.ts`

- [ ] Add failing assertions that every authenticated Settings page renders `GeneratedDataResetPanel` without an admin conditional, that it posts to `/api/account/generated-data/reset`, and that old “Admin maintenance”/all-user wording is gone.
- [ ] Add failing tests for the pure personal summary formatter so it never exposes user or Cloud counts.
- [ ] Add failing i18n coverage for the approved heading, description, button, dialog title, and dialog body in all supported locale dictionaries.
- [ ] Run `npx tsx --test tests/user-generated-data-reset.test.ts tests/i18n-phrases.test.ts tests/compliance-contract.test.ts` and observe the expected UI/i18n failures.
- [ ] Implement `GeneratedDataResetPanel` using `useI18n` and `translateUiPhrase`, preserving typed `RESET`, loading/error states, modal dismissal, and `contentSyncStateChanged` after success.
- [ ] Render the panel for all authenticated users and remove obsolete admin-only imports/logic where no longer needed.
- [ ] Add all approved phrases to the existing `zh-CN`, `zh-TW`, `ja`, `ko`, and `es` translation maps.
- [ ] Re-run focused tests and verify the personal-only success copy.
- [ ] Commit with a Lore message describing the UI ownership boundary.

## Task 6: Remove the unsafe all-users maintenance script

**Files:**
- Delete: `scripts/clear-fetch-digest-state.mts`
- Add: `scripts/reset-user-fetch-digest-state.mts`
- Modify: `tests/user-generated-data-reset.test.ts`
- Modify: `tests/compliance-contract.test.ts`

- [ ] Add failing tests/source contracts requiring exactly one of `--user-id` or `--email`, rejecting missing, duplicate, ambiguous, and unknown targets before calling the reset helper.
- [ ] Add a failing assertion that no repository script imports or invokes the deleted global reset helper.
- [ ] Run `npx tsx --test tests/user-generated-data-reset.test.ts tests/compliance-contract.test.ts` and observe the expected failures.
- [ ] Implement explicit target parsing and single-user resolution, then call the same `resetUserFetchDigestState` helper.
- [ ] Print only the personal result and exit nonzero without mutation for invalid targets.
- [ ] Re-run focused tests.
- [ ] Commit with a Lore message recording that unattended all-user reset behavior is intentionally unavailable.

## Task 7: Full verification and review

**Files:**
- Review all files changed above.

- [ ] Run focused regressions: `npx tsx --test tests/user-generated-data-reset.test.ts tests/reset-fence.test.ts tests/agent-job-runs.test.ts tests/i18n-phrases.test.ts tests/compliance-contract.test.ts`.
- [ ] Run `npm run lint`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm test` and confirm the complete suite passes.
- [ ] Run `npm run build` and confirm the production App Router route compiles.
- [ ] Inspect `git diff --check`, `git status --short`, and the complete branch diff for accidental Cloud/global changes.
- [ ] Request an independent code review focused on ownership predicates, fence selection, cross-user cascades, route trust boundaries, and test adequacy; fix and re-run affected checks if any issue is found.
- [ ] Record any environment-only validation gap honestly; do not claim production database concurrency was exercised unless it was.
