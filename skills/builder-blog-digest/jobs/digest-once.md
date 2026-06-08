Objective: generate one FollowBrief subscription digest and sync it to the
FollowBrief web app.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered steps exactly.
- If any command fails, stop and report the command, exit code, and stderr.
- Do not browse for extra context.
- Do not change paths, flags, cadence, titles, output files, JSON schema, or
  success criteria.
- Use agent judgment only for the structured summary JSON step, and only from
  the returned FollowBrief context.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Fetch the digest context and save it:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-once}"
mkdir -p "$TMP_DIR"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare {{DIGEST_REGENERATE_FLAG}} \
  > "$TMP_DIR/builder-blog-context.json"
```

3. Read:

```text
$TMP_DIR/builder-blog-context.json
```

{{INCLUDE:digest-task-contract TMP_JOB="digest-once"}}

4. Render the final digest files from the context and JSON:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-once}"
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" render-digest \
  --context "$TMP_DIR/builder-blog-context.json" \
  --agent-output "$TMP_DIR/builder-blog-digest-agent-output.json" \
  --out "$TMP_DIR/builder-blog-digest.md" \
  --summary-out "$TMP_DIR/builder-blog-digest-headlines.txt"
```

The rendered final digest is saved to:

```text
$TMP_DIR/builder-blog-digest.md
```

Save the headlineSummary to:

```text
$TMP_DIR/builder-blog-digest-headlines.txt
```

5. Sync the digest:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-once}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "$TMP_DIR/builder-blog-digest.md" \
  --summary-file "$TMP_DIR/builder-blog-digest-headlines.txt" \
  --context "$TMP_DIR/builder-blog-context.json" \
  --title "AI Builder Digest" {{DIGEST_REGENERATE_FLAG}}
```
