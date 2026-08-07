# Deterministic OpenClaw Confirmation Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recurring Fetch sources installation resume through one proof-bound FollowBrief command and report success only after the correct local schedule and server record are both verified active.

**Architecture:** A new bundled shell helper owns regular-user library schedule installation, server status reporting, read-back verification, and the final machine marker. The setup prompt writes a mode-0600 contract beside the verified initial-run verdict; `ok` invokes the helper immediately, while `needs_confirmation` exposes one exact contract-bound command for the later turn. The helper ignores OpenClaw-native cron state and proves account-scoped pins, scheduler identity, and server state before returning success.

**Tech Stack:** POSIX shell, Node.js 20 inline validators, TypeScript `node:test`, existing agent bundle and prompt renderer.

---

## File structure

- Create `scripts/builder-library-cron-install.sh`: validate resume contracts; install launchd/crontab; write pins; report/read back server status; emit the exact success marker.
- Create `tests/library-cron-install.test.ts`: execute the real helper in temporary homes with fake scheduler and FollowBrief CLI boundaries.
- Modify `skills/builder-blog-digest/jobs/library-cron-setup.md`: create the contract after verified setup evidence and replace model-authored step 7/8 installation with the helper contract.
- Modify `src/lib/agent-skill-files.ts`: bundle the new helper at mode 0755.
- Modify `scripts/install-agent-skill-bundle.cjs`: require the helper target during transactional install.
- Modify `tests/agent-skill-bundle.test.ts`: lock the new executable target and mode.
- Modify `tests/agent-prompt-renderer.test.ts`: lock the OpenClaw pause/resume and marker contract.
- Modify `tests/cron-job-audit.test.ts`: move regular-library install assertions from Markdown text to the executable helper while preserving digest prompt coverage.
- Modify `tests/user-journeys.test.ts` only where existing source-pattern assertions still assume inline library installation.

### Task 1: Lock the deterministic installer contract with failing tests

**Files:**
- Create: `tests/library-cron-install.test.ts`
- Test target: `scripts/builder-library-cron-install.sh`

- [ ] **Step 1: Add a real-process test harness**

Create temporary `HOME`, agent, LaunchAgents, and fake-bin directories. Write a valid mode-0600 contract at the exact path:

```text
<agent-dir>/tmp/accounts/test_example_com_<hash>/library-cron-direct/
resume-contract-11111111-1111-4111-8111-111111111111.json
```

The contract must include version `1`, job `library-cron`, account, account slug,
instance ID, verdict status, runtime, frequency key/label, interval minutes,
force, fetch days, parallel workers, and created time.

Assert the parsed on-disk object contains only the allowlisted schema fields
(plus installer-owned `ownerId`, `anchorAt`, `completedAt`, and `evidence` after
those phases). Explicitly assert that no bearer token, exchange code, prompt
text, account credential JSON, environment snapshot, or unknown property is
present.

Provide fake `launchctl` and fake installed `builder-digest.mjs` executables. The
fake CLI must support `schedule-spec`, `cron-audit`, `cron-status`, and
`cron-state`, record arguments, and return caller-controlled server state.

- [ ] **Step 2: Add the confirmation-gate RED case**

Execute the not-yet-existing helper against a `needs_confirmation` contract
without `FOLLOWBRIEF_CONFIRM_PARTIAL=1` and assert:

```ts
assert.notEqual(result.status, 0);
assert.match(result.stderr, /explicit partial-result confirmation/i);
assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/);
assert.equal(readMutationLog(), "");
```

- [ ] **Step 3: Add the local-plus-server proof RED cases**

Cover each boundary independently:

1. local LaunchAgent missing while fake server returns active;
2. local LaunchAgent present while fake server returns stopped;
3. server active with mismatched runtime, frequency, force, owner, anchor, or host;
4. a fake unrelated OpenClaw cron exists, but no FollowBrief LaunchAgent exists;
5. a local runtime/fetch pin differs from the contract.

Each case must exit nonzero and omit the marker.

- [ ] **Step 4: Add the successful and idempotent RED cases**

With explicit confirmation, assert the helper:

- writes the six exact account-scoped pin/owner/anchor files;
- installs `com.followbrief.library.<account_slug>` with `builder-agent-runner.sh library-cron`;
- posts `cron-status --status active` with the contract values;
- reads `cron-state` back;
- updates the contract with stable owner/anchor/completion evidence;
- emits exactly one final JSON marker with no extra properties;
- on a completed-contract retry, performs verification without reinstalling or
  changing owner/anchor.

