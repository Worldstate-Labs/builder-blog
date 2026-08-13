# Cloud Long-Media Six-Hour Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the complete cloud long-media execution path from a four-hour ceiling to a six-hour ceiling so the observed 19,248-second task can be assigned and run.

**Architecture:** `scripts/cloud-shard-budget.mjs` remains the budget-policy source of truth. Every independent acceptance boundary that protects plan upload, shard construction, and runner execution must widen to the same 21,600-second maximum, while the finite `cloud-library-cron` outer timeout becomes 22,500 seconds to retain its 15-minute finalization buffer. The estimator, standard-work policy, liveness watchdog, heartbeat, persistence, and retry behavior remain unchanged.

**Tech Stack:** TypeScript, JavaScript, POSIX shell, Zod, Node test runner, Next.js.

---

### Task 1: Raise the shared policy and prove the observed task becomes eligible

**Files:**
- Modify: `tests/local-agent-timeouts.test.ts`
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `scripts/cloud-shard-budget.mjs`
- Modify: `config/local-agent-timeouts.json`

- [x] **Step 1: Write failing shared-policy assertions**

In `tests/local-agent-timeouts.test.ts`, change the long-media test to require a six-hour cap and assert the shipped JSON policy agrees:

```ts
test("cloud shard execution budget caps long-media workloads at 6 hours", () => {
  const budget = cloudShardExecutionBudget({ estimatedWorkSeconds: 20_000, sourceType: "podcast" });

  assert.equal(timeoutPolicy.cloudShardBudget.longMediaMaximumSeconds, 6 * 60 * 60);
  assert.equal(budget.executionBudgetSeconds, 6 * 60 * 60);
  assert.equal(budget.workloadClass, "long_media");
  assert.equal(budget.budgetReason, "capped_long_media_maximum");
});
```

- [x] **Step 2: Extend media planning coverage with the observed estimate**

In the existing `cloud planning keeps final execution budgets...` test in `tests/builder-digest-cli.test.ts`, add a `podcast_observed` builder/feed with `<itunes:duration>03:48:04</itunes:duration>` and matching cloud metadata. Assert:

```ts
const observedTask = planned.fetchTasks.find(
  (task: { builderId: string }) => task.builderId === "podcast_observed",
);
assert.equal(observedTask.mediaDurationSeconds, 13_684);
assert.equal(observedTask.estimatedWorkSeconds, 19_248);
assert.equal(observedTask.executionBudgetSeconds, 21_600);
assert.equal(observedTask.workloadClass, "long_media");
assert.equal(observedTask.budgetReason, "capped_long_media_maximum");
```

Keep the existing 5.5-hour media fixture as the over-cap case, but update its maximum evidence assertions to `21_600`.

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx tsx --test tests/local-agent-timeouts.test.ts tests/builder-digest-cli.test.ts
```

Expected: FAIL because the shared and shipped policies still cap long media at `14,400`, and the observed fixture is rejected during planning.

- [x] **Step 4: Implement the shared six-hour policy**

Change only these policy values:

```js
// scripts/cloud-shard-budget.mjs
longMediaMaximumSeconds: 21_600,
```

```json
// config/local-agent-timeouts.json
"longMediaMaximumSeconds": 21600
```

Do not change the estimator, multiplier, allowance, rounding, standard maximum, or planning comparison.

- [x] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/local-agent-timeouts.test.ts tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit the policy and planning behavior**

Commit the four files with a Lore-format message explaining that 19,248-second work is now eligible while estimates above 21,600 remain rejected.

### Task 2: Widen every transport and runtime boundary

**Files:**
- Modify: `tests/local-agent-timeouts.test.ts`
- Modify: `tests/cloud-source-contracts.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `src/lib/cloud-source-contracts.ts`
- Modify: `scripts/builder-digest.mjs`
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `config/local-agent-timeouts.json`

- [x] **Step 1: Add failing API boundary tests**

In `tests/cloud-source-contracts.test.ts`, add a valid long-media plan at exactly `21_600` and a clone at `21_601`. Assert the first parse succeeds and the second fails:

```ts
const sixHourPost = {
  postTaskId: "fetch_post:six-hour",
  estimatedWorkSeconds: 19_248,
  executionBudgetSeconds: 21_600,
  workloadClass: "long_media" as const,
  budgetReason: "capped_long_media_maximum" as const,
  deadlineState: "on_time" as const,
};
```

- [x] **Step 2: Change CLI and runner test fixtures to exercise the new boundary**

In `tests/cloud-source-cli-contract.test.ts`:

- Change the accepted `cloud-long` shard budget from `14_400` to `21_600`.
- Change the invalid assignment fixture from `17_000` to `21_601`, retaining the expected fallback to `3_600`.
- Change the runner shard-file validation test to require `21_600` from the task file.
- Change the finite cron policy fixture and deadline assertions from `15_300` to `22_500` while retaining the same 15-minute finalization-window relationships.
- Add a source assertion for the compatibility fallback equivalent to `6 * 60 * 60 + 15 * 60`, so an older install without downloaded JSON cannot retain the four-hour outer limit.
- In `tests/local-agent-timeouts.test.ts`, update every `cloud-library-cron` policy and computed-timeout assertion from `15_300`/`"15300"` to `22_500`/`"22500"`.
- In `tests/builder-digest-cli.test.ts`, require the default `BUILDER_BLOG_ASR_LOCK_TIMEOUT_MS` fallback expression to use `6 * 60 * 60 * 1000` while leaving explicit lock-timeout overrides intact.

- [x] **Step 3: Run boundary suites and verify RED**

Run:

```bash
npx tsx --test tests/cloud-source-contracts.test.ts tests/cloud-source-cli-contract.test.ts tests/builder-digest-cli.test.ts
```

