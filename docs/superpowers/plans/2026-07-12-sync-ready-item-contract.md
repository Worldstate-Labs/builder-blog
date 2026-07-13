# Sync-Ready Item Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every worker-produced post is structurally valid before API sync and preserve completed Read/Summarize evidence when Sync fails.

**Architecture:** Add one deterministic sync-ready normalization/validation boundary in `builder-digest.mjs`, used by local validation and sync. Enrich terminal sync-failure outcomes with the attempted item's lifecycle evidence, then make the Fetch log render stages from that evidence rather than from the terminal status alone.

**Tech Stack:** Node.js CLI, TypeScript/React, Zod API schemas, Node test runner.

---

**Dirty-worktree rule:** `scripts/builder-digest.mjs`,
`tests/builder-digest-cli.test.ts`,
`skills/builder-blog-digest/jobs/_fetch-task-core.md`, and
`tests/user-journeys.test.ts` already contain user changes. Read their current
diff before each edit, layer this work around those changes, and never restore
or rewrite unrelated hunks. Stage only paths and hunks owned by this plan.

### Task 1: Lock the sync-ready item contract

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/builder-digest.mjs`

- [ ] Add failing tests proving parseable timestamps normalize to ISO, invalid
      timestamps fail locally, and fallback placeholder identity is rejected.
- [ ] Run the targeted tests and confirm they fail for the missing contract.
- [ ] Implement one pure sync-ready item normalization/validation helper.
      Invoke it from `validateAgentSyncPayload`, `syncBuilders`, and
      `syncCloudBuilders` before source-specific upload scrubbing so every
      runtime uses the same contract.
- [ ] Run the targeted tests and confirm they pass.

### Task 2: Preserve sync-failure lifecycle evidence

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/builder-digest.mjs`
- Modify: `scripts/builder-agent-runner.sh`

- [ ] Add a failing test for a failed sync slice containing a fully summarized
      item and the concrete sync error.
- [ ] Run the test and confirm the current outcome loses that evidence.
- [ ] Pass the attempted `_slice_payload` plus its captured stderr/stdout
      diagnostic into `fail-sync-slice`. Match payload items to selected tasks
      by `rawJson.fetchTaskId`, then include canonical item identity, stage
      sizes, `completedStage: "summarize"`, and sync error in each outcome.
- [ ] Ensure `patchFetchRunOutcomes` carries size and identity fields supplied
      directly by failed task outcomes instead of relying only on
      `sizesByTaskId` from successful payload items.
- [ ] Run the targeted tests and confirm they pass.

### Task 3: Retain enriched evidence in fetch-run task details

**Files:**
- Modify: `tests/fetch-run-details.test.ts`
- Modify: `tests/library-fetch-runs.test.ts`
- Modify: `src/lib/fetch-run-details.ts`
- Modify: `src/app/api/skill/fetch-runs/[id]/route.ts`

- [ ] Add failing schema and merge tests for a `task_sync_failed` outcome with
      attempted item metadata, headline counts, and `completedStage`.
- [ ] Run the test and verify the existing planned task keeps placeholder data.
- [ ] Extend the PATCH outcome schema with bounded `title`, `url`,
      `headlineChars`, `headlineWords`, `completedStage`, and `syncError`
      fields. Merge only those explicit fields into the task record while
      preserving structured evidence.
- [ ] Add a failing compaction test with oversized details, then update
      `compactTask` so every compaction level retains the minimum proof for
      `task_sync_failed`: actual title/URL, stage sizes, `completedStage`,
      failure code, and bounded `syncError`. Verbose `evidence` remains
      disposable.
- [ ] Run the targeted test and confirm it passes.

### Task 4: Render lifecycle stages from stage evidence

**Files:**
- Modify: `tests/fetch-log-panel-status.test.ts`
- Modify: `src/components/FetchLogPanel.tsx`

- [ ] Add failing tests asserting a summarized `task_sync_failed` task renders
      Read and Summarize complete, Sync failed, and the concrete sync reason
      only under Sync.
- [ ] Run the test and confirm the current UI mislabels earlier stages.
- [ ] Add a small shared lifecycle-evidence helper and use it in read,
      summarize, banner, and detail rendering.
- [ ] Run the targeted tests and confirm they pass.

### Task 5: Clarify the worker output contract

**Files:**
- Modify: `skills/builder-blog-digest/jobs/_fetch-task-core.md`
- Modify: `tests/user-journeys.test.ts`

- [ ] Add a failing contract test for real fallback identity and ISO timestamps.
- [ ] Update the shared fetch-task contract without source-specific examples.
- [ ] Run the contract test and confirm it passes.

### Task 6: Verify the integrated behavior

**Files:**
- Test: `tests/builder-digest-cli.test.ts`
- Test: `tests/fetch-run-details.test.ts`
- Test: `tests/fetch-log-panel-status.test.ts`
- Test: `tests/library-fetch-runs.test.ts`
- Test: `tests/user-journeys.test.ts`

- [ ] Run all targeted tests.
- [ ] Run ESLint for changed TypeScript/React files.
- [ ] Run `npx tsc --noEmit --pretty false`.
- [ ] Run `git diff --check` and inspect the scoped diff for unrelated changes.
