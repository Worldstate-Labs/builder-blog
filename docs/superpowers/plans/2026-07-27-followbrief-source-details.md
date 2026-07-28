# FollowBrief Source Details Disclosure Implementation Plan

> **For Codex:** Execute this plan test-first and verify each task before moving on.

**Goal:** Replace the FollowBrief `On time sources` summary with an Agent-log-style source-details disclosure that expands the existing per-source status list.

**Architecture:** Keep all current cloud-log data and source-row rendering intact. Add one local disclosure state to `UserCloudFetchLogPanel`, render a semantic summary button in the fourth metadata cell, and gate the existing source list behind that state. Reuse the established `digest-status-toggle` CSS instead of adding a parallel component or style system.

**Tech Stack:** React, TypeScript, Next.js, Node test runner, existing global CSS.

---

### Task 1: Lock the disclosure contract with tests

**Files:**
- Modify: `tests/library-fetch-runs.test.ts`
- Modify: `tests/performance-ux.test.ts`

1. Replace assertions for `On time sources` with assertions for `Status / log`.
2. Assert that the FollowBrief control uses `digest-status-toggle`, shows the submitted source count and `Details`, and exposes `aria-expanded` / `aria-controls`.
3. Assert that the source list is rendered only while the disclosure is open.
4. Assert that a zero-row disclosure is disabled and does not expose an empty region.
5. Assert that top-level collapse does not reset nested source-row or `Show more` state.
6. Assert that obsolete on-time summary variables and markup are absent.
7. Run the focused tests and confirm they fail for the expected missing implementation.

### Task 2: Implement the FollowBrief details disclosure

**Files:**
- Modify: `src/components/SourceSyncLogTabs.tsx`

1. Import the shared chevron icons.
2. Add local `detailsOpen` state to `UserCloudFetchLogPanel`.
3. Replace the fourth metadata item with a semantic `Status / log` item containing the Agent-log-style pill.
4. Gate the existing source list behind `detailsOpen`.
5. Preserve independent source-row expansion and the existing first-five / show-more state across top-level collapse and reopen.
6. Disable the disclosure when no source rows are available.
7. Run focused tests until green.

### Task 3: Verify behavior and presentation

**Files:**
- Modify only if verification exposes a defect: `src/app/globals.css`
- Record visual verdict: `.omx/state/followbrief-source-details/ralph-progress.json`

1. Run the complete test suite.
2. Run lint, typecheck, and the production build.
3. Render the mobile FollowBrief panel and verify the four-cell layout, pill spacing, collapsed state, expanded source rows, and touch target.
4. Compare against the supplied reference screenshots and iterate until the visual verdict passes.
5. Review the final diff for regressions, unrelated edits, and accessibility gaps.
