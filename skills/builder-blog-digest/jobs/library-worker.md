Use the FollowBrief skill to complete one shard of private library fetch
tasks.

This is an unattended parallel worker run launched by the FollowBrief runner.
Do not ask the user questions.

You complete ONLY the fetch tasks in your assigned shard file, validate your
own shard result locally, write it, and stop. The runner merges every worker's
result, runs the final `validate-agent-sync` over the combined payload, and
syncs it with `sync-builders`. Because of that, these boundaries are hard:

- Do NOT run `fetch-personal`, `expand-discovery`, `sync-builders`, or any
  other syncing/cron builder-digest.mjs command. The ONLY builder-digest.mjs
  command you run is `validate-agent-sync` scoped to your own shard (step 4) —
  it is a local read-only check and never contacts the server.
- Do NOT complete tasks that are not in your shard file.
- Write only your shard result file (plus your own scratch files under the
  shard temp directory, if you need any).

Agent discretion boundary: use the exact shard paths and JSON shapes specified
below.

1. Resolve your shard assignment and read the tasks (the runner exports both
variables):

```bash
printf 'shard file: %s\n' "$BUILDER_BLOG_SHARD_FILE"
printf 'result file: %s\n' "$BUILDER_BLOG_SHARD_RESULT"
printf 'checkpoint dir: %s\n' "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR"
cat "$BUILDER_BLOG_SHARD_FILE"
```

2. Complete every task in the shard file's `fetchTasks` array exactly as
specified below. Notes for this worker context: "the sync payload" below means
your shard result file, and report notices/blockers by printing them to stdout
(the runner copies each worker's output into the scheduled job log). You never
see validator feedback (the runner validates the merged result of all workers
after you exit), so the quality gates below are your only chance to get each
item right — especially the 1200-character summary cap and the rule that
titles/descriptions are never primary content.

Ordering and checkpointing (protects finished work from the shard timeout —
the runner kills a worker that exceeds it, and only what is already in the
result file survives):
- Complete CHEAP tasks first: all `ready` tasks (body provided, summary only),
  then light extractions (web articles), and only then heavy extractions
  (audio/video downloads, transcription).
- After EACH completed task, write BOTH:
  - one task checkpoint JSON under `$BUILDER_BLOG_SHARD_CHECKPOINT_DIR`;
  - the full shard result file (step 3 shape, containing every item and
    outcome finished so far).
  Both files must be valid JSON, never a partial fragment. Do NOT batch
  everything into one final write: if you are terminated mid-task, every
  previously finished task must already be on disk so the runner's merge can
  keep it.

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

Every fetchTaskId in your shard file must end as exactly one synced item or
one `taskOutcomes` entry in this file.

4. Validate YOUR OWN shard before reporting — your shard file is a valid
`--tasks` input, so the same validator the runner uses on the merged payload
can check your slice now, while you can still fix it:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "$BUILDER_BLOG_SHARD_FILE" \
  --file "$BUILDER_BLOG_SHARD_RESULT"
```

If it reports errors (for example `summary_too_long` or a content-quality
gate), fix the listed items in your shard result — and only those — then
re-run the command. Repeat until it prints `"status": "ok"`. Do not exit with
a result file that still fails its own shard validation.

5. Print one final JSON line to stdout and stop:
`{"shardDone": true, "items": <synced item count>, "taskOutcomes": <outcome count>}`
