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
- Use agent judgment only for the digest-writing step, and only from the
  returned FollowBrief context.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Fetch the digest context and save it:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare --days 1 {{DIGEST_REGENERATE_FLAG}} \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json"
```

3. Read:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json
```

{{INCLUDE:digest-task-contract}}

Save the final digest to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md
```

4. Sync the digest:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md" \
  --title "AI Builder Digest" {{DIGEST_REGENERATE_FLAG}}
```
