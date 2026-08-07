# Deterministic OpenClaw Confirmation Resume Design

**Date:** 2026-08-07

**Status:** Approved for implementation

## Problem

The recurring Fetch sources setup pauses after a safe partial initial run and
asks the user whether to install anyway. OpenClaw correctly reached that gate,
but the later confirmation arrived as a new agent turn containing only a broad
instruction to continue. The resumed turn no longer had an authoritative,
machine-readable install action. It selected an unrelated `AI Builders Digest`
OpenClaw cron job, ran it, and reported that job as the FollowBrief schedule.

The surrounding OpenClaw session then received direct contradictory evidence:
the FollowBrief LaunchAgent was not loaded and the server cron record remained
`stopped`. The workflow still relayed the model's natural-language success
claim. The web UI was correct because it renders `Stopped` whenever the
FollowBrief `LibraryCronJob.status` is not `active`.

## Goals

- Make the post-confirmation action a deterministic FollowBrief command rather
  than an open-ended agent instruction.
- Bind the action to the exact account, initial-run instance, verified verdict,
  runtime, frequency, and fetch settings that reached the confirmation gate.
- Require both local scheduler evidence and a matching active FollowBrief
  server record before emitting success.
- Prevent any OpenClaw-native cron job or unrelated skill from satisfying the
  FollowBrief completion gate.
- Preserve the existing behavior for `ok`, `needs_confirmation`, and `fatal`
  setup verdicts.

## Non-goals

- Changing which post-level failures produce `needs_confirmation`.
- Automatically approving partial initial fetches.
- Managing OpenClaw's own recurring cron jobs.
- Changing cloud fetch or digest schedule installation.
- Repairing unrelated legacy `follow-builders` jobs.

## Chosen approach

Add `scripts/builder-library-cron-install.sh` as the bundled executable
`builder-library-cron-install.sh` with mode 0755. The setup prompt creates a
mode-0600 resume contract immediately after `verify-library-setup-verdict`
succeeds. The contract contains only the validated decision and normalized
schedule inputs. It contains no bearer token or exchange code.

For an `ok` verdict, the prompt invokes the installer immediately. For a
`needs_confirmation` verdict, it reports the failed posts and the exact resume
command, then stops. After an explicit user confirmation, the only permitted
continuation is that command with `FOLLOWBRIEF_CONFIRM_PARTIAL=1`. A `fatal`
verdict never creates an installable contract.

The installer owns the existing step 7 and step 8 mechanics:

1. Validate the contract schema and the confirmation requirement.
2. Mint or reuse the machine-bound owner ID.
3. Write account-scoped runtime and fetch-setting pins.
4. Create the schedule anchor and platform schedule specification.
5. Install and verify the macOS LaunchAgent or Linux crontab entry.
6. Report `library-cron` active through `builder-digest.mjs cron-status`.
7. Read the server state back through `builder-digest.mjs cron-state`.
8. Verify account-bound local scheduler evidence plus matching server status,
   runtime, frequency, owner ID, schedule anchor, force setting, and current
   host. Re-read and compare every local runtime/fetch pin, including force,
   lookback days, and parallel worker count.
9. Mark the contract completed and print one exact success marker.

No model-authored success text is authoritative. If any step fails, the helper
exits nonzero and never prints the success marker.

## Resume contract

The contract path is exactly:

`~/.builder-blog/tmp/accounts/<account_slug>/library-cron-direct/resume-contract-<initial_run_uuid>.json`

The account slug is the existing normalized-account-plus-eight-character-hash
value used by the runner. The contract lives beside the matching
`setup-verdict-<initial_run_uuid>.json`; it never lives in the separate
`library-cron-setup-openclaw` directory that holds the queued prompt copy. It
records:

- schema version and job name;
- account and account slug;
- initial-run instance ID;
- verified verdict status (`ok` or `needs_confirmation`);
- runtime, frequency key/label, interval, force, lookback, and worker count;
- creation time;
- optional completion time and verified local/server evidence after success.

