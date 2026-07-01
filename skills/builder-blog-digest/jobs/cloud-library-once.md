You are executing one FollowBrief Cloud source library fetch as an admin.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Run the shell blocks exactly as written; keep command paths, environment
  variables, flags, and output locations unchanged.
- The runner leases a batch of cloud source tasks from FollowBrief, fetches and
  summarizes them, and syncs the results back to the cloud language libraries. It
  owns leasing, fetch-task sharding, validation, syncing, and cloud run status
  updates. This account must have admin Cloud Fetch access.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Run one cloud source fetch through the FollowBrief runner:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_RUN_SOURCE=cloud \
BUILDER_BLOG_CLOUD_FETCH_LIMIT="${BUILDER_BLOG_CLOUD_FETCH_LIMIT-10}" \
BUILDER_BLOG_FETCH_LIMIT="${BUILDER_BLOG_FETCH_LIMIT-3}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" cloud-library-cron
```

3. Report the runner output, including how many cloud source tasks were leased,
   how many succeeded, and how many failed.
