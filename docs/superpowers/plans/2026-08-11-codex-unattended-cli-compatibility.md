# Codex Unattended CLI Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Codex fetch workers on CLI releases that reject `--full-auto`, catch future argument drift during preflight, and record the installed Codex version.

**Architecture:** Add one POSIX-shell helper that owns the explicit unattended Codex argument contract and route both the model preflight and worker execution through it. Capture the resolved Codex version once, propagate it through the existing job-update command, and store it in `AgentJobRun.details.runtimeVersion`.

**Tech Stack:** POSIX shell, Node.js/TypeScript test runner, builder-digest CLI, Prisma-backed agent job records.

---

### Task 1: Lock the unattended Codex argument contract

**Files:**
- Modify: `tests/library-fetch-runs.test.ts`
- Modify: `tests/user-journeys.test.ts`

- [ ] **Step 1: Write the failing fake-CLI regression test**

Add a test that extracts the planned `run_codex_exec_unattended` shell helper, puts a fake `codex` binary first on `PATH`, and invokes the helper. The fake binary must exit nonzero if it sees `--full-auto`, record all arguments, and otherwise succeed. Assert that the recorded arguments contain:

```text
exec
--sandbox
workspace-write
approval_policy="never"
sandbox_workspace_write.network_access=true
```

Also update the user-journey contract to reject `--full-auto` and require the explicit sandbox and approval settings.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx tsx --test tests/library-fetch-runs.test.ts tests/user-journeys.test.ts
```

Expected: FAIL because `run_codex_exec_unattended` does not exist and the runner still contains `--full-auto`.

### Task 2: Route preflight and workers through the stable command

**Files:**
- Modify: `scripts/builder-agent-runner.sh`

- [ ] **Step 1: Add the minimal shared helper**

Add a POSIX-shell function that accepts model and reasoning effort plus optional Codex flags, then executes:

```sh
codex exec "$@" --model "$model" --skip-git-repo-check \
  --sandbox workspace-write \
  -c 'approval_policy="never"' \
  -c sandbox_workspace_write.network_access=true \
  -c "model_reasoning_effort=$effort" \
  -C "$AGENT_DIR" -
```

Use unique function-scoped variable prefixes because POSIX `sh` has no portable `local` requirement in this script.

- [ ] **Step 2: Replace both divergent call sites**

Call the helper from `probe_codex_model` with `--json` and from both structured and plain branches of `run_with_codex_unattended`. Leave interactive `run_with_codex` unchanged.

- [ ] **Step 3: Run the focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/library-fetch-runs.test.ts tests/user-journeys.test.ts
```

Expected: PASS.

### Task 3: Persist Codex runtime-version evidence

**Files:**
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `scripts/builder-digest.mjs`

- [ ] **Step 1: Write the failing metadata contract test**

Extend the existing agent-job-run contract test to require:

```text
BUILDER_BLOG_RUNTIME_VERSION
--runtime-version
details.runtimeVersion
```

The test must also require that version capture is best-effort and occurs only for the resolved Codex runtime.

- [ ] **Step 2: Run the focused metadata test and verify RED**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts
```

Expected: FAIL because the runner and builder-digest CLI do not propagate runtime version metadata.

- [ ] **Step 3: Implement minimal version capture and propagation**

After resolving `BUILDER_BLOG_RUNTIME`, capture the first bounded line of `codex --version` without allowing failure to stop the run, export it as `BUILDER_BLOG_RUNTIME_VERSION`, pass it to `job-run-update` as `--runtime-version`, and serialize it as `details.runtimeVersion` when nonempty.

- [ ] **Step 4: Run the focused metadata test and verify GREEN**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts
```

Expected: PASS.

### Task 4: Verify the production symptom and regression surface

**Files:**
- Verify: `scripts/builder-agent-runner.sh`
- Verify: related test suites

- [ ] **Step 1: Smoke-check the installed Codex parser**

Run:

```bash
codex exec --json --model gpt-5.6-luna --skip-git-repo-check \
  --sandbox workspace-write \
  -c 'approval_policy="never"' \
  -c sandbox_workspace_write.network_access=true \
  -c 'model_reasoning_effort="medium"' \
  -C "$PWD" --help
```

Expected: exit 0 with Codex exec help and no unexpected-argument error.

- [ ] **Step 2: Run all directly related tests**

Run:

```bash
npx tsx --test tests/library-fetch-runs.test.ts tests/user-journeys.test.ts tests/agent-job-runs.test.ts tests/agent-prompt-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run repository quality gates**

Run sequentially:

```bash
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Review the final diff and commit only task-owned hunks**

Preserve the unrelated pre-existing modifications in the dirty worktree. Stage only the Codex compatibility hunks and use a Lore-format commit documenting the rejected unsafe bypass.

