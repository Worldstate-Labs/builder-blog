Use the FollowBrief skill to run the scheduled subscription digest job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If any command fails, stop and write the command, exit
code, and stderr to the scheduled job log. Do not browse for extra context. Only
use agent judgment to write the structured summary JSON from the FollowBrief
context items.

Agent discretion boundary: this is a command-runner job except for writing the
structured summary JSON from the fetched FollowBrief context. Do not
change paths, flags, cadence, titles, output files, JSON schema, or success
criteria.

The runner already downloaded the latest skill files (CLI, prompts,
sources.json) from the server before this prompt runs, so there is no install
step here.

Fetch the digest context and save it:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron}"
mkdir -p "$TMP_DIR"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare ${BUILDER_BLOG_DIGEST_REGENERATE:-} \
  > "$TMP_DIR/builder-blog-context.json"
```

{{INCLUDE:digest-task-contract TMP_JOB="digest-cron"}}

Render the final digest files from the context and JSON:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron}"
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" render-digest \
  --context "$TMP_DIR/builder-blog-context.json" \
  --agent-output "$TMP_DIR/builder-blog-digest-agent-output.json" \
  --out "$TMP_DIR/builder-blog-digest.md" \
  --summary-out "$TMP_DIR/builder-blog-digest-headlines.txt"
```

Then sync it:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "$TMP_DIR/builder-blog-digest.md" \
  --summary-file "$TMP_DIR/builder-blog-digest-headlines.txt" \
  --context "$TMP_DIR/builder-blog-context.json" \
  --title "AI Builder Digest" ${BUILDER_BLOG_DIGEST_REGENERATE:-}
```

If the run cannot complete without a missing credential or unsupported local
capability, write the concrete reason to the scheduled job log and stop.
