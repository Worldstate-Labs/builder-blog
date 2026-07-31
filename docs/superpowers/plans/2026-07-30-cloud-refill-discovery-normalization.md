# Cloud Refill Discovery Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize discovery fallback tasks in every initial and refill fetch batch before task counting so blocked Product Hunt fetches cannot become successful `0/0` cloud sources.

**Architecture:** Add one runner-owned `normalize_library_fetch_batch` boundary that invokes the existing discovery agent and `expand-discovery` command for an explicitly named batch. Both the initial path and `fetch_more_cloud_sources` call it before counting; refill-specific lease, exhaustion, replacement/merge, heartbeat, and worker behavior remain unchanged.

**Tech Stack:** POSIX shell, Node.js CLI, TypeScript `node:test`

---

## File structure

- Modify `scripts/builder-agent-runner.sh`: shared normalization helper, initial/refill integration, explicit path exports, namespaced debug/recovery artifacts.
- Modify `scripts/builder-digest.mjs`: retain cloud run/source identity on discovery terminal outcomes so cloud sync can attribute them.
- Modify `skills/builder-blog-digest/jobs/library-discovery.md`: consume explicit discovery input/output paths.
- Modify `skills/builder-blog-digest/jobs/_fetch-task-discovery.md`: document the explicit output path rather than a fixed filename.
- Modify `tests/cloud-source-cli-contract.test.ts`: shell contract and prompt-path regression coverage.

### Task 1: Lock the refill ordering and path contract

**Files:**
- Test: `tests/cloud-source-cli-contract.test.ts`

- [x] **Step 1: Add a failing discovery-only refill test**

Add a shell contract test that extracts `fetch_more_cloud_sources`, supplies a
refill containing one `candidate_discovery_fallback`, and stubs
`normalize_library_fetch_batch` to replace it with one ordinary ready task.
Assert the helper receives the refill file and a `refill-1` scope before
`library_fetch_task_count`, and assert the ready task replaces the stale
zero-task accumulated result.

- [x] **Step 2: Add failing prompt-path assertions**

Assert the discovery prompt and include use
`BUILDER_BLOG_DISCOVERY_TASKS_FILE` and
`BUILDER_BLOG_DISCOVERY_RESULT_FILE`. Assert
`openclaw_discovery_prompt_file` exports both variables.

- [x] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npx tsx --test --test-name-pattern="discovery-only refill|explicit discovery" tests/cloud-source-cli-contract.test.ts
```

Expected: FAIL because refill does not call a normalization helper and the
prompt still hardcodes fixed filenames.

### Task 2: Implement shared batch normalization

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `scripts/builder-digest.mjs`
- Modify: `skills/builder-blog-digest/jobs/library-discovery.md`
- Modify: `skills/builder-blog-digest/jobs/_fetch-task-discovery.md`
- Test: `tests/cloud-source-cli-contract.test.ts`

- [x] **Step 1: Add `normalize_library_fetch_batch`**

Implement a shell helper accepting a fetch-result path and artifact scope. It
must:

1. Return success when the input has no fallback tasks.
2. Create `"$JOB_TMP_DIR/discovery"` and scope all result, expansion, stdout,
   and stderr files beneath it.
3. Export the exact input/output paths as
   `BUILDER_BLOG_DISCOVERY_TASKS_FILE` and
   `BUILDER_BLOG_DISCOVERY_RESULT_FILE` for `run_selected_runtime`.
4. Run the existing discovery prompt.
5. Replace a missing or invalid agent result with
   `{"candidateDiscoveries":[]}`.
6. Run `builder-digest.mjs expand-discovery` into a temporary expanded file.
7. Atomically replace the input with the expanded result.
8. Fail if fallback tasks remain after expansion.

An agent-process failure is logged but does not fail the persistent host after
successful expansion; unresolved entries become existing failed outcomes.
Expansion or postcondition failure returns nonzero.

Ensure `candidateDiscoveryOutcome` retains `cloudRunId` and
`cloudSourceTaskId` on its `plannedTask`; `sync_cloud_terminal_outcomes`
requires those fields to attribute the failure to the leased source.

- [x] **Step 2: Route initial and refill batches through the helper**

Replace the inline initial discovery block with:

```sh
normalize_library_fetch_batch "$_result_file" "initial"
```

Call:

```sh
normalize_library_fetch_batch "$_fmcs_file" "refill-$_cloud_refill_count"
```

after obtaining/heartbeating the refill run ID and before
`library_fetch_task_count`. Preserve current behavior that a terminal-only
batch exhausts the current refill window and syncs its outcomes. Preserve the
existing replacement rule when accumulated executable task count is zero.

- [x] **Step 3: Make prompt paths explicit**

In `library-discovery.md`, derive:

```sh
DISCOVERY_TASKS_FILE="${BUILDER_BLOG_DISCOVERY_TASKS_FILE:-$TMP_DIR/library-fetch-result.json}"
DISCOVERY_RESULT_FILE="${BUILDER_BLOG_DISCOVERY_RESULT_FILE:-$TMP_DIR/library-discovery-result.json}"
```

Read and write those paths. Update `_fetch-task-discovery.md` to name
`$DISCOVERY_RESULT_FILE`. Update the OpenClaw wrapper to export the two concrete
paths.

- [x] **Step 4: Preserve namespaced diagnostics**

Include `"$JOB_TMP_DIR"/discovery/*.err`, `*.out`, and `*.json` in the existing
debug/recovery collection globs.

- [x] **Step 5: Add helper failure/outcome tests**

Add shell contract cases for:

- successful discovery expansion;
- agent failure or missing result becoming a failed outcome;
- blocked discovery becoming a blocked outcome;
- mixed ordinary and fallback tasks preserving the ordinary task;
- invalid expansion or leftover fallback returning nonzero;
- distinct initial/refill artifact paths.

- [x] **Step 6: Run focused tests and confirm GREEN**

Run:

```bash
npx tsx --test --test-name-pattern="discovery|cloud refill" tests/cloud-source-cli-contract.test.ts
```

Expected: PASS.

### Task 3: Verify behavior and regressions

**Files:**
- Verify all modified files.

- [x] **Step 1: Run Product Hunt/discovery CLI tests**

```bash
npx tsx --test --test-name-pattern="Product Hunt|candidate discovery" tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [x] **Step 2: Run the full cloud runner contract**

```bash
npx tsx --test tests/cloud-source-cli-contract.test.ts
```

Expected: PASS.

- [x] **Step 3: Run static validation**

```bash
sh -n scripts/builder-agent-runner.sh
npx tsc --noEmit --pretty false
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 4: Review the final diff**

Confirm the diff changes only the approved runner normalization, discovery
prompt path contract, tests, and documentation. Confirm no unrelated worktree
files are staged.
