# Fetch and Digest Luna Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Codex-backed FollowBrief Fetch and Digest run default to `gpt-5.6-luna` with `medium` reasoning while preserving explicit job overrides and usage accounting.

**Architecture:** Keep model selection centralized in the existing shared shell runner because interactive Fetch/Digest, scheduled Fetch/Digest, and the cloud Fetch host already converge there. Add shared model/reasoning defaults, feed both values into every Codex invocation, and align metadata and the existing usage-price registry without changing scheduling or prompts.

**Tech Stack:** POSIX shell, Node.js, TypeScript, Node test runner, Codex CLI configuration overrides.

---

## File Structure

- Modify `scripts/builder-agent-runner.sh`: own the shared Luna/medium defaults,
  resolve environment overrides, pass both values to all Codex execution paths,
  and align job metadata with the effective model default.
- Modify `tests/agent-job-runs.test.ts`: lock the shared defaults and every
  interactive/unattended structured/plain Codex invocation contract.
- Modify `scripts/builder-digest.mjs`: update the active help example and add
  Luna to the existing usage price registry.
- Modify `tests/usage-summary.test.ts`: prove Luna usage is labeled and costed
  at the current official short-context rates while retaining historical
  5.4-mini coverage.

No new files, dependencies, prompts, schedulers, or abstractions are needed.

### Task 1: Shared Luna Runtime Defaults

**Files:**
- Modify: `tests/agent-job-runs.test.ts:160-190`
- Modify: `scripts/builder-agent-runner.sh:49-51, 407-423, 541-565, 1275-1281`

- [ ] **Step 1: Write failing runner contract assertions**

In the existing agent job-run contract test, replace the direct 5.4-mini
metadata assertion and add focused assertions for the shared defaults and both
Codex functions:

```ts
assert.match(runner, /DEFAULT_CODEX_MODEL="gpt-5\.6-luna"/);
assert.match(runner, /DEFAULT_CODEX_REASONING_EFFORT="medium"/);
assert.match(
  runner,
  /run_with_codex\(\) \{[\s\S]*_codex_model="\$\{BUILDER_BLOG_CODEX_MODEL:-\$DEFAULT_CODEX_MODEL\}"[\s\S]*_codex_reasoning_effort="\$\{BUILDER_BLOG_CODEX_REASONING_EFFORT:-\$DEFAULT_CODEX_REASONING_EFFORT\}"[\s\S]*codex exec --json --model "\$_codex_model"[\s\S]*-c "model_reasoning_effort=\$_codex_reasoning_effort"[\s\S]*codex exec --model "\$_codex_model"[\s\S]*-c "model_reasoning_effort=\$_codex_reasoning_effort"/,
);
assert.match(
  runner,
  /run_with_codex_unattended\(\) \{[\s\S]*_codex_model="\$\{BUILDER_BLOG_CODEX_MODEL:-\$DEFAULT_CODEX_MODEL\}"[\s\S]*_codex_reasoning_effort="\$\{BUILDER_BLOG_CODEX_REASONING_EFFORT:-\$DEFAULT_CODEX_REASONING_EFFORT\}"[\s\S]*codex exec --json --model "\$_codex_model"[\s\S]*-c "model_reasoning_effort=\$_codex_reasoning_effort"[\s\S]*codex exec --model "\$_codex_model"[\s\S]*-c "model_reasoning_effort=\$_codex_reasoning_effort"/,
);
assert.match(
  runner,
  /BUILDER_BLOG_AGENT_MODEL="\$\{BUILDER_BLOG_CODEX_MODEL:-\$DEFAULT_CODEX_MODEL\}"/,
);
assert.doesNotMatch(
  runner,
  /BUILDER_BLOG_(?:CODEX_MODEL|AGENT_MODEL)[^\n]*gpt-5\.4-mini/,
);
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts
```

Expected: FAIL because the runner does not define Luna/medium defaults and does
not pass `model_reasoning_effort`.

- [ ] **Step 3: Add shared defaults and resolve overrides**

Near the runner's other constants, add:

```sh
DEFAULT_CODEX_MODEL="gpt-5.6-luna"
DEFAULT_CODEX_REASONING_EFFORT="medium"
```

In both `run_with_codex` and `run_with_codex_unattended`, resolve:

```sh
_codex_model="${BUILDER_BLOG_CODEX_MODEL:-$DEFAULT_CODEX_MODEL}"
_codex_reasoning_effort="${BUILDER_BLOG_CODEX_REASONING_EFFORT:-$DEFAULT_CODEX_REASONING_EFFORT}"
```

- [ ] **Step 4: Pass reasoning to every Codex CLI branch**

Add the following alongside the existing network config where applicable in
all four `codex exec` invocations:

```sh
-c "model_reasoning_effort=$_codex_reasoning_effort"
```

Keep `--json`, `--full-auto`, sandbox networking, working directory, prompt
input, output capture, exit handling, and usage capture unchanged.

