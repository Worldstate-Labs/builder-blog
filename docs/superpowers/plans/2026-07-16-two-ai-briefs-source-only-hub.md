# Two AI Briefs and Source-Only Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-managed AI Brief collections with fixed `Your AI Brief` and `FollowBrief AI Brief` surfaces, while reducing Hub to source libraries only.

**Architecture:** Keep historical share/import records intact, but remove their user-facing mutation routes and stop using arbitrary records to build visible Brief options. Render the AI Brief tab as two direct cards and render Hub as one direct source-library surface.

**Tech Stack:** Next.js App Router, React Server Components, Prisma, TypeScript, Node test runner, CSS.

---

### Task 1: Lock the New Product Contract

**Files:**
- Modify: `tests/performance-ux.test.ts`
- Modify: `tests/library-hub-tabs.test.ts`
- Modify: `tests/sources-loading-ui.test.ts`
- Modify: `tests/dashboard-digest-control.test.ts`
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/compliance-contract.test.ts`
- Modify: `tests/i18n-phrases.test.ts`

- [ ] Update source-level assertions for fixed titles, two Briefs, no title editor/share/import controls, and a source-only Hub.
- [ ] Add assertions that Brief mutation routes are disabled and legal copy no longer advertises Brief sharing.
- [ ] Run each touched test and confirm it fails for the removed behavior.

### Task 2: Simplify the AI Brief Data Contract

**Files:**
- Modify: `src/lib/library-hub.ts`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/app/(workspace)/dashboard/page.tsx`
- Modify: `src/components/DigestPipelineSelectorView.tsx`

- [ ] Rename the canonical community Brief to `FollowBrief AI Brief`.
- [ ] Build the AI Brief page data from the current user and canonical FollowBrief owner only.
- [ ] Build dashboard selector options from those same two owners only.
- [ ] Run the targeted contract tests and confirm the data assertions pass.

### Task 3: Flatten the AI Brief Page

**Files:**
- Modify: `src/components/DigestPipelineImportForm.tsx`
- Modify: `src/components/OwnDigestPipelineUpdatesCard.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/app/globals.css`
- Delete: `src/components/DigestPipelineTitleEditor.tsx`
- Delete: `src/components/DigestPipelineVisibilityToggle.tsx`

- [ ] Replace the editable own title with a fixed heading.
- [ ] Add a read-only card path for the canonical FollowBrief Brief without import actions or import stats.
- [ ] Remove collection-level wrappers and obsolete responsive rules.
- [ ] Run the targeted UI tests and confirm they pass.

### Task 4: Reduce Hub and Close Brief Mutations

**Files:**
- Modify: `src/app/(workspace)/library-hub/page.tsx`
- Modify: `src/app/(workspace)/library-hub/loading.tsx`
- Modify: `src/app/api/digest-pipelines/share/route.ts`
- Modify: `src/app/api/digest-pipelines/imports/route.ts`
- Modify: `src/app/api/digest-pipelines/imports/[pipelineId]/route.ts`

- [ ] Render the source-library section directly without a tab shell or Brief loader.
- [ ] Return `404` from obsolete Brief mutation endpoints.
- [ ] Run route and Hub tests and confirm they pass.

### Task 5: Align Copy, Legal Text, and Verification

**Files:**
- Modify: `src/lib/i18n.ts`
- Modify: `src/lib/i18n-phrases.ts`
- Modify: `src/lib/legal-pages.ts`
- Modify: `src/app/(workspace)/not-found.tsx`
- Modify: `src/lib/feed-favorites.ts`
- Modify: `tests/i18n-phrases.test.ts`
- Modify: `tests/compliance-contract.test.ts`
- Modify: `tests/performance-ux.test.ts`
- Modify: `tests/recommendation-snapshots.test.ts`

- [ ] Remove claims about sharing or importing AI Brief collections.
- [ ] Add translations for the new fixed labels.
- [ ] Run targeted tests, ESLint, TypeScript, and `npm run build`.
- [ ] Verify desktop and mobile layouts in a real browser.
