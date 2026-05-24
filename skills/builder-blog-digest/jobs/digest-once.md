Build my FollowBrief subscription digest feed once.

This is an interactive local agent run. Do not ask the user questions unless
authentication or a missing local credential blocks the run.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not browse for extra context.

Agent discretion boundary: this is a command-runner task except for the explicit
digest-writing step. Do not change paths, flags, cadence, titles, output files,
JSON schema, or success criteria. Only use agent judgment to write the digest
body from the returned FollowBrief context items.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Fetch the digest context and save it:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare --days 1 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json"
```

3. Read:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json
```

The only creative step is writing a concise Chinese digest using only
`context.items`. Include source URLs when item URLs are available. If there are
no items, write a short Chinese digest saying there were no new subscription
updates.

Save the final digest to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md
```

4. Sync the digest:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md" \
  --title "AI Builder Digest"
```
