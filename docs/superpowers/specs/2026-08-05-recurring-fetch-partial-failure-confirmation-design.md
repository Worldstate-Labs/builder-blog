# Recurring Fetch Partial-Failure Confirmation

**Status:** Approved for implementation
**Date:** 2026-08-05  
**Scope:** Regular-user `library-cron-setup` for Claude Code, Codex, and OpenClaw

## Problem

The recurring Fetch sources setup performs one real `library-cron` run before
installing launchd or crontab. The runner intentionally returns exit code `65`
when a fetch round finishes with one or more worker, validation, discovery, or
sync-slice issues. The setup prompt, however, stops on every non-zero exit and
only runs its post-task confirmation gate after exit code `0`.

This makes the intended confirmation path unreachable for a safe partial
result such as 29 successfully synchronized shards plus one headline rejected
by deterministic validation. The failed task can already be recorded as a
terminal outcome, but the setup stops without asking whether the user still
wants the recurring schedule.

The current gate also reads files from the stable setup directory after the
tracked runner has moved artifacts into a per-run directory and cleaned that
directory. A successful run can therefore leave the gate reading absent or
stale files. The repair must replace this implicit artifact discovery with an
explicit, durable setup verdict.

OpenClaw adds a separate control-flow problem. Its parent setup queues steps
6-8 as a one-shot `--session isolated` cron turn and rewrites the child prompt
to forbid confirmation. Although OpenClaw can deliver the final question to a
chat, an isolated run does not preserve the active conversation needed for the
user's reply to continue steps 7-8.

## Goals

- Ask before installing when an initial fetch has only durably accounted,
  post-level failures.
- Continue automatically when the initial fetch has no failed post tasks.
- Stop without asking on authentication, timeout, missing/corrupt artifact,
  incomplete terminal coverage, or unsynchronized-result failures.
- Preserve the runner's existing exit codes and server-visible failed/partial
  lifecycle semantics.
- Give Claude Code, Codex, and OpenClaw a functional explicit-confirmation path.
- Keep recurring schedule installation last and keep existing override safety,
  account isolation, runtime pins, and launchd/crontab behavior unchanged.

## Non-goals

- Do not auto-install based on a failure-count or failure-percentage threshold.
- Do not weaken headline, summary, task-coverage, or server sync validation.
- Do not reinterpret arbitrary exit code `65` as safe.
- Do not change recurring fetch execution after the schedule is installed.
- Do not change digest recurring setup or admin Cloud fetch host setup.
- Do not add a database migration or new server API.

## Considered Approaches

### 1. Ask after every exit code 65

Rejected. Exit code `65` covers both safely accounted task failures and hard
failures such as incomplete sync. Treating the code alone as authorization to
install can schedule a pipeline that never proved it can persist terminal
results.

### 2. Return exit code 0 for safely accounted partial runs

Rejected. It would make the existing prompt gate reachable, but it would also
misrepresent the tracked run as successful and weaken existing operational
signals. Exit status and schedule-install eligibility are related but distinct
contracts.

### 3. Produce a durable three-state setup verdict

Selected. The runner retains its exit code while a deterministic classifier,
executed before per-run cleanup, writes an explicit verdict to the stable setup
state directory. The setup prompt branches on that verdict instead of branching
on the raw exit code alone.

## Design

### 1. Setup-run declaration and durable verdict path

Step 6 will generate one opaque UUID before starting the runner and declare that
this direct worker invocation is a setup proof by passing a dedicated environment
flag, the UUID as the runner's job-run identity, and a UUID-bearing verdict path
under the existing stable setup state directory:

```text
BUILDER_BLOG_SETUP_INITIAL=1
BUILDER_BLOG_JOB_RUN_ID=<setup UUID>
BUILDER_BLOG_SETUP_VERDICT_FILE=<library-cron-direct>/setup-verdict-<setup UUID>.json
```

The prompt retains the same UUID as `EXPECTED_INSTANCE_ID`. Before starting the
runner, it removes only that exact UUID-bearing verdict file. The runner validates
that the requested verdict is a normal file path directly under its owned
`JOB_STATE_DIR`; it must reject symlinks, traversal, and paths outside that
directory. Verdict writes are atomic and mode `0600`.

Normal one-time fetches, installed recurring runs, digest jobs, and Cloud jobs
do not set the flag and do not produce this artifact.

### 2. Verdict generation before cleanup

`run_with_job_tracking` knows the final runner exit code while the current
per-run directory still exists. For declared `library-cron` setup proofs, it
invokes a deterministic classifier before `cleanup_job_tmp_dir`.

The classifier uses only regular, non-symlink files owned by the current run.
These inputs are authoritative for every run:

- `$JOB_TMP_DIR/.run-owner.json`, whose account, job type, and instance ID must
  exactly match the active setup run;
- `$JOB_TMP_DIR/library-fetch-result.json`, the normalized fetch response used to
  establish whether the run has zero post tasks or entered post-task processing;
- the final runner exit code held by `run_with_job_tracking`.

