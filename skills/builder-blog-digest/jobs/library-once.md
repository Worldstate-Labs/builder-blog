Objective: fetch this user's FollowBrief private source library once, complete
the returned fetch tasks, and sync only fully completed posts.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered command steps exactly.
- If a command outside the explicit `fetchTasks` work fails, stop and report the
  command, exit code, and stderr to the user.
- Run the fetch command exactly as written. It already carries the right
  re-fetch flag for this run (a `--force` is present only when this run was
  configured to override already-fetched posts). Do not add or remove `--force`
  yourself.
- Do not browse for extra context unless a `fetchTasks` payload requires you to
  extract content from a URL the task supplies.
- Do not change paths, flags, cadence, titles, output files, JSON schema, or
  success criteria.
- Stay in command-runner mode until the CLI returns `fetchTasks` or says a
  personal source needs local cookies, credentials, transcription, or custom
  tooling.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Fetch normal personal source items and save the full result:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-once}"
mkdir -p "$TMP_DIR"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" fetch-personal --days {{FETCH_DAYS}} --limit 3 {{FETCH_FLAG}} \
  > "$TMP_DIR/library-fetch-result.json"
```

3. Print the fetch result:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-once}"
cat "$TMP_DIR/library-fetch-result.json"
```

4. Complete and sync the fetch tasks exactly as specified below.

{{INCLUDE:fetch-task-contract REPORT_TARGET="to the user" TMP_JOB="library-once"}}

5. Report the fetch JSON plus any `validate-agent-sync` and `sync-builders` JSON.