The installer rejects malformed contracts, unsupported values, `fatal`
verdicts, account/slug mismatches, missing partial confirmation, and already
completed contracts whose recorded evidence no longer matches current state.
Re-running a completed contract is allowed only as a read-only verification of
the same local and server schedule; it must not silently authorize a different
schedule.

Local verification re-reads these exact account-scoped files and compares them
to the contract:

- `runtime-library-cron-<account_slug>`;
- `fetch-force-library-cron-<account_slug>`;
- `fetch-days-library-cron-<account_slug>`;
- `parallel-library-cron-<account_slug>`;
- `schedule-anchor-library-cron-<account_slug>`;
- `cron-owner-library-cron-<account_slug>`.

The server does not store lookback days or parallel workers, so those settings
are proven by the local pin comparison. Runtime, frequency, force, owner ID,
anchor/start time, hostname, and active status are additionally compared with
the `cron-state` response.

## Success marker

The helper may write bounded diagnostics before completion. Success requires
exit code zero and this final non-empty stdout line as one complete JSON
document:

```json
{"followbriefScheduleInstall":"ok","job":"library-cron","account":"<email>","instanceId":"<uuid>","runtime":"<runtime>","frequencyKey":"<frequency>","ownerId":"<owner-id>","startedAt":"<ISO timestamp>","localScheduler":"launchd|crontab","serverStatus":"active"}
```

Every string field must exactly match the validated contract and verified
state. No extra properties are accepted by the prompt-side check. Diagnostic
text before the final line is allowed; a marker embedded in prose, an earlier
line, a partial object, a zero exit without the marker, or a marker with any
mismatched field is failure. The marker intentionally has no OpenClaw cron job
ID because OpenClaw-native cron state is not evidence for this workflow.

## Prompt contract

The setup prompt must make the pause and resume behavior explicit:

- The pause response includes the exact contract path and exact installer
  command.
- A later confirmation turn must not invoke any skill, inspect `openclaw cron`,
  or trigger a manual job.
- The assistant may report success only when the installer exits zero and its
  final non-empty stdout line is the exact `followbriefScheduleInstall` JSON
  object defined above.
- If the marker is absent, output is malformed, or verification fails, report
  that the FollowBrief schedule is not confirmed active.

The normal `ok` path uses the same installer and marker, so confirmation and
non-confirmation installs cannot drift apart.

## Failure and recovery behavior

- Contract creation failure: stop before changing scheduler state.
- Local install failure: exit nonzero; do not report active.
- Server status update or read-back failure: exit nonzero; do not report active.
- Local active but server stopped: report incomplete installation. The server
  guard prevents that local scheduler from performing a fetch until a later
  verified retry repairs the status.
- Server active but local evidence missing: exit nonzero; do not report active.
- Unrelated OpenClaw cron found: ignored; it is outside the evidence model.

## Testing

Tests will execute the real installer against temporary homes and fake
`launchctl`, `crontab`, and FollowBrief CLI boundaries. Coverage includes:

- `needs_confirmation` rejects installation without explicit confirmation;
- a matching confirmation installs and verifies the FollowBrief LaunchAgent;
- an unrelated OpenClaw cron cannot affect the result;
- local scheduler absence fails even if a fake server claims active;
- server `stopped` fails even if the local scheduler is present;
- account, runtime, owner, frequency, and anchor mismatches fail closed;
- the prompt persists the contract, prints one exact resume command, forbids
  OpenClaw cron evidence, and accepts only the helper's success marker;
- bundle and installer tests include the new executable file.

The concrete test surfaces are `tests/agent-prompt-renderer.test.ts` for the
OpenClaw parent/child prompt contract, `tests/agent-skill-bundle.test.ts` for the
new 0755 bundle target, and a focused installer execution test for contract,
local scheduler, pin, server read-back, and marker behavior.

## Rollout

The change ships through the existing versioned agent bundle. Existing
installed copies are updated when the setup prompt refreshes the bundle. No
database migration or OpenClaw configuration change is required.