After one successful completion, independently mutate a local pin and, in a
separate case, the fake server read-back. Re-run the completed contract and
assert both drift cases exit nonzero, omit the marker, and do not reinstall or
rewrite the changed evidence. This locks the spec's stale-completed-contract
fail-closed rule.

- [ ] **Step 5: Run the test and verify RED**

Run:

```bash
npx tsx --test tests/library-cron-install.test.ts
```

Expected: FAIL because `scripts/builder-library-cron-install.sh` does not exist.

### Task 2: Implement the proof-bound library schedule installer

**Files:**
- Create: `scripts/builder-library-cron-install.sh`
- Test: `tests/library-cron-install.test.ts`

- [ ] **Step 1: Add strict argument and contract validation**

Accept only `--contract <absolute-path>`. Use an inline Node validator to reject:

- paths outside `<agent-dir>/tmp/accounts/<slug>/library-cron-direct/`;
- filenames not matching `resume-contract-<contract instanceId>.json`;
- files not owned by the current user or writable by group/other;
- unknown keys, wrong schema/job, malformed account/slug/UUID/timestamps;
- unsupported runtime/frequency/interval/force/day/parallel values;
- `needs_confirmation` without `FOLLOWBRIEF_CONFIRM_PARTIAL=1`.

The validator must use an exact allowlist for both initial and
installer-extended contract properties. Contract creation and updates must
never copy credentials, tokens, exchange codes, prompt text, or arbitrary
environment data.

Emit only validated tab-separated primitive values to the shell; never `eval`
contract content.

- [ ] **Step 2: Allocate stable install identity**

Before scheduler mutation, atomically persist `ownerId` and `anchorAt` into the
contract if absent. Reuse them on retry. Owner reuse must retain the existing
machine-bound format:

```text
local:<hostname>:<account_slug>:library-cron:<uuid>
```

Reject pre-existing owner/anchor values that do not match the current machine,
account, job, or ISO-minute format.

- [ ] **Step 3: Write and immediately re-read pins**

Write mode-0600 account-scoped runtime, force, days, parallel, anchor, and owner
files. Re-read every file and compare exact contents to the contract before
continuing.

- [ ] **Step 4: Move the existing schedule installation mechanics into the helper**

Reuse the existing prompt behavior:

- call `schedule-spec` with the persisted anchor;
- on Darwin, write the account-scoped plist, audit bootout, wait for absence,
  enable, bootstrap, audit success, and prove `launchctl print` succeeds;
- on Linux/other, replace only this account's FollowBrief crontab row, audit the
  install, and prove the exact row exists.

Support test-boundary environment overrides for platform, launchctl, crontab,
sleep, home, and LaunchAgents directory without changing production defaults.
Do not inspect or call `openclaw cron` anywhere.

- [ ] **Step 5: Report active and verify server read-back**

Run `builder-digest.mjs cron-status` with account, frequency, label, schedule,
anchor, runtime, owner, and force. Then run `cron-state` and parse the complete
JSON response. Require active status and exact matches for runtime, frequency,
force, owner, startedAt, hostname, and the generated schedule status.

- [ ] **Step 6: Persist completion evidence and emit the marker**

Atomically add `completedAt` and verified evidence to the contract. Print the
exact marker as the final non-empty stdout line. On completed-contract retry,
skip all mutation and re-run pin/local/server verification before printing the
same marker.

- [ ] **Step 7: Run focused tests and keep them GREEN**

Run:

```bash
sh -n scripts/builder-library-cron-install.sh
npx tsx --test tests/library-cron-install.test.ts
```

Expected: syntax exit 0 and all installer tests pass.

- [ ] **Step 8: Commit the helper**

Commit the new script and focused test using the repository Lore commit format.

### Task 3: Bundle the installer transactionally

**Files:**
- Modify: `src/lib/agent-skill-files.ts`
- Modify: `scripts/install-agent-skill-bundle.cjs`
- Modify: `tests/agent-skill-bundle.test.ts`

- [ ] **Step 1: Write failing bundle assertions**

Require target `builder-library-cron-install.sh`, mode `0o755`, non-empty content,
and inclusion in the installer's `REQUIRED_TARGETS` allowlist.

- [ ] **Step 2: Run bundle test and verify RED**

Run:

```bash
npx tsx --test tests/agent-skill-bundle.test.ts
```

Expected: FAIL because the helper is not in the bundle surface.

- [ ] **Step 3: Add the bundle definition and required target**

Map `scripts/builder-library-cron-install.sh` to root target
`builder-library-cron-install.sh`, shell content type, mode 0755, and add it to
`REQUIRED_TARGETS`.

