# OpenClaw Validation Continuation Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed agent bundle complete and route OpenClaw validation continuation results back to the exact originating conversation.

**Architecture:** Preserve the existing bundle and durable continuation flows. Strengthen their boundaries: production tracing is checked against the canonical bundle manifest, and the OpenClaw main-event compatibility path resolves one exact channel-origin session before queueing.

**Tech Stack:** Next.js configuration, TypeScript prompt renderer, Node test runner, generated POSIX shell/Node snippets.

---

### Task 1: Lock production bundle tracing to the canonical manifest

**Files:**
- Modify: `tests/prompt-runtime-assets.test.ts`
- Modify: `tests/user-journeys.test.ts`
- Modify: `next.config.ts`
- Modify: `scripts/verify-prompt-runtime-traces.mjs`

- [ ] **Step 1: Write the failing test**

Import `agentSkillFiles`, derive every non-prompt manifest `sourcePath`, and
assert that both complete-runtime route traces include `./<sourcePath>`. Remove
the existing `builder-library-cron-install.sh` exemption from the older
user-journey trace assertion so both contracts enforce the same requirement.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/prompt-runtime-assets.test.ts`

Expected: FAIL because `./scripts/builder-library-cron-install.sh` is missing.

- [ ] **Step 3: Add the missing production trace asset**

Add `./scripts/builder-library-cron-install.sh` to the complete runtime trace in
`next.config.ts` and to `completeAgentRuntimeAssets` in the emitted-trace
verifier.

- [ ] **Step 4: Run the focused test**

Run: `npx tsx --test tests/prompt-runtime-assets.test.ts`

Expected: PASS.

### Task 2: Bind OpenClaw main-event jobs to the origin session

**Files:**
- Modify: `tests/agent-prompt-renderer.test.ts`
- Modify: `src/lib/agent-prompt-renderer.ts`

- [ ] **Step 1: Write renderer contract tests**

Require the rendered parent prompt to consume `OPENCLAW_CHANNEL_CONTEXT`, list
OpenClaw sessions, reject ambiguous routing, require `--session-key` capability,
and pass the resolved key to `cron add`. The tests must prove that context is a
JSON object containing at least one non-empty `chat.id` or `sender.id`, that
identity matching uses a complete colon-delimited trailing session-key segment,
and that malformed context plus zero or multiple matches all fail closed.

- [ ] **Step 2: Add a shell-level failing test**

Execute the rendered queue block with a stub `openclaw` command and fixtures for
channel context plus session listings. Assert one exact direct session reaches
`cron add`; zero and multiple matches fail before it.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test tests/agent-prompt-renderer.test.ts`

Expected: FAIL because the current prompt neither resolves nor passes a session
key.

- [ ] **Step 4: Implement strict origin-session resolution**

In the `main-event` branch, persist `openclaw sessions --json`, resolve exactly
one non-cron session owned by the configured agent and ending in a complete
colon-delimited segment equal to a non-empty `chat.id` or `sender.id` from a
valid JSON-object `OPENCLAW_CHANNEL_CONTEXT`, and pass it via `--session-key`.
Fail before queueing if the context is malformed, the capability or identity is
unavailable, or the match count is not exactly one. Leave the native
`--session current` branch unchanged.

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts`

Expected: PASS.

### Task 3: Verify and review the complete change

**Files:**
- Review all modified files

- [ ] **Step 1: Run the tracked test suite**

Run: `git ls-files 'tests/**/*.test.ts' | xargs npx tsx --test`

Expected: 0 failures.

- [ ] **Step 2: Run static checks**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: build and emitted runtime trace verification exit 0, including the
cron install helper in both complete-runtime route manifests.

- [ ] **Step 4: Review the diff and commit using the Lore protocol**

Confirm only scoped files changed, then commit the verified implementation with
the required decision-record trailers.
