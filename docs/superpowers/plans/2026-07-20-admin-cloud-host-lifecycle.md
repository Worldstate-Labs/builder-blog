# Admin Cloud Host Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin Cloud worker-host replacement and stop operations account-safe, terminally truthful, and retryable after failures.

**Architecture:** Keep OS service manipulation in the setup/stop prompts, but move current-file, PID, process-tree, and strict job-run lifecycle handling into the canonical runner. The prompts enforce ordering around that control surface and never mutate pins before confirmation or after incomplete cleanup.

**Tech Stack:** POSIX shell, Markdown job prompts, Node test runner with TypeScript (`tsx --test`).

---

### Task 1: Lock the lifecycle contracts with failing tests

**Files:**
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/agent-job-runs.test.ts`

- [x] Add prompt-order tests for delayed setup pins, replacement marking before service bootout, ownership checks before stop, and fatal active-service handling.
- [x] Add runner contract tests for strict control actions and exact runner-only PID matching.
- [x] Add shell harness tests proving termination/update failure preserves the current marker.
- [x] Add stale/PID-reuse tests proving unrelated processes are not killed.
- [x] Add a fail-closed stop test proving a cross-account loaded service is not unloaded.
- [x] Run the focused tests and confirm they fail for the missing behavior.

### Task 2: Add strict runner control actions

**Files:**
- Modify: `scripts/builder-agent-runner.sh`

- [x] Preserve and return the real status from `job_run_update_for_instance`.
- [x] Add opt-in strict terminal update behavior without changing ordinary best-effort heartbeats.
- [x] Implement `mark-replaced` for both `cloud-library-host/current.json` and legacy `cloud-library-cron/current.json`; dead or recycled-PID records are strictly marked `stale` and cleared rather than labeled `replaced`.
- [x] Implement `stop-current` with argv + process-start identity, cached descendant escalation, strict terminal update, and marker preservation on failure.
- [x] Dispatch control actions before starting the persistent host.
- [x] Run focused tests and confirm runner tests pass.

### Task 3: Make setup replacement ordered and truthful

**Files:**
- Modify: `skills/builder-blog-digest/jobs/cloud-library-cron-setup.md`

- [x] Move runtime pin writes after the replacement confirmation and old-host cleanup.
- [x] Resolve the existing service account again in the mutation block.
- [x] Strictly mark the old host replaced before unloading its service.
- [x] Verify launchd/systemd is inactive before continuing.
- [x] Stop any residual recorded current worker through the runner control action.
- [x] Install and verify the new service, failing without a success report on any unmet invariant.

### Task 4: Make stop account-safe and retryable

**Files:**
- Modify: `skills/builder-blog-digest/jobs/cloud-library-cron-stop.md`

- [x] Refuse to stop a shared service owned by a different account, or a loaded service whose owner cannot be proven.
- [x] Replace ignored service-manager failures with explicit absent/inactive checks and nonzero exits.
- [x] Replace embedded broad PID matching with the runner `stop-current` action.
- [x] Remove pins only after service and current-worker cleanup succeeds.

### Task 5: Verify and review

**Files:**
- Test: `tests/cloud-source-cli-contract.test.ts`
- Test: `tests/agent-job-runs.test.ts`
- Test: `tests/agent-prompt-renderer.test.ts`
- Test: `tests/launchd-setup-contract.test.ts`
- Test: `tests/user-journeys.test.ts`

- [x] Run focused lifecycle tests.
- [x] Run the full test suite, lint, typecheck/build, and shell syntax check.
- [x] Inspect the final diff for unrelated changes and confirm user-owned untracked files were untouched.
