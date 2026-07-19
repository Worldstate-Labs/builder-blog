Complete one shard of private library fetch tasks for FollowBrief.

This is an unattended parallel worker run launched by the FollowBrief runner.
Do not ask the user questions.

You complete ONLY the fetch tasks in your assigned shard file, validate your
own shard result by following the task instructions, write it, and stop. The
runner merges every worker's result, runs `validate-agent-sync` over the
combined payload, repairs validation failures if needed, and syncs it with
`sync-builders`. Because of that, these boundaries are hard:

- Do NOT run `fetch-personal`, `expand-discovery`, `validate-agent-sync`,
  `sync-builders`, or any other syncing/cron builder-digest.mjs command.
- Do NOT complete tasks that are not in your shard file.
- Write only your shard result file (plus your own scratch files under the
  shard temp directory, if you need any).
- Do NOT use any subagent, nested agent, secondary session, or delegation
  mechanism for shard work, including Claude Task/subagent tools,
  `codex exec`, `claude -p`, `openclaw agent`, or equivalents. The FollowBrief
  runner already parallelizes shard work; delegated agents cannot write the
  required shard checkpoint/result files for this worker and will be treated as
  no checkpoint progress.
- Do NOT start background commands or tool calls (`run_in_background`, shell
  `&`, `nohup`, `disown`, detached tmux/screen, etc.) for task work. Long
  downloads, transcription, browser work, and extraction must run in the
  foreground and finish before you exit. A task is not complete until you have
  written its sync item or terminal `taskOutcomes` entry.
- For supported YouTube/podcast long-media transcription, use the deterministic
  helper
  `node "$BUILDER_BLOG_AGENT_DIR/builder-digest.mjs" extract-long-media --fetch-task-id "$FETCH_TASK_ID"`.
  Do not hand-roll yt-dlp, ffmpeg, whisper, or fixed-timeout shell commands
  for those tasks, and do not wrap them in your own background loops.

Agent discretion boundary: use the exact shard paths and JSON shapes specified
below. The shard file can be hundreds of KB because it includes all task bodies
and instructions. Do NOT `cat`, `Read`, or paste the full shard file or a
persisted tool-output copy of the full shard file. Loading the full shard before
the first checkpoint can trigger the worker watchdog. Inspect the compact task
queue first, then extract and process one task at a time.

1. Resolve your shard assignment and inspect only a compact task queue (the
runner exports all variables):

```bash
printf 'shard file: %s\n' "$BUILDER_BLOG_SHARD_FILE"
printf 'result file: %s\n' "$BUILDER_BLOG_SHARD_RESULT"
printf 'checkpoint dir: %s\n' "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR"
printf 'shard timeout seconds: %s\n' "${BUILDER_BLOG_SHARD_TIMEOUT_SECONDS:-unknown}"
node - "$BUILDER_BLOG_SHARD_FILE" <<'NODE'
const fs = require("fs");
const shardFile = process.argv[2];
const shard = JSON.parse(fs.readFileSync(shardFile, "utf8"));
const tasks = Array.isArray(shard.fetchTasks) ? shard.fetchTasks : [];
const queue = tasks.map((task, index) => ({
  index,
  id: task.id || null,
  builder: task.builder || task.builderSync?.name || task.item?.sourceName || null,
  sourceType: task.sourceType || null,
  agentWorkType: task.agentWorkType || null,
  contentStatus: task.contentStatus || null,
  title: task.item?.title || null,
  url: task.item?.url || null,
  bodyChars: typeof task.item?.body === "string" ? task.item.body.length : 0,
}));
console.log(JSON.stringify({
  shardIndex: shard.shardIndex ?? null,
  shardCount: shard.shardCount ?? null,
  taskCount: queue.length,
  tasks: queue,
}, null, 2));
NODE
```

For each task, set `FETCH_TASK_ID` from the compact queue, compute the task
hash, write the `reading` progress checkpoint first, and only then extract the
single task JSON you are about to process:

```bash
TASK_HASH="$(printf '%s' "$FETCH_TASK_ID" | shasum -a 256 | awk '{print $1}')"
mkdir -p "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/progress"
node - "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/progress/$TASK_HASH.json" "$FETCH_TASK_ID" <<'NODE'
const fs = require("fs");
const [progressFile, fetchTaskId] = process.argv.slice(2);
fs.writeFileSync(progressFile, JSON.stringify({
  fetchTaskId,
  status: "reading",
  phase: "read",
  message: "Started reading this task.",
  updatedAt: new Date().toISOString(),
}, null, 2));
NODE

TASK_FILE="$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/task-$TASK_HASH.json"
node - "$BUILDER_BLOG_SHARD_FILE" "$FETCH_TASK_ID" "$TASK_FILE" <<'NODE'
const fs = require("fs");
const [shardFile, fetchTaskId, taskFile] = process.argv.slice(2);
const shard = JSON.parse(fs.readFileSync(shardFile, "utf8"));
const tasks = Array.isArray(shard.fetchTasks) ? shard.fetchTasks : [];
const task = tasks.find((candidate, index) =>
  candidate.id === fetchTaskId || String(index) === fetchTaskId
);
if (!task) throw new Error(`Fetch task not found: ${fetchTaskId}`);
fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
console.log(taskFile);
NODE
```

