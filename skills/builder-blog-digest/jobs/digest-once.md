Objective: generate one FollowBrief subscription digest once through the same
local runner path used by the scheduled digest job.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered command steps exactly.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Do not change paths, flags, output files, JSON schema, or success criteria.
- The runner owns candidate preparation, agent JSON output, rendering, syncing, and job-run lifecycle updates. Do not run lower-level FollowBrief CLI steps yourself.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Run one AI Digest build through the FollowBrief runner:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_DIGEST_REGENERATE="${BUILDER_BLOG_DIGEST_REGENERATE-{{DIGEST_REGENERATE_FLAG}}}" \
BUILDER_BLOG_JOB_TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-once}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" digest-once
```

3. Report the runner output.
