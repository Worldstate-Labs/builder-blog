# Launchd Service Transition Waits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin Cloud and regular local schedule stop/replacement prompts wait for launchd's asynchronous `bootout` transition before cleanup, stopped reporting, or replacement bootstrap.

**Architecture:** Keep service management inside the existing prompt blocks. Add the same bounded POSIX-shell `wait_for_launchd_absent` helper to each affected macOS block, use launchd absence as the postcondition, and fail closed after 30 seconds without changing Linux, regular cloud API, runner identity, or self-uninstall behavior.

**Tech Stack:** Markdown job prompts with embedded POSIX shell, TypeScript Node test runner (`tsx --test`), fake shell command harnesses.

---

### Task 1: Make admin Cloud stop and replacement wait for launchd

**Files:**
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `skills/builder-blog-digest/jobs/cloud-library-cron-stop.md`
- Modify: `skills/builder-blog-digest/jobs/cloud-library-cron-setup.md`

- [ ] **Step 1: Add a failing delayed-bootout stop regression**

  Extract the macOS `SERVICE_ABSENT launchd` block from `cloud-library-cron-stop.md`. Execute it with a correct-owner temporary plist, a fake `launchctl` that stays visible until two fake `sleep` calls, and a no-op/incrementing `sleep`. Assert the block succeeds, removes the plist, and prints `SERVICE_ABSENT`. The current prompt must fail with exit 75 because it probes immediately.

- [ ] **Step 2: Add failing setup-order contracts**

  Assert every macOS Cloud replacement/install block that calls `launchctl bootout` also contains `wait_for_launchd_absent`, and that the call appears after `bootout` but before plist removal or `launchctl bootstrap`.

- [ ] **Step 3: Run the focused RED tests**

  Run:

  ```bash
  npx tsx --test --test-name-pattern='admin cloud.*launchd|admin cloud host prompts' tests/cloud-source-cli-contract.test.ts
  ```

  Expected: the delayed-stop and setup-wait assertions fail because no bounded wait exists.

- [ ] **Step 4: Add the minimal bounded wait to admin prompts**

  Add this helper locally to each affected macOS block:

  ```sh
  wait_for_launchd_absent() {
    label="$1"
    remaining=30
    while launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; do
      [ "$remaining" -gt 0 ] || return 1
      sleep 1
      remaining=$((remaining - 1))
    done
  }
  ```

  Call it after `bootout`. On failure, print `launchd did not finish unloading: $LABEL` and exit 75 before plist removal, runner cleanup, pin mutation, or bootstrap.

- [ ] **Step 5: Run the focused GREEN tests**

  Run the Step 3 command. Expected: pass.

### Task 2: Make regular local stop fail closed on delayed launchd removal

