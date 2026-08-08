# OpenClaw Official Cron Tool Setup Continuation

## Problem

The OpenClaw setup prompt currently creates its durable one-shot continuation by
running `openclaw cron add` from a shell block. The CLI process does not inherit
the calling agent tool's session and delivery context, so the compatibility path
tries to reconstruct the origin from `OPENCLAW_CHANNEL_CONTEXT` and
`openclaw sessions --json`. Normal OpenClaw exec calls do not guarantee that
environment variable, which makes setup stop before the validation run.

## Scope

This change affects only the temporary OpenClaw setup continuation used to run
the first fetch/brief, validate it, and ask for confirmation when needed. The
final recurring schedule remains a macOS LaunchAgent or Linux crontab entry.

## Design

1. Keep a shell preparation block for deterministic local work only:
   - derive the account-scoped temporary directory;
   - download the child continuation prompt with the existing retry logic;
   - create a unique setup name and a timestamp 30 seconds in the future;
   - write and print the exact cron job object.
2. Instruct the active OpenClaw agent to call its built-in `cron` tool with
   `action: "add"` and that exact job object.
3. The job uses `sessionTarget: "current"`, an `at` schedule,
   `deleteAfterRun: true`, an `agentTurn` payload with the explicit setup
   timeout, and best-effort announce delivery.
4. The payload tells the continuation to read the already-downloaded local
   prompt file and follow it exactly. This keeps the tool call small and avoids
   copying a large prompt through model output.
5. Remove all shell CLI capability probing, global timeout mutation, channel
   context parsing, and session enumeration. The built-in cron tool supplies
   the caller session key and current delivery context itself.

## Failure behavior

- Preparation failure stops before any cron tool call and reports the command
  error.
- Cron tool failure reports the exact tool error and does not install the final
  recurring schedule.
- Cron tool success is reported as `FOLLOWBRIEF_OPENCLAW_QUEUED=1`; the parent
  turn stops and lets the one-shot continuation own validation and confirmation.

## Verification

- Renderer tests assert the absence of OpenClaw CLI scheduling/session routing.
- A shell-level test executes the preparation block, parses the printed job
  object, and verifies its schedule, current-session target, timeout, delivery,
  local prompt reference, and downloaded prompt contents.
- Focused tests, type checking, lint, and the repository test suite must pass.