Read only that extracted task file for full task details. Repeat the extraction
for the next task after writing the completed task checkpoint and full shard
result for the current task.

2. Complete every task in the shard file's `fetchTasks` array exactly as
specified below. Notes for this worker context: "the sync payload" below means
your shard result file, and report notices/blockers by printing them to stdout
(the runner copies each worker's output into the scheduled job log). The runner
validates the merged result of all workers after you exit, so follow the quality
gates below carefully — especially the 1200-character summary cap and the rule
that titles/descriptions are never primary content.

Ordering and checkpointing (protects finished work from the shard timeout —
the runner kills a worker that exceeds it, and only what is already in the
result file survives):
- Complete CHEAP tasks first: all `ready` tasks (body provided, summary only),
  then light extractions (web articles), and only then heavy extractions
  (audio/video downloads, transcription).
- For `agentWorkType: "translate_summary_only"` tasks, do NOT fetch the URL,
  download media, transcribe audio/video, or use `item.body` as source
  content. Translate only `task.summaryTranslation.sourceSummary` into the
  requested language. Leave `item.body` empty or omit it; the runner preserves
  the planned empty body.
- For `contentStatus: "ready"` tasks, do NOT fetch the URL, download media,
  transcribe audio/video, or rewrite `item.body`. The runner already fetched
  the source body. Use `task.item.body` only to write `item.summary`. To save
  tokens, omit `item.body` from the ready-task sync item; the runner restores
  the original body before validation and sync.
- After EACH completed task, write BOTH:
  - one task checkpoint JSON under `$BUILDER_BLOG_SHARD_CHECKPOINT_DIR`;
  - the full shard result file (step 3 shape, containing every item and
    outcome finished so far).
  Both files must be valid JSON, never a partial fragment. Do NOT batch
  everything into one final write: if you are terminated mid-task, every
  previously finished task must already be on disk so the runner's merge can
  keep it.
- Before starting a long foreground operation (media download, audio/video
  transcription, browser automation, or other extraction that can run for many
  minutes), compare the expected remaining work with
  `$BUILDER_BLOG_SHARD_TIMEOUT_SECONDS` when it is set. Use concrete evidence:
  media duration, failed download attempts, sampled transcription speed, and
  elapsed time. If the task cannot reasonably finish inside the shard budget
  with time left to write checkpoints and the result file, do not keep trying.
  Write a terminal `taskOutcomes` entry for that fetchTaskId instead, with
  status `failed`, reason `extraction_exceeds_shard_timeout`, and evidence that
  includes estimatedWorkSeconds/executionBudgetSeconds, media duration,
  duration/speed estimates, and attempted methods.
- If several fetch tasks point at the same unavailable or too-expensive source
  item, write one terminal outcome per fetchTaskId. Do not leave duplicate
  tasks uncovered just because they share the same URL or video ID.
- If a long foreground tool times out or fails and no remaining method can
  finish within the shard budget, immediately write the per-task checkpoint and
  full shard result with that terminal outcome. Do not leave only a progress
  checkpoint while deciding what to do next.

Task checkpoint shape:

```text
{ "builders": [{ …builderSync, "items": [items for exactly this task] }],
  "taskOutcomes": [outcome for exactly this task, if it did not sync] }
```

Use one checkpoint file per completed `fetchTaskId`. A safe filename is:

```bash
printf '%s' "$FETCH_TASK_ID" | shasum -a 256 | awk '{print $1}'
```

Then write it as `$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/<hash>.json`. The runner
uses these task-level checkpoints as the source of truth for completed work if
the worker later crashes, times out, or fails to write the final shard result.

Live progress checkpoints (for the UI only):
- Before starting each task, create
  `$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/progress/<hash>.json` with status
  `reading` and phase `read`.
- After primary content is available and before summarizing, rewrite the same
  file with status `summarizing` and phase `summarize`.
- After the task checkpoint is written, rewrite the same progress file with
  status `summarized`, `skipped`, `failed`, or `action_needed`.
- These progress files are best-effort telemetry. They do not replace the
  completed task checkpoint above, and they must live under the `progress/`
  subdirectory so the final merge never treats them as sync payloads.

Progress checkpoint shape:

```text
{ "fetchTaskId": "...",
  "status": "reading|summarizing|summarized|skipped|failed|action_needed",
  "phase": "read|summarize|completed",
  "message": "short plain-language status",
  "updatedAt": "ISO-8601 timestamp",
  "title": "optional task title",
  "builder": "optional builder name",
  "sourceType": "optional source type",
  "bodyChars": 123,
  "summaryChars": 123 }
```

{{INCLUDE:fetch-task-core REPORT_TARGET="to this worker's stdout"}}

3. Maintain the shard result at the exact path in `$BUILDER_BLOG_SHARD_RESULT`
(rewriting it after each completed task, per the checkpointing rule above),
shaped exactly like a full sync payload but covering only this shard's tasks:

```text
{ "builders": [{ …builderSync, "items": [synced items] }],
  "taskOutcomes": [non-synced task outcomes] }
```

Every fetchTaskId in your shard file must end as exactly one sync-payload item or
one `taskOutcomes` entry in this file.

4. Print one final JSON line to stdout and stop:
`{"shardDone": true, "items": <synced item count>, "taskOutcomes": <outcome count>}`
