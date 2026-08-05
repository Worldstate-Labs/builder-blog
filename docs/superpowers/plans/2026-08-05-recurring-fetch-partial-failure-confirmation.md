# Recurring Fetch Partial-Failure Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let regular-user recurring fetch setup ask for explicit approval after an exit-65 run only when every ordinary post task has a durably synchronized terminal result, while keeping unsafe failures fatal across Claude Code, Codex, and OpenClaw.

**Architecture:** Add a fail-closed, three-state setup-verdict classifier to the installed `builder-digest.mjs` CLI. The runner invokes it before per-run cleanup and writes an atomic UUID-scoped verdict under the stable job-state directory; the shared setup prompt verifies that exact verdict instead of reading cleaned artifacts. OpenClaw queues the continuation into a persistent session, preferring `current` and using a `main` system-event compatibility path for 2026.5.20.

**Tech Stack:** Node.js ESM CLI, POSIX shell runner and prompt snippets, TypeScript `node:test`, Next.js prompt renderer.

---

## File Structure

- Modify `scripts/builder-digest.mjs`: own setup-verdict artifact parsing, deterministic classification, strict verification, bounded serialization, atomic `0600` writes, and two CLI commands.
- Modify `scripts/builder-agent-runner.sh`: call the classifier for declared initial `library-cron` setup proofs before cleanup without changing the runner exit code.
- Modify `skills/builder-blog-digest/jobs/library-cron-setup.md`: create one setup UUID, capture the runner code, verify the matching durable verdict, and branch on `ok | needs_confirmation | fatal`.
- Modify `src/lib/agent-prompt-renderer.ts`: preserve confirmation wording in OpenClaw children and select a persistent OpenClaw session capability.
- Create `tests/library-setup-verdict.test.ts`: focused classifier, file ownership, atomic write, schema, stale-instance, and CLI tests.
- Modify `tests/agent-job-runs.test.ts`: runner-to-classifier ordering and setup-only contract tests.
- Modify `tests/agent-prompt-renderer.test.ts`: OpenClaw persistent-session and child-confirmation tests.
- Modify `tests/user-journeys.test.ts` and `tests/cron-job-audit.test.ts`: shared setup prompt control-flow and installation-order invariants.
- Modify `docs/superpowers/specs/2026-08-05-recurring-fetch-partial-failure-confirmation-design.md`: keep the already-approved status and implementation-verified compatibility wording accurate if implementation details expose any final discrepancy.

## Task 1: Lock the three-state classifier contract

**Files:**
- Create: `tests/library-setup-verdict.test.ts`
- Modify: `scripts/builder-digest.mjs`

- [ ] **Step 1: Write fixture helpers and failing classification tests**

Create temporary current-run artifacts with a matching `.run-owner.json`, normalized `library-fetch-result.json`, `library-fetch-merged.json`, `library-agent-sync.json`, both merge reports, and `completed-checkpoint-synced-task-ids.txt`. Cover these exact cases through an exported `classifyLibrarySetupVerdictForTest` entry point:

```ts
assert.equal(classify({ runnerExitCode: 0, posts: [syncedPost] }).status, "ok");
assert.equal(classify({ runnerExitCode: 65, posts: [syncedPost, syncedHeadlineFailure] }).status, "needs_confirmation");
assert.equal(classify({ runnerExitCode: 65, posts: [unsynchronizedFailure] }).status, "fatal");
assert.equal(classify({ runnerExitCode: 65, discoveryFailure: true }).status, "fatal");
assert.equal(classify({ runnerExitCode: 0, userAction: "action_needed" }).status, "ok");
assert.equal(classify({ runnerExitCode: 65, userAction: "failed" }).status, "fatal");
assert.equal(classify({ runnerExitCode: 65, failureKind: "runtime_auth_failed" }).status, "fatal");
assert.equal(classify({ runnerExitCode: 124 }).status, "fatal");
```

Also cover a missing shard converted into a synchronized failed outcome, a successful skipped post, an action-needed-only merge run, and the true zero-non-discovery-task no-merge path.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx tsx --test tests/library-setup-verdict.test.ts`

Expected: FAIL because the classifier export and CLI contracts do not exist.

- [ ] **Step 3: Implement task classification and effective outcomes**

In `scripts/builder-digest.mjs`, add focused helpers near the other fetch-task reconciliation helpers:

```js
const SETUP_VERDICT_SCHEMA_VERSION = 1;
const SETUP_VERDICT_STATUSES = new Set(["ok", "needs_confirmation", "fatal"]);
const SETUP_VERDICT_MAX_FAILURES = 200;

