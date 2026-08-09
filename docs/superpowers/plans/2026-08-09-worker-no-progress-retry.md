# Worker No-Progress Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry a library shard worker exactly once when it reaches the initial no-checkpoint watchdog.

**Architecture:** Keep retry ownership in the existing POSIX shell supervisor. Track consumed retries by shard name in runner-local state, terminate and reap the first attempt before restarting the same shard and lane, and preserve the existing terminal timeout path for the second failure.

**Tech Stack:** POSIX shell, Node.js test runner, TypeScript regression tests

---

### Task 1: Lock the retry contract with a failing test

**Files:**
- Modify: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that extracts the retry-state shell helpers, proves a shard is
eligible once and only once while another shard remains eligible, and asserts
the no-progress supervisor branch terminates before restarting, archives the
first attempt logs, reuses the same shard, stable lane, result path, and
checkpoint directory, and retains the existing terminal watchdog path.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/library-fetch-runs.test.ts --test-name-pattern "initial no-progress worker retry"`

Expected: FAIL because the retry helpers and retry branch do not exist.

### Task 2: Implement the bounded retry

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Test: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Add minimal retry-state helpers**

Track retried shard names in a runner-local, whitespace-delimited set with
exact-token matching. Keep the retry limit fixed at one.

- [ ] **Step 2: Allow an explicit retry start**

Let `start_library_worker` bypass the already-started guard only when called by
the retry path. Continue deriving the stable lane from the shard file.

- [ ] **Step 3: Add the no-progress retry branch**

On the first initial no-progress timeout, prove the original worker process
tree is gone, reap the worker shell, mark the old PID inactive, archive
attempt-one logs, consume the shard retry, and restart the same shard with its
original stable lane, result path, and checkpoint directory. Increment the
live-worker count and continue monitoring. If process-tree termination cannot
be confirmed or the retry was already consumed, use the existing terminal
failure path without starting a concurrent attempt.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx --test tests/library-fetch-runs.test.ts --test-name-pattern "initial no-progress worker retry"`

Expected: PASS.

### Task 3: Verify the runner and regression surface

**Files:**
- Verify: `scripts/builder-agent-runner.sh`
- Verify: `tests/library-fetch-runs.test.ts`
- Verify: `tests/agent-job-runs.test.ts`

- [ ] **Step 1: Validate shell syntax**

Run: `bash -n scripts/builder-agent-runner.sh`

Expected: exit 0.

- [ ] **Step 2: Run focused runner tests**

Run: `npx tsx --test tests/library-fetch-runs.test.ts tests/agent-job-runs.test.ts`

Expected: all tests pass.

- [ ] **Step 3: Run static project checks**

Run: `npm run lint && npx tsc --noEmit`

Expected: both exit 0.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Review the final diff**

Confirm only the retry-only design/plan, runner, and focused test changed; no
Codex flags, failure taxonomy, setup classifier, or UI files changed.