For a run with one or more non-discovery tasks (ordinary post tasks or
user-action tasks), all of these additional files are required:

- `$JOB_TMP_DIR/library-fetch-merged.json`, the authoritative final planned task
  set after discovery expansion, media handling, and result merging;
- `$JOB_TMP_DIR/library-agent-sync.json`, the canonical merged sync payload;
- `$JOB_TMP_DIR/completed-checkpoint-synced-task-ids.txt`, the durable acceptance
  ledger. A task ID enters this ledger only after its normal result or synthesized
  failure patch is accepted by FollowBrief; server-terminal IDs observed during
  the same run may also appear;
- `$JOB_TMP_DIR/merge-task-results.json` and
  `$JOB_TMP_DIR/merge-task-results-remaining.json`, the two merge reports that
  prove the runner completed both merge phases.

The per-slice
`library-result-slice-*-validation-failed-payload.json` and
`library-result-slice-*-failed-payload.json` files are conditional inputs. When
present, they supersede that slice's pre-validation result for the corresponding
task. Every failure they describe must also appear in the durable acceptance
ledger.

A zero-non-discovery-task run is a narrow exception because the runner returns
before creating merge artifacts or the acceptance ledger. It may classify as
`ok` only when the runner exits `0`, the authoritative always-required files
parse, there is no failed candidate-discovery outcome, and every source terminal
outcome in `library-fetch-result.json` is well formed and its sync path completed
successfully. A zero-non-discovery-task run can never be `needs_confirmation`.
An action-needed-only run is not this exception: user-action tasks take the
normal merge/sync path and require durable acceptance-ledger coverage.

Missing required inputs are fatal. Logs, prose, directory modification times,
and a "latest" verdict are never authoritative.

The verdict schema is closed and versioned:

```json
{
  "schemaVersion": 1,
  "status": "ok | needs_confirmation | fatal",
  "runnerExitCode": 0,
  "instanceId": "...",
  "plannedTaskCount": 0,
  "synchronizedTerminalTaskCount": 0,
  "failures": [
    {
      "fetchTaskId": "...",
      "title": "...",
      "source": "...",
      "stage": "read | summarize | sync",
      "reason": "..."
    }
  ]
}
```

All strings and list sizes are bounded. The file contains no bearer token,
exchange code, raw fetched body, or provider response.

### 3. Classification rules

The classifier is fail-closed.

Failure eligibility is explicit:

- only ordinary post-fetch task failures that have a durable acceptance-ledger
  entry may produce `needs_confirmation`;
- `candidate_discovery_fallback` outcomes are discovery control-plane work, not
  post-fetch tasks, and any failed discovery outcome is `fatal` for this change;
- valid `user_action_*`, `x_token_missing`, and `x_token_invalid` outcomes with
  `action_needed` status describe an expected user action rather than a fetch
  failure, so they do not require confirmation and may coexist with `ok`;
- a failed or malformed user-action outcome is `fatal`.

`ok` requires all of the following:

- runner exit code is `0`;
- all inputs required for the run shape parse successfully;
- every planned ordinary post-fetch task and user-action task is represented by
  a durable acceptance-ledger entry, except in the defined zero-non-discovery-
  task path;
- no failed ordinary post-fetch or candidate-discovery outcome remains;
- every user-action outcome, if present, is a well-formed `action_needed` outcome.

`needs_confirmation` requires all of the following:

- runner exit code is `65`;
- all inputs required for the one-or-more-non-discovery-task run shape parse
  successfully;
- every planned ordinary post-fetch task is represented by a durable acceptance-
  ledger entry;
- at least one bounded ordinary post-fetch task failure is present and every such
  failure has a durable acceptance-ledger entry;
- no failed candidate-discovery outcome and no failed or malformed user-action
  outcome is present;
- no global authentication, timeout, missing-artifact, ownership, or incomplete
  synchronization condition is present.

Missing result files that were deterministically converted to failed ordinary
post-task outcomes and successfully synchronized may qualify. A missing or
failed candidate-discovery result, or a failed attempt to sync a post-task
terminal outcome, does not qualify.

Every other state is `fatal`, including a missing or malformed artifact,
incomplete planned-task coverage, non-`0`/non-`65` exit, timeout, authentication
failure, or inability to prove that failure outcomes reached FollowBrief.

If verdict generation itself fails, the runner leaves no usable verdict and
the setup treats that exactly like `fatal`.

### 4. Prompt control flow

Step 6 captures the runner code without aborting the setup shell block, then
requires the UUID-bearing verdict file. It accepts the verdict only when
`verdict.instanceId === EXPECTED_INSTANCE_ID`; it never consults `current.json`,
directory modification times, or whichever verdict happens to be newest.

- `ok`: report a clean proof and continue automatically to step 7.
- `needs_confirmation`: list every bounded failure with title, source, stage,
  and reason; ask whether to install anyway; continue only after explicit yes.
- `fatal`, missing, malformed, stale-instance, or extra-field verdict: report
  the runner code and bounded failure information, then stop without installing.