function setupTaskKind(task) {
  if (isCandidateDiscoveryFetchTask(task)) return "discovery";
  if (isUserActionAgentWorkType(task?.agentWorkType)) return "user_action";
  return "post";
}
```

Build the effective terminal map in this order: canonical sync items and `taskOutcomes`, then overlay final `library-result-slice-*-validation-failed-payload.json` and `library-result-slice-*-failed-payload.json` outcomes. Use only structured fields. Never parse logs or sync stderr. Treat `runtime_auth_failed` as a global fatal condition; overall timeout/non-`0`/non-`65` codes are fatal, while a task-local worker timeout that was converted and durably accepted remains an ordinary post failure.

For every non-discovery planned task, require its exact task key in the durable ledger. Require ordinary post tasks to resolve to synced/skipped/failed/blocked; require user-action tasks to resolve only to `action_needed`. Discovery failure outcomes are always fatal. A `needs_confirmation` verdict requires exit `65`, complete ledger coverage, and at least one failed/blocked ordinary post. Exit `0` with any ordinary post failure is fatal rather than silently upgraded.

Derive bounded user-facing failure entries from the planned task and structured outcome:

```js
{
  fetchTaskId,
  title: boundedText(task.title ?? task.item?.title ?? task.url ?? fetchTaskId, 240),
  source: boundedText([task.builder, task.sourceType].filter(Boolean).join(" · ") || "Unknown source", 200),
  stage: structuredFailureStage(outcome),
  reason: boundedText(firstValidationError(outcome) ?? outcome.reason ?? "failed", 400),
}
```

If more than 200 failures would be required, classify as `fatal` instead of omitting failures from an approvable verdict.

- [ ] **Step 4: Run the pure classifier cases**

Run: `npx tsx --test tests/library-setup-verdict.test.ts --test-name-pattern="classifies"`

Expected: PASS for clean, safe partial, discovery, auth, action-needed, timeout, and incomplete-ledger cases.

- [ ] **Step 5: Commit the classifier contract**

```bash
git add tests/library-setup-verdict.test.ts scripts/builder-digest.mjs
git commit -m "Distinguish approvable fetch setup failures"
```

Use Lore trailers documenting that exit code 65 alone is insufficient and listing the focused tests.

## Task 2: Add strict current-run artifact IO and CLI commands

**Files:**
- Modify: `tests/library-setup-verdict.test.ts`
- Modify: `scripts/builder-digest.mjs`

- [ ] **Step 1: Write failing filesystem and verifier tests**

Test the `classify-library-setup-verdict` CLI with these arguments:

```text
--job-state-dir <stable-dir>
--run-dir <stable-dir>/runs/<uuid>
--out <stable-dir>/setup-verdict-<uuid>.json
--runner-exit-code 65
--instance-id <uuid>
--account-slug <slug>
--job-name library-cron
```

Assert that it writes a parseable verdict with mode `0600` via atomic rename. Assert fail-closed behavior for a symlinked run artifact, mismatched owner account/job/instance, output outside the direct job-state directory, a symlink output, missing required merge input, malformed JSON, wrong merge-report status, duplicate/unknown verdict fields, mismatched `runnerExitCode`, and mismatched expected instance.

- [ ] **Step 2: Run the CLI tests and confirm they fail**

Run: `npx tsx --test tests/library-setup-verdict.test.ts --test-name-pattern="CLI|verifies|rejects"`

Expected: FAIL because strict artifact loading and command routing are not implemented.

- [ ] **Step 3: Implement fail-closed current-run loading**

Add `lstat`-based regular-file checks. Resolve and compare paths so `run-dir` must be a direct descendant of `<job-state-dir>/runs`, the UUID-bearing output must be a direct child of `job-state-dir`, and the owner record must exactly match:

```js
owner.app === "followbrief"
owner.accountSlug === expectedAccountSlug
owner.jobName === "library-cron"
owner.instanceId === expectedInstanceId
```

Always require `.run-owner.json` and `library-fetch-result.json`. If the normalized fetch result contains any non-discovery task, also require the merged fetch file, canonical sync payload, ledger, and both merge reports. Load matching failure payloads only as regular files from the same run directory. Missing or malformed evidence produces a written `fatal` verdict when the output path itself is safe; unsafe output paths produce no verdict and a nonzero CLI exit.

- [ ] **Step 4: Implement atomic writer and strict verifier**

Route two commands in `main()`:

```js
else if (command === "classify-library-setup-verdict") await classifyLibrarySetupVerdictCommand(args);
else if (command === "verify-library-setup-verdict") await verifyLibrarySetupVerdictCommand(args);
```

The writer emits exactly the closed schema fields from the spec, uses a uniquely named same-directory temporary file with `mode: 0o600`, renames atomically, and chmods the final file to `0600`. The verifier accepts only the exact top-level and failure-entry key sets, version 1, bounded values, matching instance ID, and matching runner exit code; it prints the normalized verdict JSON on success and exits nonzero otherwise.

- [ ] **Step 5: Run all verdict tests**

Run: `npx tsx --test tests/library-setup-verdict.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit artifact IO**