Expected: FAIL because the Zod schema, CLI shard validator, runner validator, and outer timeout still reject or shorten six-hour work.

- [x] **Step 4: Implement all widened boundaries**

Apply these exact production changes:

```ts
// src/lib/cloud-source-contracts.ts
executionBudgetSeconds: z.number().int().min(60 * 60).max(6 * 60 * 60),
```

```js
// scripts/builder-digest.mjs
const MAX_CLOUD_SHARD_EXECUTION_BUDGET_SECONDS = 21_600;
```

```sh
# scripts/builder-agent-runner.sh compatibility outer timeout
cloud-library-cron) _max=$(( ( 6 * 60 * 60 ) + ( 15 * 60 ) )) ;;
```

```js
// scripts/builder-agent-runner.sh embedded shard validator
return seconds >= 3600 && seconds <= 21600 ? seconds : 0;
```

```js
// scripts/builder-digest.mjs managed ASR lock default
timeoutMs = Number(process.env.BUILDER_BLOG_ASR_LOCK_TIMEOUT_MS || 6 * 60 * 60 * 1000),
```

```json
// config/local-agent-timeouts.json
"cloud-library-cron": 22500
```

Update both `jobDefaultSeconds` and `jobMaxSeconds`. Do not change `cloud-library-host` or the legacy shard-fraction fallback.

- [x] **Step 5: Run boundary suites and verify GREEN**

Run:

```bash
npx tsx --test tests/cloud-source-contracts.test.ts tests/cloud-source-cli-contract.test.ts tests/local-agent-timeouts.test.ts tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit the synchronized boundaries**

Commit the contract, runner, config, and tests with a Lore-format message. Record that `22,500 = 21,600 + 900` preserves the existing finalization allowance.

### Task 3: Update operator copy and translations

**Files:**
- Modify: `tests/fetch-failure-taxonomy.test.ts`
- Modify: `tests/cloud-worker-task-display.test.ts`
- Modify: `tests/i18n-phrases.test.ts`
- Modify: `src/lib/fetch-failure-taxonomy.ts`
- Modify: `src/lib/i18n-phrases.ts`

- [x] **Step 1: Change copy expectations to six hours**

Update both focused tests to expect:

```text
The planned extraction workload exceeded the supported six-hour execution ceiling, so the run stopped before attempting extraction.
```

Add a focused `tests/i18n-phrases.test.ts` case that calls `translateUiPhrase` for this exact English phrase and asserts the complete expected `zh-CN`, `zh-TW`, `ja`, `ko`, and `es` translations. This proves each locale changes rather than merely proving that a translation key exists.

- [x] **Step 2: Run copy and i18n suites and verify RED**

Run:

```bash
npx tsx --test tests/fetch-failure-taxonomy.test.ts tests/cloud-worker-task-display.test.ts tests/i18n-phrases.test.ts
```

Expected: FAIL because the taxonomy still emits “four-hour”.

- [x] **Step 3: Update taxonomy and every locale phrase key/value**

Change the taxonomy operator message to “six-hour”. Replace the corresponding phrase key in `src/lib/i18n-phrases.ts`, and change the hour value in all five translations (`zh-CN`, `zh-TW`, `ja`, `ko`, `es`). Do not change the stable failure code or user-facing generic message.

- [x] **Step 4: Run copy and i18n suites and verify GREEN**

Run:

```bash
npx tsx --test tests/fetch-failure-taxonomy.test.ts tests/cloud-worker-task-display.test.ts tests/i18n-phrases.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit the operator copy**

Commit taxonomy, translations, and tests with a Lore-format message.

### Task 4: Verify the complete change

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-cloud-long-media-six-hour-budget.md` (mark completed steps)
- Verify all task-owned files.

- [x] **Step 1: Check for stale active-policy literals**

Run:

```bash
rg -n '14_400|14400|15_300|15300|four-hour|4-hour|4 hours' \
  scripts/cloud-shard-budget.mjs scripts/builder-digest.mjs scripts/builder-agent-runner.sh \
  config/local-agent-timeouts.json src/lib/cloud-source-contracts.ts \
  src/lib/fetch-failure-taxonomy.ts src/lib/i18n-phrases.ts \
  tests/local-agent-timeouts.test.ts tests/cloud-source-contracts.test.ts \
  tests/cloud-source-cli-contract.test.ts tests/builder-digest-cli.test.ts \
  tests/fetch-failure-taxonomy.test.ts tests/cloud-worker-task-display.test.ts
```

Expected: no stale four-hour policy/copy literals in active limits or assertions. Historical fixture values may remain only when they intentionally test a valid budget below the new maximum and are not described as the maximum.

- [x] **Step 2: Run directly related suites**

Run:

```bash
npx tsx --test \
  tests/local-agent-timeouts.test.ts \
  tests/cloud-source-contracts.test.ts \
  tests/cloud-source-cli-contract.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/fetch-failure-taxonomy.test.ts \
  tests/cloud-worker-task-display.test.ts \
  tests/i18n-phrases.test.ts
```

Expected: PASS.

- [x] **Step 3: Run repository quality gates**

Run:

```bash
npm test
npm run lint
```

Then run the production build while loading the main workspace environment into the isolated worktree process without copying or printing secrets:

```bash
node -e 'const { loadEnvConfig } = require("@next/env"); const { spawnSync } = require("node:child_process"); loadEnvConfig("../.."); const result = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), env: process.env, stdio: "inherit" }); process.exit(result.status ?? 1);'
```

Expected: all commands exit `0`.

- [x] **Step 4: Review and commit completion evidence**

Run `git diff --check`, inspect `git status`, mark this plan complete, and commit only task-owned changes. Do not modify persisted cloud task records or unrelated workspace files.
