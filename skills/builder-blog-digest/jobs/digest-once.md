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

The only creative step is writing a concise digest using only `context.items`,
in the language given by `context.language` (defaults to simplified Chinese).
Before writing, read `context.sources` and `context.digest` from the JSON and
use them as the required digest-writing method:

- For each `TWEET` item, group by builder/source and use
  `context.sources.x.summaryPrompt.body` as the summary prompt.
- For each `PODCAST_EPISODE` item, use
  `context.sources.podcast.summaryPrompt.body` (or
  `context.sources.youtube.summaryPrompt.body` when the item originated from a
  YouTube source) as the summary prompt.
- For each `BLOG_POST` item, use `context.sources.blog.summaryPrompt.body` as
  the summary prompt.
- Use `context.digest.digestIntro` to assemble the final digest order,
  source-link rules, and no-fabrication rules. Respect `context.digest.order`
  for section sequencing.
- Use `context.digest.translate` to produce the final natural output in
  `context.language` (default simplified Chinese).

Do not collapse these into one generic summary. First create source-specific
summaries with the matching prompt, then assemble them with
`context.digest.digestIntro`, then apply `context.digest.translate` to render
the result in `context.language`. Include source URLs for every claim. If there
are no items, write a short digest in `context.language` saying there were no
new subscription updates.

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
