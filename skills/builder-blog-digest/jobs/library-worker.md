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

Agent discretion boundary: do not change paths, flags, titles, output files,
JSON schema, or success criteria.

1. Resolve your shard assignment and read the tasks (the runner exports both
variables):

```bash
printf 'shard file: %s\n' "$BUILDER_BLOG_SHARD_FILE"
printf 'result file: %s\n' "$BUILDER_BLOG_SHARD_RESULT"
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

{{INCLUDE:fetch-task-core REPORT_TARGET="to this worker's stdout"}}

3. Write the shard result to the exact path in `$BUILDER_BLOG_SHARD_RESULT`,
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
