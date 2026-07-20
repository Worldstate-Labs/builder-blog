# Interrupted Fetch Lifecycle Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure interrupted library fetches retain their linked runtime, reconcile unfinished work when possible, and never present dead work as queued.

**Architecture:** Repair source-of-truth boundaries rather than changing scheduling or outcome semantics. History queries explicitly include jobs referenced by visible fetch runs; runner termination shares checkpoint-first finalization mechanics with timeout; the UI supplies a neutral not-completed fallback for uncatchable termination; tool probing and stdout changes remain isolated.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Prisma 7, React 19, Node test runner, POSIX shell, Node.js CLI.

---

### Task 0: Commit the approved design and plan

**Files:**
- Create: `docs/superpowers/specs/2026-07-20-interrupted-fetch-lifecycle-design.md`
- Create: `docs/superpowers/plans/2026-07-20-interrupted-fetch-lifecycle.md`

- [ ] **Step 1: Verify both reviewed documents are present and contain no placeholders**

```bash
rg -n 'TO''DO|T''BD|PLACE''HOLDER' docs/superpowers/specs/2026-07-20-interrupted-fetch-lifecycle-design.md docs/superpowers/plans/2026-07-20-interrupted-fetch-lifecycle.md
```

Expected: no matches.

- [ ] **Step 2: Commit the documentation before production changes**

Commit both files with intent `Define the invariants for repairing interrupted fetch lifecycles`, including `Tested: Full pre-change suite (817 tests)` and `Scope-risk: narrow` trailers.

### Task 1: Retain jobs linked by visible fetch runs

**Files:**
- Modify: `src/lib/agent-job-runs.ts`
- Modify: `src/app/api/skill/fetch-runs/route.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Write failing history-window tests**

Add tests for pure helpers with the desired API:

```ts
agentJobRunFloorFilter({ before, linkedInstanceIds, runFloor });
scheduledAgentJobRunFloorFilter({ before, linkedInstanceIds, runFloor });
```

Assert the returned Prisma-compatible predicates retain the normal floor/cursor window and add a linked-instance branch. Cover deduped IDs, empty IDs, scheduled `expectedAt`, and cursor constraints. Update the route contract test to require collection of visible `jobRunId` values and use of both helpers.

- [ ] **Step 2: Verify the new tests fail for the missing helpers**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts tests/library-fetch-runs.test.ts
```

Expected: FAIL because linked jobs below `runFloor` are not represented.

- [ ] **Step 3: Implement minimal floor predicates and route integration**

The general helper should produce the equivalent of:

```ts
{
  AND: [
    ...(before ? [{ startedAt: { lt: before } }] : []),
    linkedIds.length
      ? { OR: [{ startedAt: { gte: runFloor } }, { instanceId: { in: linkedIds } }] }
      : { startedAt: { gte: runFloor } },
  ],
}
```

The scheduled helper retains the existing `expectedAt`/`startedAt` branches and adds `instanceId in linkedIds` only to the floor branch. In the route, collect linked IDs from the visible regular and cron runs, then spread the helper results under the existing `userId`, `jobType`, `scheduleJob`, and `trigger` predicates.

- [ ] **Step 4: Run targeted tests and inspect pagination contracts**

Run the Task 1 command again. Expected: PASS with account/job-kind and `before` predicates still asserted.

- [ ] **Step 5: Commit with a Lore message**

Commit the four Task 1 files with intent `Keep a fetch run's runtime visible across history page boundaries`, including Tested and Scope-risk trailers.

### Task 2: Reconcile catchable runtime interruptions

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `src/lib/fetch-failure-taxonomy.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/fetch-failure-taxonomy.test.ts`

- [ ] **Step 1: Lock existing timeout behavior and add failing interruption tests**

Use the existing shell-function extraction pattern in `tests/cloud-source-cli-contract.test.ts`. Add a fixture with a plan, completed checkpoint, result directory, synced-ID file, and stubbed sync functions. Assert:

