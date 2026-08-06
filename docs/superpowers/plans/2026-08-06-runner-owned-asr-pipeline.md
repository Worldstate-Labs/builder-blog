# Runner-owned ASR pipeline implementation plan

**Goal:** Let ready fetch tasks receive workers immediately while runner-owned long-media transcription proceeds serially in the background and releases each completed media task independently.

**Architecture:** The shared fetch-result JSON is the handoff boundary between a single ASR producer and the existing dynamic assignment consumer. The producer writes an atomic snapshot after each managed-media task. Queue planning defers only tasks still marked `audio_transcription`; the runner polls the queue while the producer or any worker is alive.

**Tech stack:** POSIX shell runner, Node.js ESM CLI, Node test runner, TypeScript contract tests.

---

### Task 1: Lock the queue behavior with tests

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`

Add a regression test containing one ordinary task and one unprepared managed-media task. Assert that the ordinary task is assigned immediately, the managed-media task remains pending, and no worker shard contains it. Run the focused test and confirm it fails under the current planner.

### Task 2: Lock incremental preparation persistence with tests

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`

Add a controlled two-media-task preparation test with an `onTaskSettled` callback. Assert that the first callback snapshot contains the first prepared task and the second still-deferred task, and that the final snapshot contains both prepared tasks. Run the focused test and confirm the missing callback behavior fails.

### Task 3: Defer unprepared media in dynamic queue planning

**Files:**
- Modify: `scripts/builder-digest.mjs`

Exclude `audio_transcription` tasks from runnable groups while retaining them in `pendingTasks`, so queue-drained state remains false until the producer updates or settles them. Preserve exclusions, active group limits, weights, and one-task dynamic assignment behavior.

### Task 4: Persist producer progress after every media task

**Files:**
- Modify: `scripts/builder-digest.mjs`

Extend managed-media preparation with an optional per-task settlement callback. Build snapshots that retain all unprocessed tasks, publish them atomically from the CLI, and keep the existing final summary write and counters.

### Task 5: Run the producer concurrently with model workers

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `tests/cloud-source-cli-contract.test.ts`

Split managed-media startup from completion/reaping. For the initial batch, start it before dynamic assignment without waiting. For cloud refills, merge the normalized refill into the shared queue first and then start the same asynchronous producer. Poll its state in the worker loop, keep the loop alive while it runs, checkpoint runner progress, and convert producer command failure into a job failure. Update the source contract test to require this ordering and lifecycle.

### Task 6: Verify the integrated behavior

Run focused digest and shell contract tests, shell syntax validation, lint, type checking, and the full test suite. Review the final diff for accidental changes and preserve all pre-existing untracked files.
