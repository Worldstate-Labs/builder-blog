# OpenClaw Validation Continuation Delivery Design

## Problem

An OpenClaw recurring-fetch setup continuation was queued and started, but the
validation run failed before producing a setup verdict. The deployed
`/api/skill/bundle` endpoint returned HTTP 500 because the newly required
`scripts/builder-library-cron-install.sh` asset was listed in the runtime bundle
but omitted from Next.js production output tracing. OpenClaw then attempted to
report the failure from a cron-owned session with no delivery context, so its
implicit message target resolved to `@heartbeat` and the user saw no failure.

## Requirements

1. Every non-prompt source file in the canonical agent skill bundle must be
   included in the production traces for both the individual file route and the
   bundle route.
2. Tests must compare the canonical bundle manifest with the trace contract so
   a newly added runtime file cannot be omitted silently.
3. The OpenClaw `main`/`system-event` compatibility path must bind the queued
   continuation to the exact channel-origin session that requested setup.
4. Session routing must fail closed when the current channel identity is
   missing, malformed, or maps to zero or multiple active sessions. It must
   never select a merely recent conversation.
5. Existing OpenClaw versions that provide native `--session current` behavior
   keep that path unchanged.
6. Fetch, verdict classification, confirmation, and schedule installation
   semantics remain unchanged.

## Design

### Production asset tracing

Add `./scripts/builder-library-cron-install.sh` to the complete runtime trace in
`next.config.ts` and to the production trace verifier. Extend
`tests/prompt-runtime-assets.test.ts` to derive required exact assets from the
canonical `agentSkillFiles` manifest. Prompt markdown files remain covered by
the existing directory glob; every other manifest source path must appear
exactly in both complete-runtime route trace lists.

### Origin-session binding

OpenClaw exposes `OPENCLAW_CHANNEL_CONTEXT` to shell commands started by a
channel-origin turn. In the `main-event` compatibility branch, write the output
of `openclaw sessions --json` to an account-scoped temporary file and resolve a
session key with a small Node program. The resolver:

- accepts only a JSON object with a non-empty `chat.id` or `sender.id`;
- accepts only session keys owned by the configured OpenClaw agent;
- excludes cron-owned session keys;
- matches an identity only on a complete colon-delimited trailing key segment;
- requires exactly one match.

Keep the existing `--session main --system-event ... --wake now` command shape
and add that exact key through `openclaw cron add --session-key`. OpenClaw then
wakes the original channel session, whose delivery context permits the existing
failure report and partial-result confirmation question to reach the user.
Capability detection must require `--session-key` before selecting this branch.

## Error Handling

- A missing or ambiguous origin session prevents the continuation from being
  queued and prints a specific routing error.
- Failure to list sessions prevents queueing.
- The one-shot job remains delete-after-run and no fallback recipient is
  guessed.
- Bundle construction remains all-or-nothing; production tracing prevents the
  known missing-file deployment failure.

## Testing

- A production asset test fails against the current omission and passes only
  after the helper is traced.
- Prompt rendering tests require channel-context parsing, strict session
  resolution, capability detection, and `--session-key` on the main-event job.
- A shell-level prompt test uses a stub OpenClaw CLI to prove the exact direct
  session key is passed and ambiguous/no-match inputs fail before `cron add`.
- Run focused tests, the complete tracked test suite, type checking, lint, and a
  production build including emitted trace verification.
