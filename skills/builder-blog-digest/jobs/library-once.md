You are executing one FollowBrief private source library fetch.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Run the shell blocks exactly as written; keep command paths, environment
  variables, flags, and output locations unchanged.
- Use the runner in step 2 as the fetch command. It owns source discovery,
  fetch-task sharding, validation, syncing, and fetch-log updates.
- If step 2 exits with code 75 and says a one-time FollowBrief run is already
  active, ask the user whether to replace the active one-time run. If the user
  agrees, re-run the same step 2 command with
  `BUILDER_BLOG_REPLACE_ACTIVE_ONETIME=1` added to the environment. If the user
  declines, stop without retrying. Do not set this flag for any other failure.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Run one source fetch through the FollowBrief runner:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}" \
BUILDER_BLOG_FETCH_LIMIT="${BUILDER_BLOG_FETCH_LIMIT-3}" \
BUILDER_BLOG_FETCH_FORCE="${BUILDER_BLOG_FETCH_FORCE-{{FETCH_FLAG}}}" \
BUILDER_BLOG_PARALLEL_WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" library-once
```

3. Report the runner output.