The prompt opening will explicitly permit questions in both the existing-
schedule check and the post-proof partial-failure check. It will no longer say
that step 3 is the only confirmation point.

The prompt never allows an LLM to upgrade `fatal` to `needs_confirmation` from
its own interpretation of stderr.

### 5. Runtime-specific continuation

Claude Code and Codex keep the common interactive setup flow. Their current
conversation asks the question and resumes step 7 only after an explicit yes.

For OpenClaw, the one-shot setup continuation must bind to a persistent
interactive session instead of `--session isolated`. The renderer chooses the
strongest mode advertised by the installed CLI:

- when `openclaw cron add --help` advertises `current`, queue the existing agent
  message with `--session current`; the
  [OpenClaw cron CLI contract](https://docs.openclaw.ai/cli/cron) defines this as
  binding the scheduled turn to the active session at creation time;
- for the locally supported OpenClaw `2026.5.20` compatibility contract, whose
  help advertises only `main|isolated`, queue the continuation into
  `--session main` as a `--system-event` with `--wake now`;
- if neither compatible persistent-session form is advertised, fail closed
  before creating the one-shot job. Never fall back to an isolated session.

The 30-second delayed start remains so the parent setup turn can finish before
the continuation runs.

The OpenClaw renderer will stop replacing `needs_confirmation` with an
unattended hard stop, and will remove the child preamble that forbids waiting
for confirmation. When the continuation ends its turn with a question, the
user's next reply is a new turn in the selected persistent session and can
continue steps 7-8 from the existing prompt context.

The one-shot setup job remains separate from the installed recurring schedule.
The recurring schedule is still launchd on macOS or crontab on Linux, and its
fetch workers continue using isolated deterministic OpenClaw worker sessions.

### 6. Installation and reporting invariants

Steps 7 and 8 remain unchanged apart from their predecessor gate:

- no pin, anchor, plist, crontab entry, or server `active` status is written
  before `ok` or explicit approval of `needs_confirmation`;
- declining or abandoning the question leaves no new schedule;
- an override leaves the old schedule in place until the new proof is accepted
  and the existing atomic replacement block runs;
- `fatal` never removes or replaces an existing schedule;
- another account's pins and schedules remain untouched.

## Error Handling

- Stale verdicts are prevented by using the prompt-generated UUID in both the
  verdict filename and `BUILDER_BLOG_JOB_RUN_ID`, deleting only that exact target
  before the run, and requiring exact `instanceId` equality afterward.
- A malformed, duplicate-key, extra-field, unbounded, or wrong-version verdict
  is fatal.
- A setup proof timeout remains fatal even if cleanup synchronized some terminal
  work; timeout is not an interactive-install approval state.
- Failure details shown to the user are bounded and sanitized.
- OpenClaw delivery is best effort as it is today. If the question is not
  delivered or the user never replies, no schedule is installed.

## Testing

### Deterministic classifier tests

- exit `0`, complete synchronized coverage, no failures -> `ok`;
- exit `65`, 29 synchronized successes plus one synchronized
  `headline_too_long` failure -> `needs_confirmation`;
- exit `65`, missing shard converted to a synchronized terminal failure ->
  `needs_confirmation`;
- exit `65`, failure-patch sync failed -> `fatal`;
- exit `65`, incomplete task-id coverage -> `fatal`;
- failed candidate-discovery outcome -> `fatal`;
- valid user-action `action_needed` outcome alone does not require confirmation;
- failed or malformed user-action outcome -> `fatal`;
- timeout/auth/non-65 infrastructure exit -> `fatal`;
- corrupt/missing/stale/extra-field inputs fail closed;
- verdict output is atomic, mode `0600`, bounded, and contains no secret fields.

### Prompt and renderer contract tests

- step 6 captures the runner exit and reads the durable verdict even when the
  exit is `65`;
- `needs_confirmation` requires explicit approval and decline leaves step 7
  unreachable;
- `fatal` never reaches schedule installation;
- Claude Code and Codex retain the interactive question;
- OpenClaw parent prefers `--session current`, uses the `2026.5.20`
  `--session main --system-event --wake now` compatibility path when needed,
  and never uses `isolated`;
- OpenClaw child retains the common confirmation wording and does not contain
  the unattended no-confirmation rewrite;
- existing credential, existing-schedule override, runtime pinning,
  launchd/crontab ordering, and server status assertions continue to pass.

### Verification

- focused prompt/renderer, CLI, runner-contract, and user-journey tests;
- shell syntax validation;
- ESLint and TypeScript checks;
- full test suite and production build.

## Rollout and Compatibility

This is a prompt/runner/CLI contract change with no database migration. Existing
installed schedules are unaffected. A newly copied setup prompt refreshes the
local skill and therefore receives the matching runner and CLI before executing
the new verdict flow.

If an older cached prompt calls a newer runner, it does not set the setup flag
and retains the old fail-closed behavior. If a newer prompt somehow reaches an
older runner, the verdict is absent and the setup stops without installing.
Both mixed-version directions fail closed.
