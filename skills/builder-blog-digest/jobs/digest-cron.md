Use the Builder Blog skill to run the scheduled subscription digest job.

This is an unattended scheduled run. Do not ask the user questions. Generate a
concise Chinese digest using only the context returned by Builder Blog, then
sync it back to the web app.

Before doing work, ensure the skill is installed:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

Fetch the digest context:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare --days 1
```

Write the final digest to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md
```

Then sync it:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md" \
  --title "AI Builder Digest"
```

Digest rules:

- Use only returned `items`; do not browse the web and do not invent facts.
- Include source URLs for claims when item URLs are available.
- Prioritize launches, technical insights, implementation details, business
  moves, and strong opinions.
- If there are no items, sync a short Chinese digest saying there were no new
  subscription updates in the period.
- If the run cannot complete without a missing credential or unsupported local
  capability, write the concrete reason to the scheduled job log and stop.