**Files:**
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/cron-job-audit.test.ts`
- Modify: `skills/builder-blog-digest/jobs/library-cron-stop.md`
- Modify: `skills/builder-blog-digest/jobs/digest-cron-stop.md`

- [ ] **Step 1: Add a failing eventual-absence behavior test**

  For both stop prompts, execute the macOS label-cleanup block with `BUILDER_BLOG_ACCOUNT` empty, an explicit temporary label/plist, and a temporary `HOME`. Define a shell `node()` function that returns success for every `cron-audit` call so no real `AGENT_DIR`, credential, network, or user file is touched. Define a fake `launchctl` that becomes absent only after two fake sleeps. Assert stdout reports `launchd absent`, never `STILL LOADED`, and the temporary plist is removed.

- [ ] **Step 2: Add a failing timeout-preservation behavior test**

  Reuse the same hermetic temporary `HOME`, explicit label, and fake `node()` audit function. Execute both stop blocks with a fake `launchctl` that always reports loaded and a no-op `sleep`. Assert exit 75 and the temporary plist remains. Because the fenced stop block exits nonzero, the prompt contract prevents the later `cron-status --status stopped` block from being reached. The current prompts must fail this test because they remove the plist and return success.

- [ ] **Step 3: Strengthen audit contracts**

  In `tests/cron-job-audit.test.ts`, require both regular stop prompts to call a bounded absence helper before `launchd_remove_plist`, and require a fatal timeout message.

- [ ] **Step 4: Run the focused RED tests**

  Run:

  ```bash
  npx tsx --test --test-name-pattern='regular local.*launchd|cron stop prompts' tests/cloud-source-cli-contract.test.ts tests/cron-job-audit.test.ts
  ```

  Expected: delayed/timeout behavior fails under the current best-effort cleanup.

- [ ] **Step 5: Implement fail-closed regular stop waits**

  Add the same 30-second helper to the macOS blocks. Preserve existing audit events and `BOOTOUT_CODE`, but treat post-wait service absence as authoritative. If the service remains loaded, record `launchd_bootout_finished` with `launchctl-loaded 1`, exit 75, and do not remove the plist or continue later stopped reporting. Stale unloaded plists remain removable without delay.

- [ ] **Step 6: Run the focused GREEN tests**

  Run the Step 4 command. Expected: pass.

### Task 3: Make regular local replacement wait before bootstrap

**Files:**
- Modify: `tests/cron-job-audit.test.ts`
- Modify: `skills/builder-blog-digest/jobs/library-cron-setup.md`
- Modify: `skills/builder-blog-digest/jobs/digest-cron-setup.md`

- [ ] **Step 1: Add failing setup ordering tests**

  This step is a pure source-contract test, not a shell-execution test. For both setup prompts, isolate the fenced macOS block containing `launchd_bootstrap_succeeded`. Assert the bounded absence helper is defined, its call occurs after `launchctl bootout` and before `launchctl enable`/`launchctl bootstrap`, and its failure branch contains the timeout message plus `exit 75`. Do not execute this block: it intentionally depends on generated `launchd.xml` schedule state. The behavioral delayed/timeout semantics of the identical helper are covered by Tasks 1 and 2; final `/bin/sh -n` checks cover setup shell validity.

- [ ] **Step 2: Run the focused RED test**

  Run:

  ```bash
  npx tsx --test --test-name-pattern='cron setup and stop prompts|launchd replacement waits' tests/cron-job-audit.test.ts
  ```

  Expected: fail because setup currently bootstraps immediately.

- [ ] **Step 3: Add the bounded wait to both setup prompts**

  Add the same helper to each macOS setup block. After auditing `BOOTOUT_CODE`, wait for absence; on timeout emit the fatal message and exit 75 before `launchctl enable` or `launchctl bootstrap`. Keep the existing bootstrap success/failure audit events unchanged.

- [ ] **Step 4: Run the focused GREEN test**

  Run the Step 2 command. Expected: pass.

### Task 4: Verify scope, regressions, and shell validity

**Files:**
- Test: `tests/cloud-source-cli-contract.test.ts`
- Test: `tests/cron-job-audit.test.ts`
- Test: `tests/user-journeys.test.ts`
- Test: all six modified prompt files

- [ ] **Step 1: Run focused tests**

  ```bash
  npx tsx --test tests/cloud-source-cli-contract.test.ts tests/cron-job-audit.test.ts tests/user-journeys.test.ts
  ```

- [ ] **Step 2: Syntax-check every embedded bash block in all six prompts**

  Extract fenced `bash` blocks and pass each to `/bin/sh -n`.

- [ ] **Step 3: Run full project verification**

  ```bash
  npm test
  npm run lint
  npx tsc --noEmit --pretty false
  DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build' npm run build
  git diff --check
  ```

- [ ] **Step 4: Inspect the final diff**

  Confirm only the six prompts, two tracked test files, and this plan changed after the design commit. Confirm Linux, regular cloud API, runner self-uninstall, and user-owned main-worktree files are untouched.

- [ ] **Step 5: Request independent code review**

  Provide the spec, plan, base SHA, diff, RED/GREEN evidence, and verification output. Resolve every Critical/Important finding before completion.

- [ ] **Step 6: Commit the implementation with a Lore-format message**

  Record the launchd async constraint, rejected fixed-sleep alternative, verification evidence, and live launchd residual test gap.
