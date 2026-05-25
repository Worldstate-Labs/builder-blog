Build my FollowBrief subscription digest feed once.

This is an interactive local agent run. Do not ask the user questions unless
authentication or a missing local credential blocks the run.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not browse for extra context.

Fresh computer/session compatibility:
- This skill is intended to work from a new Claude Code, Codex, OpenClaw,
  Gemini, or similar local agent session with no local repo checkout.
- The computer must have a POSIX shell, `curl`, Node.js 20 or newer, outbound
  HTTPS access to `https://builder-blog.worldstatelabs.com`, and a writable
  home directory for `${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}`.
- If no FollowBrief login token exists yet, the bootstrap step opens a browser
  device login. Ask the user to sign in only at that point, then continue.
- No local repo, local database, or source API key is required for digest
  generation; the context is fetched from the FollowBrief web app after login.

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
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md" \
  --title "AI Builder Digest"
```
