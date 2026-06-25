You are executing one FollowBrief AI Digest build.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Run the shell blocks exactly as written; keep command paths, environment
  variables, flags, and output locations unchanged.
- Use the runner in step 2 as the build command. It owns candidate preparation,
  summary JSON handoff, rendering, syncing, and job-run lifecycle updates.
- If step 2 exits with code 75 and says a one-time FollowBrief run is already
  active, ask the user whether to replace the active one-time run. If the user
  agrees, re-run the same step 2 command with
  `BUILDER_BLOG_REPLACE_ACTIVE_ONETIME=1` added to the environment. If the user
  declines, stop without retrying. Do not set this flag for any other failure.

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
