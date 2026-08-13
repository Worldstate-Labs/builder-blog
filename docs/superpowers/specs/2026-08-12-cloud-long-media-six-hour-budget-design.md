# Cloud Long-Media Six-Hour Budget Design

## Goal

Raise the cloud fetch long-media execution ceiling from four hours to six hours so conservatively estimated media work such as the observed 5-hour-20-minute podcast/video task can be assigned to a worker instead of failing during planning.

## Scope

- Change the shared `longMediaMaximumSeconds` policy from `14,400` to `21,600` seconds.
- Widen the cloud plan API validator and both CLI/runner budget validators from `14,400` to `21,600` seconds so the new budget survives plan upload, shard creation, and execution.
- Raise the finite `cloud-library-cron` outer timeout from `15,300` seconds to `22,500` seconds: six hours plus the existing fifteen-minute finalization allowance. Update both downloaded policy values and the older-install shell fallback.
- Raise the managed ASR machine-lock default wait from four hours to six hours so lock contention cannot impose a smaller absolute ceiling than the shard. The shard's remaining execution budget remains authoritative and may stop the wait earlier.
- Keep the one-hour minimum, two-hour standard-work maximum, `1.5` safety multiplier, ten-minute completion allowance, five-minute rounding, and one-minute progress heartbeat unchanged.
- Keep the existing planning rule: a non-ready long-media task whose estimated work exceeds the long-media maximum fails before assignment with `workload_exceeds_max_budget`.
- Update user-facing failure copy and all supported translations from “four-hour” to “six-hour”.
- Update focused tests and current budget-policy documentation to describe the six-hour ceiling.

## Behavior

The existing budget calculation remains:

```text
estimate = max(source conservative history, task/media estimate, workload prior)
rawBudget = estimate * 1.5 + 10 minutes
roundedBudget = ceil(rawBudget / 5 minutes) * 5 minutes

standard shard budget = clamp(roundedBudget, 1 hour, 2 hours)
long-media shard budget = clamp(roundedBudget, 1 hour, 6 hours)
```

Long-media work with `estimatedWorkSeconds <= 21,600` remains eligible for worker assignment and receives at most a six-hour execution budget. Work estimated above `21,600` seconds continues to fail before assignment. Ready-body and translation-only work continue to bypass long-media transcription estimation.

The observed task estimated at `19,248` seconds becomes eligible because it is below the new `21,600`-second ceiling. Its computed raw budget is higher than six hours, so its actual execution budget is capped at exactly six hours.

## Operational Guardrails

- The ten-minute no-progress watchdog and one-minute progress heartbeat remain unchanged, so increasing the absolute ceiling does not remove hang detection.
- The managed ASR lock's stale-owner detection and heartbeat remain unchanged; only its default maximum wait widens to match the shard ceiling.
- Per-host parallel worker lanes remain unchanged.
- The persistent `cloud-library-host` lifecycle and refill window remain unchanged; only the finite one-shot `cloud-library-cron` outer ceiling increases.
- No database migration, persisted-task rewrite, retry-policy change, or API payload-shape change is required. The plan API's accepted `executionBudgetSeconds` range is intentionally widened to six hours.
- Existing failed task records remain failed; a future cloud fetch cycle must plan the source again under the new policy.

## Testing

- Change the shared budget unit test to require a `21,600`-second long-media cap.
- Update cloud plan contract tests, CLI validation tests, runner timeout tests, and local-agent timeout-policy tests to require the widened `21,600`-second validator ceiling and `22,500`-second outer cron timeout.
- Require the managed ASR lock default to be six hours while preserving explicit environment/test overrides.
- Add or update planning coverage proving a `19,248`-second long-media estimate is accepted while an estimate above `21,600` is rejected.
- Update taxonomy and monitor-copy assertions to say “six-hour”.
- Run focused budget, planning, taxonomy, monitor, and i18n suites, followed by the full test suite, lint, and production build.

## Non-Goals

- Dynamic per-host maximums.
- Resumable or chunked media extraction.
- Raising the two-hour standard-work maximum.
- Automatically replaying historical failed tasks.
