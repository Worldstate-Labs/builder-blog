# OpenClaw Official Cron Tool Implementation Plan

1. Update renderer regression tests to require a preparation-only shell block
   plus an explicit built-in `cron` tool call contract. Remove assertions and
   execution fixtures for CLI help probing, session enumeration, and channel
   context reconstruction. Run the focused renderer tests and confirm failure.
2. Simplify `buildOpenClawInitialRunBootstrap` so its shell block downloads the
   child prompt and emits the exact one-shot job object. Add prose instructions
   that require `cron(action: "add")`, current-session binding, success marker,
   and immediate parent-turn stop.
3. Run focused renderer and user-journey tests, then typecheck, lint, full tests,
   and `git diff --check`.
4. Review the final diff for scope: no changes to LaunchAgent/crontab install
   behavior and no remaining OpenClaw CLI scheduler/session fallback.
