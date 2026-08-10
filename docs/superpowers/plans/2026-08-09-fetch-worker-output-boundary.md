# Fetch Worker Output Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent worker-authored identity fields or cross-task output from corrupting regular or cloud fetch synchronization.

**Architecture:** The runner canonicalizes normal task output from the authoritative plan and isolates every shard to its assigned task set. Regular and cloud sync APIs then enforce the same exact task-to-builder/source mapping from server-stored plans before persistence.

**Tech Stack:** Node.js runner, Next.js route handlers, Zod contracts, Prisma, Node test runner.

---

### Task 1: Lock runner identity behavior

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/builder-digest.mjs`

- [ ] Add failing tests for wrong stable post fields, unbound extra items, duplicate results, and cross-shard outcomes.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Canonicalize matched normal post items from planned tasks.
- [ ] Restrict item and outcome matching to the producing shard.
- [ ] Run the focused tests and preserve fallback discovery behavior.

### Task 2: Harden regular sync

**Files:**
- Modify: `src/app/api/skill/builders/route.ts`
- Modify: `tests/http-sync-contract.test.ts`
- Modify: `tests/user-journeys.test.ts`

- [ ] Add a failing route contract test for off-plan and mismatched items.
- [ ] Derive the expected task mapping from server-stored fetch-run details.
- [ ] Reject unknown, duplicate, or mismatched normal items before persistence.
- [ ] Run regular fetch route and journey tests.

### Task 3: Harden cloud sync

**Files:**
- Modify: `src/app/api/admin/cloud-fetch/sync/route.ts`
- Modify: `src/lib/cloud-source-contracts.ts`
- Modify: relevant cloud sync tests

- [ ] Add failing tests for task/source/builder mismatch and duplicate IDs.
- [ ] Enforce exact cloud run/source/task mapping for every normal item.
- [ ] Reject duplicate task IDs and preserve fallback discovery semantics.
- [ ] Run cloud fetch sync and scheduler tests.

### Task 4: Verify the complete change

- [ ] Run all fetch-related tests.
- [ ] Run lint and static checks for changed files.
- [ ] Run the production build with the repository environment.
- [ ] Review the diff for unrelated changes and document residual risks.