- [ ] **Step 4: Run bundle and installer tests GREEN**

Run:

```bash
npx tsx --test tests/agent-skill-bundle.test.ts
npx tsx --test tests/library-cron-install.test.ts
```

- [ ] **Step 5: Commit the bundle change**

Commit with Lore trailers including the transactional bundle constraint.

### Task 4: Replace ambiguous prompt resumption with the contract command

**Files:**
- Modify: `skills/builder-blog-digest/jobs/library-cron-setup.md`
- Modify: `tests/agent-prompt-renderer.test.ts`
- Modify: `tests/cron-job-audit.test.ts`
- Modify: `tests/user-journeys.test.ts` if affected

- [ ] **Step 1: Add failing prompt contract assertions**

Require the rendered OpenClaw child prompt to:

- create the exact UUID-named contract beside the setup verdict;
- chmod it 0600 and print its path;
- never create a contract for `fatal`;
- automatically invoke the helper for `ok`;
- for `needs_confirmation`, print and preserve exactly
  `FOLLOWBRIEF_CONFIRM_PARTIAL=1 <helper> --contract <path>`;
- explicitly forbid skills, `openclaw cron`, and manual verification jobs on the
  resumed turn;
- accept success only from helper exit zero plus the exact final-line marker;
- say the schedule is unconfirmed if marker validation fails.

Update library audit tests so installation mechanics are asserted against the
helper; keep digest setup assertions against its unchanged inline prompt.

- [ ] **Step 2: Run prompt tests and verify RED**

Run:

```bash
npx tsx --test tests/agent-prompt-renderer.test.ts tests/cron-job-audit.test.ts tests/user-journeys.test.ts
```

Expected: FAIL on missing contract/helper/marker language.

- [ ] **Step 3: Create the resume contract after verdict verification**

Parse `SETUP_VERDICT_JSON` with inline Node code. For `ok` and
`needs_confirmation`, atomically write the strict contract with rendered
runtime/frequency/fetch values and print the absolute path. For `fatal`, remove
any same-instance candidate and leave no installable artifact.

- [ ] **Step 4: Make the `ok` path invoke the helper in the same shell turn**

When the verified status is `ok`, call the helper immediately and require the
exact final-line marker. This removes the model boundary from the normal path.

- [ ] **Step 5: Make the confirmation pause self-resuming**

For `needs_confirmation`, require the assistant's pause message to include the
exact contract path and command. On later explicit confirmation, run only that
command. The prompt must forbid unrelated skills and OpenClaw cron discovery,
and it must report success only after validating the final marker.

- [ ] **Step 6: Remove inline library step 7/8 mutation blocks**

Replace duplicated launchd/crontab/status logic with the helper contract. Keep
the behavioral explanations, user confirmation gate, and failure reporting.
Digest and cloud schedule prompts remain unchanged.

- [ ] **Step 7: Run focused prompt/helper tests GREEN**

Run:

```bash
npx tsx --test tests/agent-prompt-renderer.test.ts tests/cron-job-audit.test.ts tests/user-journeys.test.ts tests/library-cron-install.test.ts
```

- [ ] **Step 8: Commit prompt integration**

Commit with Lore trailers documenting that natural-language or OpenClaw-native
cron evidence is intentionally insufficient.

### Task 5: Final verification and integration

**Files:**
- Verify all modified files

- [ ] **Step 1: Run static checks**

```bash
sh -n scripts/builder-library-cron-install.sh
sh -n scripts/builder-agent-runner.sh
npx eslint tests/library-cron-install.test.ts tests/agent-prompt-renderer.test.ts tests/cron-job-audit.test.ts tests/agent-skill-bundle.test.ts
npx tsc --noEmit
git diff --check origin/main..HEAD
```

- [ ] **Step 2: Run focused tests**

```bash
npx tsx --test tests/library-cron-install.test.ts tests/agent-prompt-renderer.test.ts tests/cron-job-audit.test.ts tests/agent-skill-bundle.test.ts tests/user-journeys.test.ts
```

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: zero failures.

- [ ] **Step 4: Review the final diff**

Confirm no command calls `openclaw cron`, no success path skips local/server
read-back, no credential is written into the contract, and the bundle installs
the helper executable transactionally.

- [ ] **Step 5: Merge, re-verify on `main`, and push**

Fast-forward `main`, rerun the relevant checks on the merged commit, push
`origin/main`, verify remote HEAD, then remove the clean feature worktree and
merged branch.