```bash
git add tests/library-setup-verdict.test.ts scripts/builder-digest.mjs
git commit -m "Bind setup verdicts to one runner instance"
```

Use Lore trailers documenting UUID/path ownership and symlink rejection.

## Task 3: Emit the verdict before runner cleanup

**Files:**
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `scripts/builder-agent-runner.sh`

- [ ] **Step 1: Write failing runner contract tests**

Assert that a new `write_initial_setup_verdict` function:

- runs only when `BUILDER_BLOG_SETUP_INITIAL=1` and `JOB_NAME=library-cron`;
- passes `JOB_STATE_DIR`, `JOB_TMP_DIR`, account slug, job name, instance ID, runner code, and the requested output to the CLI;
- is invoked after the final lifecycle update but before every normal/timed-out `cleanup_job_tmp_dir` path;
- does not overwrite the original runner return code if classification fails;
- is absent from digest and Cloud setup paths unless explicitly declared.

- [ ] **Step 2: Run the runner contract tests and confirm they fail**

Run: `npx tsx --test tests/agent-job-runs.test.ts --test-name-pattern="setup verdict"`

Expected: FAIL because the runner does not yet write a setup verdict.

- [ ] **Step 3: Implement setup-only runner integration**

Add a shell helper that returns immediately outside the declared scope, then invokes:

```bash
node "$AGENT_DIR/builder-digest.mjs" classify-library-setup-verdict \
  --job-state-dir "$JOB_STATE_DIR" \
  --run-dir "$JOB_TMP_DIR" \
  --out "$BUILDER_BLOG_SETUP_VERDICT_FILE" \
  --runner-exit-code "$_code" \
  --instance-id "$BUILDER_BLOG_JOB_RUN_ID" \
  --account-slug "$ACCOUNT_SLUG" \
  --job-name "$JOB_NAME"
```

Call it with best-effort error reporting after the terminal `job_run_update` and before cleanup for ordinary completion and with code `124` before timed-out cleanup. Preserve `_code` and return it unchanged.

- [ ] **Step 4: Verify shell syntax and runner contracts**

Run: `bash -n scripts/builder-agent-runner.sh`

Run: `npx tsx --test tests/agent-job-runs.test.ts --test-name-pattern="setup verdict|job run"`

Expected: PASS.

- [ ] **Step 5: Commit runner integration**

```bash
git add tests/agent-job-runs.test.ts scripts/builder-agent-runner.sh
git commit -m "Preserve setup evidence before runner cleanup"
```

## Task 4: Make the shared prompt consume the durable verdict

**Files:**
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/cron-job-audit.test.ts`
- Modify: `skills/builder-blog-digest/jobs/library-cron-setup.md`

- [ ] **Step 1: Write failing shared-prompt contract tests**

Require step 6 to generate `EXPECTED_INSTANCE_ID` with `crypto.randomUUID()`, construct only `setup-verdict-$EXPECTED_INSTANCE_ID.json`, delete only that exact old target, and pass all three setup environment variables. Require an `if ...; then RUNNER_EXIT_CODE=0; else RUNNER_EXIT_CODE=$?; fi` capture so exit 65 does not terminate the setup prompt before verification.

Assert that the old inline reader of stable `library-fetch-result.json` / `library-agent-sync.json` is gone, and the prompt instead runs:

```bash
node "$AGENT_DIR/builder-digest.mjs" verify-library-setup-verdict \
  --file "$SETUP_VERDICT_FILE" \
  --instance-id "$EXPECTED_INSTANCE_ID" \
  --runner-exit-code "$RUNNER_EXIT_CODE"
