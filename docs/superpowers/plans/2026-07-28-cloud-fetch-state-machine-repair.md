# Cloud Fetch State Machine Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable cloud fetch terminal synchronization and make Sources, delivery history, and work-lane state agree with authoritative server and live worker evidence.

**Architecture:** Keep the existing server lease and terminal reconciliation model. Repair the local runner/CLI boundary so sync slices are atomic by run and source, discard only server-confirmed obsolete slices, and correct the two reader precedence bugs without a schema migration.

**Tech Stack:** Node.js ESM CLI, POSIX shell runner, TypeScript, Next.js, Prisma/PostgreSQL, Node test runner.

---

### Task 1: Accept and isolate cloud-source CLI slices

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/builder-digest.mjs`

- [ ] Add an actual child-process CLI test for `split-sync-slices --granularity cloud-source`.
- [ ] Run the focused test and confirm it fails with the current whitelist error.
- [ ] Add a repeated-lease fixture where the same fetch task ID belongs to two runs of the same source and assert each run/source slice receives matching evidence.
- [ ] Run the repeated-lease test and confirm the older slice lacks evidence.
- [ ] Extend the allowed granularity set and replace one-to-one task/slice maps with run/source-aware one-to-many routing for items, outcomes, and expansions.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Stop obsolete run slices from poisoning persistent-host flushes

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `scripts/builder-digest.mjs`
- Modify: `scripts/builder-agent-runner.sh`

- [ ] Add tests for a bounded machine-readable HTTP error diagnostic.
- [ ] Confirm the diagnostic test fails because CLI errors currently expose only prose.
- [ ] Add a shell-function test proving non-retryable `cloud_run_not_running` and `cloud_source_already_finalized` are obsolete, while reset fences, incomplete results, network failures, and retryable races are not.
- [ ] Confirm the shell-function test fails because no classifier exists.
- [ ] Emit the structured diagnostic from the CLI top-level error handler.
- [ ] Add the exact-code shell classifier and mark only obsolete slice task IDs resolved.
- [ ] Run the CLI and shell contract suites.

### Task 3: Preserve zero-post server failures

**Files:**
- Modify: `tests/cloud-fetch-outcome-summary.test.ts`
- Modify: `tests/cloud-fetch-run-log.test.ts`
- Modify: `src/lib/cloud-fetch-outcome-summary.ts`

- [ ] Add a regression test for `FAILED`, zero planned posts, and `cloud_lease_expired`.
- [ ] Confirm it currently returns `SUCCEEDED`.
- [ ] Add a batch serialization test proving the failed source makes the delivery batch failed.
- [ ] Preserve explicit raw `FAILED` / `PARTIAL` status when no post outcomes exist and retain its failure reason.
- [ ] Confirm genuine `SUCCEEDED` zero-post checks and evidence-backed all-skipped checks remain successful.
- [ ] Run the outcome and run-log suites.

### Task 4: Make summarized live evidence outrank summarize phase

**Files:**
- Modify: `tests/fetch-log-panel-status.test.ts`
- Modify: `src/components/FetchLogPanel.tsx`

- [ ] Add regression assertions for `status=summarized`, `phase=summarize`, and positive summary/headline metrics.
- [ ] Confirm the pill and summarize row currently report `summarizing`.
- [ ] Reorder status precedence in the pill, lifecycle row, and banner.
- [ ] Add complete live summary/headline evidence as a terminal fallback.
- [ ] Run the component status suite.

### Task 5: Verify the whole cloud fetch path

**Files:**
- Verify all modified files.

- [ ] Run focused regression tests.
- [ ] Run cloud scheduler, plan, sync, reconciliation, CLI, runner-contract, and UI log suites.
- [ ] Run ESLint on modified source and tests.
- [ ] Run TypeScript typecheck.
- [ ] Run the production build.
- [ ] Run a web-sync-disabled CLI smoke covering split, validate, and sync payload preparation.
- [ ] Inspect the final diff for unrelated changes and secrets.
- [ ] Record exact verification evidence and remaining production rollout steps.