- [ ] **Step 5: Align runtime metadata fallback**

Change the Codex branch of the existing metadata case to:

```sh
codex) BUILDER_BLOG_AGENT_MODEL="${BUILDER_BLOG_CODEX_MODEL:-$DEFAULT_CODEX_MODEL}" ;;
```

Do not change the Claude branch or reinterpret an explicit
`BUILDER_BLOG_AGENT_MODEL`.

- [ ] **Step 6: Run the focused test and verify green**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the runtime change**

```bash
git add scripts/builder-agent-runner.sh tests/agent-job-runs.test.ts
git commit -m "Keep FollowBrief Codex jobs independent of global model settings" \
  -m "Fetch and Digest now share an explicit Luna model and medium reasoning baseline while preserving per-job overrides.

Constraint: Interactive, unattended, scheduled, and cloud-hosted jobs share one runner
Rejected: Global Codex config changes | would affect unrelated Codex work
Confidence: high
Scope-risk: narrow
Tested: npx tsx --test tests/agent-job-runs.test.ts
Not-tested: Live production Luna output quality"
```

### Task 2: Luna Usage Accounting

**Files:**
- Modify: `tests/usage-summary.test.ts:169-207`
- Modify: `scripts/builder-digest.mjs:1125, 1380-1395`

- [ ] **Step 1: Write a failing Luna cost test**

Add a new test after the existing 5.4-mini historical cost test. Reuse the same
temporary JSONL shape but invoke `parse-runtime-usage` with
`--model gpt-5.6-luna`, then assert:

```ts
assert.equal(payload.usage.provider, "openai-codex");
assert.equal(payload.usage.model, "gpt-5.6-luna");
assert.equal(payload.usage.costEstimated, true);
assert.equal(payload.usage.costUsd, 1.4);
assert.equal(payload.usage.currency, "USD");
```

The `1.4` total represents one million input tokens at $0.20 plus one million
output tokens at $1.20. Keep the existing 5.4-mini test unchanged to protect
historical records.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npx tsx --test tests/usage-summary.test.ts
```

Expected: FAIL because Luna is not yet present in the default price registry.

- [ ] **Step 3: Add official Luna short-context prices**

Add both supported provider aliases to `DEFAULT_USAGE_PRICES_PER_1M`:

```js
"openai-codex:gpt-5-6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
"openai:gpt-5-6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
```

Do not remove or rewrite historical model entries.

- [ ] **Step 4: Update the active CLI help example**

Change only the `parse-runtime-usage` help example model from
`gpt-5.4-mini` to `gpt-5.6-luna`. Leave historical documentation and fixtures
outside this active help line unchanged.

- [ ] **Step 5: Run the focused test and verify green**

Run:

```bash
npx tsx --test tests/usage-summary.test.ts
```

Expected: PASS, including both Luna and historical 5.4-mini cost assertions.

- [ ] **Step 6: Commit the accounting change**

```bash
git add scripts/builder-digest.mjs tests/usage-summary.test.ts
git commit -m "Keep Luna job usage visible after the runtime migration" \
  -m "The usage parser recognizes Luna's current standard short-context rates and the CLI example reflects the active runner model without rewriting historical prices.

Constraint: The existing flat price registry cannot represent long-context tiers
Rejected: Remove 5.4-mini pricing | historical job records still need estimates
Confidence: high
Scope-risk: narrow
Tested: npx tsx --test tests/usage-summary.test.ts
Not-tested: Long-context price estimation"
```

### Task 3: Cross-Path Verification

**Files:**
- Verify: `scripts/builder-agent-runner.sh`
- Verify: `scripts/builder-digest.mjs`
- Verify: `tests/agent-job-runs.test.ts`
- Verify: `tests/usage-summary.test.ts`

- [ ] **Step 1: Search active model defaults for stale values**

Run:

```bash
rg -n 'gpt-5\.4-mini|gpt-5\.6-luna|BUILDER_BLOG_CODEX_REASONING_EFFORT|model_reasoning_effort' scripts tests docs/superpowers/specs docs/superpowers/plans
```

Expected: active runner defaults and help use Luna; 5.4-mini remains only in
historical price entries/tests or unrelated historical documents.

- [ ] **Step 2: Check shell syntax**

Run:

```bash
sh -n scripts/builder-agent-runner.sh
```

Expected: exit 0 with no output.

- [ ] **Step 3: Run focused tests together**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts tests/usage-summary.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 4: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 5: Run lint and TypeScript checks**

Run:

```bash
npm run lint
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 6: Run the production build**

Run:

```bash
npm run build
```

Expected: Next.js production build and prompt runtime trace verification pass.

- [ ] **Step 7: Inspect final scope**

Run:

```bash
git status --short
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
```

Expected: only the plan/spec plus the four intended implementation/test files
are changed across this branch; no whitespace errors.
