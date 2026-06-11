Use the FollowBrief skill to run the private library candidate-discovery
pre-pass.

This is an unattended pre-pass launched by the FollowBrief runner before fetch
tasks are sharded across parallel workers. Do not ask the user questions.

Complete ONLY the `candidate_discovery_fallback` tasks in the fetch result,
expand them with the CLI, and stop. Do NOT complete normal post fetch tasks,
do NOT summarize posts, and do NOT run `validate-agent-sync` or
`sync-builders` — the parallel workers and the runner handle everything after
expansion.

Agent discretion boundary: do not change paths, flags, titles, output files,
JSON schema, or success criteria.

1. Read the fetch result (the runner sets `BUILDER_BLOG_JOB_TMP_DIR`):

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron}"
cat "$TMP_DIR/library-fetch-result.json"
```

2. Complete the discovery tasks and expand them exactly as specified below.

{{INCLUDE:fetch-task-discovery TMP_JOB="library-cron"}}

3. After the `mv` above succeeds, print the expanded result's `fetchTasks`
count and stop. Do not start fetching the expanded post tasks.