```

Require `ok` to continue automatically, `needs_confirmation` to ask and wait for explicit yes, and `fatal`/missing/malformed/stale to stop before any pin, plist, crontab, or `cron-status` write.

- [ ] **Step 2: Run prompt tests and confirm they fail**

Run: `npx tsx --test tests/user-journeys.test.ts tests/cron-job-audit.test.ts --test-name-pattern="setup verdict|initial fetch|partial"`

Expected: FAIL because step 6 aborts on any nonzero runner code and reads cleaned stable artifacts.

- [ ] **Step 3: Replace the old gate in the shared prompt**

Update the opening to allow questions at the existing-schedule gate and the partial-proof gate. Generate the UUID before invoking the runner, retain it in shell variables, capture the runner code, verify the exact durable verdict, and report runner output regardless of status.

Do not let prose or stderr change a verdict. For `needs_confirmation`, list the verdict's bounded failures and ask whether to install anyway. Treat valid `x_token_missing`/`*_token_missing` action-needed outcomes as notices without re-asking. Keep all step 7/8 installation and override ordering unchanged.

- [ ] **Step 4: Run focused prompt tests**

Run: `npx tsx --test tests/user-journeys.test.ts tests/cron-job-audit.test.ts --test-name-pattern="setup verdict|initial fetch|partial|override"`

Expected: PASS.

- [ ] **Step 5: Commit the shared prompt flow**

```bash
git add tests/user-journeys.test.ts tests/cron-job-audit.test.ts skills/builder-blog-digest/jobs/library-cron-setup.md
git commit -m "Ask before scheduling safe partial fetches"
```

## Task 5: Keep OpenClaw confirmation in a persistent session

**Files:**
- Modify: `tests/agent-prompt-renderer.test.ts`
- Modify: `src/lib/agent-prompt-renderer.ts`

- [ ] **Step 1: Write failing renderer tests**

Assert that the OpenClaw parent bootstrap captures `openclaw cron add --help`, prefers `--session current --message` when `current` is advertised, otherwise accepts the 2026.5.20 `main|isolated` contract only through `--session main --system-event --wake now`, and fails before queueing when neither persistent mode exists. Assert that no rendered parent or child contains `--session isolated`, "unattended and must not wait for confirmation", or a rewrite that converts `needs_confirmation` into an automatic stop.

Assert that the child still contains the shared instruction to ask explicitly and continue steps 7-8 only after yes.

- [ ] **Step 2: Run renderer tests and confirm they fail**

Run: `npx tsx --test tests/agent-prompt-renderer.test.ts --test-name-pattern="OpenClaw.*setup"`

Expected: FAIL because the renderer currently hardcodes `isolated` and rewrites the confirmation branch.

- [ ] **Step 3: Implement capability-selected persistent queueing**

Remove `adaptSetupContinuationForUnattendedChild`. Change the child preamble to say that hard failures stop, while `needs_confirmation` must ask and wait in the persistent session.

In the parent shell block, inspect the help text before queueing:

```bash
OPENCLAW_CRON_ADD_HELP="$(openclaw cron add --help 2>&1)"
if printf '%s\n' "$OPENCLAW_CRON_ADD_HELP" | grep -Eq 'main\|isolated\|current|current\|session:'; then
  # queue --session current with --message
elif printf '%s\n' "$OPENCLAW_CRON_ADD_HELP" | grep -q 'main|isolated' \
  && printf '%s\n' "$OPENCLAW_CRON_ADD_HELP" | grep -q -- '--system-event'; then
  # queue --session main with --system-event and --wake now
else
  echo "OpenClaw does not expose a persistent cron session mode required for confirmation." >&2
  exit 1
fi
```

Do not use `--light-context` on the persistent continuation. Keep the delayed one-shot name, prompt download, timeout configuration, output capture, and queued marker.

- [ ] **Step 4: Run renderer and route tests**

Run: `npx tsx --test tests/agent-prompt-renderer.test.ts tests/agent-prompt-link-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit OpenClaw continuation**

```bash
git add tests/agent-prompt-renderer.test.ts src/lib/agent-prompt-renderer.ts
git commit -m "Keep OpenClaw setup confirmation interactive"
```

## Task 6: End-to-end verification and review

**Files:**
- Modify only if verification exposes a defect in the files above.

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
npx tsx --test \
  tests/library-setup-verdict.test.ts \
  tests/agent-job-runs.test.ts \
  tests/agent-prompt-renderer.test.ts \
  tests/user-journeys.test.ts \
  tests/cron-job-audit.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static and shell checks**

Run: `bash -n scripts/builder-agent-runner.sh`

Run: `npm run lint`

Run: `npx tsc --noEmit`

Expected: all exit 0.

- [ ] **Step 3: Run the complete regression suite and production build**

Run: `npm test`

Expected: 1132 existing tests plus the new verdict tests, all passing.

Run: `npm run build`

Expected: production build and prompt runtime trace verification pass.

- [ ] **Step 4: Review the final diff for scope and isolation**

Run: `git diff --check`

Run: `git status --short`

Confirm that digest recurring setup, admin Cloud fetch, installed recurring execution, account-scoped pins, and override replacement code are unchanged except for shared assertions required by the new gate.

- [ ] **Step 5: Request code review and resolve blocking findings**

Use `superpowers:requesting-code-review` against the implementation branch. Re-run the focused tests after any review fix.

- [ ] **Step 6: Commit any verification fixes**

Use a Lore commit describing the reason, scope risk, exact tests, and any remaining untested OpenClaw live-delivery gap.