1. timeout still calls checkpoint sync before remaining flush with `runtime-timeout` and `runtime_timeout`;
2. signal finalization calls the same mechanics with `runtime-interrupted` and `runtime_interrupted`;
3. no-plan returns without inventing task results;
4. signal cleanup clears the current file before the potentially failing final sync;
5. repeat signals cannot re-enter cleanup.

Add taxonomy expectations for a retryable, `notCompleted` `runtime_interrupted` reason.

- [ ] **Step 2: Verify interruption tests fail while timeout regression tests pass**

Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts tests/cloud-source-cli-contract.test.ts tests/fetch-failure-taxonomy.test.ts
```

Expected: only new interruption/taxonomy assertions fail.

- [ ] **Step 3: Extract shared finalization mechanics**

Add `flush_library_interrupted_results <label> <missing-reason>`. It resolves normal/recovery paths, initializes the synced-ID file, calls `sync_completed_checkpoints`, then calls `flush_remaining_library_results` with the caller-provided label and missing reason. Return `0` when terminal results were flushed, `2` when no fetch plan exists, and the underlying non-zero flush code when sync fails. Preserve the timeout wrapper's current job updates and externally visible return behavior by mapping these internal return codes in the wrapper.

- [ ] **Step 4: Make signal cleanup guarded, early, and best effort**

On first entry set `TRACKED_JOB_FINALIZED=1` and `trap '' TERM INT`; stop and wait for the runtime tree; stop temp processes; aggregate usage; clear the current marker; and record killed status. Gate the new finalizer and `runner_interrupted_flush_*` reasons to `library-once|library-cron`. Digest jobs must retain the existing `runner_interrupted` update and cleanup behavior. For library jobs, call the shared finalizer, record `runner_interrupted_flush_finished` on `0`, retain the initial `runner_interrupted` killed record without another update on `2` (no plan), or record `runner_interrupted_flush_failed` on other non-zero results. Then clean artifacts and exit with the existing code. Do not change schedule, worker, or timeout values.

- [ ] **Step 5: Add `runtime_interrupted` taxonomy copy**

Classify it as runtime-stage, retryable, and not completed. Use wording that the Local Agent stopped before the post reached a terminal result.

- [ ] **Step 6: Run targeted tests and shell syntax validation**

```bash
sh -n scripts/builder-agent-runner.sh
npx tsx --test tests/agent-job-runs.test.ts tests/cloud-source-cli-contract.test.ts tests/fetch-failure-taxonomy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit with a Lore message**

Commit Task 2 with intent `Prevent interrupted fetch work from remaining indefinitely active`, documenting that SIGKILL is handled by the presentation fallback in Task 3.

### Task 3: Present dead unfinished work as not completed

**Files:**
- Modify: `src/components/FetchLogPanel.tsx`
- Modify: `tests/fetch-log-panel-status.test.ts`
- Modify: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Write failing task-label tests**

Extend `taskStatusPill` tests so a pending, fetched, reading, summarizing, or summarized-but-unsynced task returns `{ label: "not completed", tone: "idle" }` when the parent cannot progress. Assert synced, skipped, failed, and action-needed labels remain unchanged. Preserve the existing test that a stopped stale run does not manufacture failed outcomes.

- [ ] **Step 2: Verify the UI tests fail on queued/reading labels**

```bash
npx tsx --test tests/fetch-log-panel-status.test.ts tests/library-fetch-runs.test.ts
```

Expected: FAIL because task rendering does not yet know parent progress state.

- [ ] **Step 3: Thread parent progress capability into task rows**

Add a boolean from the existing `RunCard` through `RunCardTaskDetails`, `DetailsBody`, and `TaskRow`. In `taskStatusPill`, preserve every terminal/action result first; before live non-terminal labels, return the neutral not-completed state when progress is impossible. Use the same condition for the task banner without changing task data, stats, or `deriveFetchRunStatusFromDetails`.

