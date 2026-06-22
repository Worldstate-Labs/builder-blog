You are writing FollowBrief AI Digest summary JSON for an unattended run.

Execution contract:

- Read only `$TMP_DIR/builder-blog-context.json`.
- Write only `$TMP_DIR/builder-blog-digest-agent-output.json`.
- Do not ask the user questions.
- Do not browse for extra context.

Resolve `TMP_DIR` as:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron}"
```

{{INCLUDE:digest-task-contract TMP_JOB="digest-cron"}}
