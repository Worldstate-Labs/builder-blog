Use the FollowBrief skill to run the scheduled private library job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If a command outside the explicit `fetchTasks` work
fails, stop and write the command, exit code, and stderr to the scheduled job
log. Do not browse for extra context. Do not use `--force` unless the scheduled
job configuration requests a forced run.

Agent discretion boundary: this is a command-runner job unless the CLI returns
`fetchTasks` or a source requires local cookies, credentials, transcription, or
custom tooling. Do not change paths, flags, cadence, titles, output files, JSON
schema, or success criteria.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Fetch normal personal source items and save the full result:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" fetch-personal --days 30 --limit 3 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-fetch-result.json"
```

3. Print the fetch result:

```bash
cat "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-fetch-result.json"
```

4. Complete and sync the fetch tasks exactly as specified below.

{{INCLUDE:fetch-task-contract REPORT_TARGET="to the scheduled job log"}}

5. Write the fetch JSON plus any `validate-agent-sync` and `sync-builders` JSON
to the scheduled job log.