- [ ] **Step 4: Run UI tests**

Run the Task 3 command. Expected: PASS, with stopped header and neutral unfinished task state.

- [ ] **Step 5: Commit with a Lore message**

Commit Task 3 with intent `Stop describing terminal-run work as still queued`.

### Task 4: Probe ffmpeg with its supported version flag

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write a failing ffmpeg probe test**

Use `fetchYouTubeLocalAsrForTest` with a command runner that makes `ffmpeg --version` fail and `ffmpeg -version` succeed. Assert ffmpeg is probed with `-version`, local ASR proceeds, true command-not-found still produces `ffmpeg_missing`, and existing remaining-budget tests retain their call order. Update probe-order expectations only for ffmpeg; yt-dlp and all other tools must continue using `--version`.

- [ ] **Step 2: Verify RED**

```bash
npx tsx --test tests/builder-digest-cli.test.ts
```

Expected: FAIL because the implementation invokes `ffmpeg --version`.

- [ ] **Step 3: Add optional probe arguments without changing defaults**

Extend `commandExists` options with `versionArgs = ["--version"]`, pass them to `commandRunner`, and call ffmpeg with `{ ...probeOptions, versionArgs: ["-version"] }`. Do not change the success predicate.

- [ ] **Step 4: Run CLI tests and actual local smoke**

```bash
npx tsx --test tests/builder-digest-cli.test.ts
ffmpeg -version
```

Expected: tests pass and the local command exits zero.

- [ ] **Step 5: Commit with a Lore message**

Commit Task 4 with intent `Recognize an installed ffmpeg before local transcription`.

### Task 5: Keep runner output bounded

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Write failing bounded-output tests**

Create a large fetch-result fixture and extract the planned summary helper from the runner. Assert stdout is one line containing phase, status, counts, and artifact path but not task URLs or bodies, and remains below 2,048 UTF-8 bytes. Add source contracts forbidding `cat "$_result_file"` and `cat "$_adfw_out"` while requiring a one-line compact assignment-round summary.

- [ ] **Step 2: Verify RED**

```bash
npx tsx --test tests/cloud-source-cli-contract.test.ts tests/library-fetch-runs.test.ts
```

Expected: FAIL because the runner currently cats complete JSON artifacts.

- [ ] **Step 3: Add compact result and assignment summaries**

Implement a shell helper backed by a bounded Node JSON read. Call it after initial planning and successful discovery expansion. After assignment counts are parsed, print only round, assigned workers, and pending work. Do not mutate or delete the JSON files.

- [ ] **Step 4: Run targeted tests and syntax checks**

```bash
sh -n scripts/builder-agent-runner.sh
npx tsx --test tests/cloud-source-cli-contract.test.ts tests/library-fetch-runs.test.ts
```

Expected: PASS and fixture artifacts remain byte-identical.

- [ ] **Step 5: Commit with a Lore message**

Commit Task 5 with intent `Keep parent-agent output proportional to progress instead of payload size`.

### Task 6: Integrated regression verification

**Files:**
- Modify only if verification exposes a defect in the preceding task's scope.

- [ ] **Step 1: Run syntax and targeted regressions**

```bash
sh -n scripts/builder-agent-runner.sh
node --check scripts/builder-digest.mjs
npx tsx --test tests/agent-job-runs.test.ts tests/fetch-run-details.test.ts tests/fetch-log-panel-status.test.ts tests/builder-digest-cli.test.ts tests/library-fetch-runs.test.ts tests/cloud-source-cli-contract.test.ts tests/fetch-failure-taxonomy.test.ts
```

- [ ] **Step 2: Run the complete repository suite**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all commands exit zero. Existing npm audit warnings are not part of this change.

- [ ] **Step 3: Review the complete diff**

Verify no scheduler, source-limit, worker-assignment, timeout-value, schema, or migration change is present. Confirm each commit follows the Lore protocol and the worktree is clean.
