Objective: run this user's FollowBrief private source library fetch once through
the same local runner path used by the scheduled fetch job.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered command steps exactly.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Do not change paths, flags, output files, JSON schema, or success criteria.
- The runner owns source discovery, fetch-task sharding, validation, syncing,
  and fetch-log updates. Do not run lower-level FollowBrief CLI steps yourself.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
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
