Use the FollowBrief skill to run the scheduled private library job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If a command outside the explicit `fetchTasks` work
fails, stop and write the command, exit code, and stderr to the scheduled job
log. Do not browse for extra context. Run the fetch command verbatim, including
the `${BUILDER_BLOG_FETCH_FORCE:-}` token — the runner sets it to `--force`
only when this schedule was configured to override already-fetched posts, and
to nothing otherwise. Do not add `--force` yourself.

Agent discretion boundary: this is a command-runner job unless the CLI returns
`fetchTasks` or a source requires local cookies, credentials, transcription, or
custom tooling. Do not change paths, flags, cadence, titles, output files, JSON
schema, or success criteria.

The runner already downloaded the latest skill files (CLI, prompts,
sources.json) from the server before this prompt runs, so there is no install
step here.

1. Fetch normal personal source items and save the full result:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron}"
mkdir -p "$TMP_DIR"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" fetch-personal --days ${BUILDER_BLOG_FETCH_DAYS:-30} --limit ${BUILDER_BLOG_FETCH_LIMIT:-3} ${BUILDER_BLOG_FETCH_FORCE:-} \
  > "$TMP_DIR/library-fetch-result.json"
```

2. Print the fetch result:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron}"
cat "$TMP_DIR/library-fetch-result.json"
```

3. Complete and sync the fetch tasks exactly as specified below.

{{INCLUDE:fetch-task-contract REPORT_TARGET="to the scheduled job log" TMP_JOB="library-cron"}}

4. Write the fetch JSON plus any `validate-agent-sync` and `sync-builders` JSON
to the scheduled job log.
