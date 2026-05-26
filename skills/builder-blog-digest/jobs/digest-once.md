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
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
BUILDER_BLOG_TOKEN="${BUILDER_BLOG_TOKEN}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare --days 1 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json"
```

3. Read:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json
```

The only creative step is writing a concise Chinese digest using only
`context.items`. Before writing, read `context.prompts` from the JSON and use
these five prompt bodies as the required digest-writing method:

- `context.prompts.summarizeTweets` (`summarize-tweets.md`) for `TWEET` items,
  grouped by builder/source.
- `context.prompts.summarizePodcast` (`summarize-podcast.md`) for
  `PODCAST_EPISODE` items.
- `context.prompts.summarizeBlogs` (`summarize-blogs.md`) for `BLOG_POST`
  items.
- `context.prompts.digestIntro` (`digest-intro.md`) to assemble the final
  digest order, source-link rules, and no-fabrication rules.
- `context.prompts.translate` (`translate.md`) to produce the final natural
  simplified Chinese output.

Do not collapse these into one generic summary. First create source-specific
summaries with the matching prompt, then assemble them with `digestIntro`, then
apply `translate`. Include source URLs for every claim. If there are no items,
write a short Chinese digest saying there were no new subscription updates.

Save the final digest to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md
```

4. Sync the digest:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
BUILDER_BLOG_TOKEN="${BUILDER_BLOG_TOKEN}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md" \
  --title "AI Builder Digest"
```
