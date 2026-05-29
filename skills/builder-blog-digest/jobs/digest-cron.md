Use the FollowBrief skill to run the scheduled subscription digest job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If any command fails, stop and write the command, exit
code, and stderr to the scheduled job log. Do not browse for extra context. Only use agent judgment to write the digest body from the FollowBrief context items.

Agent discretion boundary: this is a command-runner job except for writing the
digest body from the fetched FollowBrief context. Do not change paths, flags,
cadence, titles, output files, JSON schema, or success criteria.

The runner already downloaded the latest skill files (CLI, prompts,
sources.json) from the server before this prompt runs, so there is no install
step here.

Fetch the digest context and save it:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" prepare --days 1 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json"
```

Write the final digest to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md
```

Then sync it:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-digest.md" \
  --title "AI Builder Digest"
```

Digest rules:

- Use only `items` from `builder-blog-context.json`; do not browse the web and
  do not invent facts.
- The only creative step is writing the digest body from those items.
- Before writing, read `prompts` from `builder-blog-context.json` and use these
  five prompt bodies as the required digest-writing method:
  `summarizeTweets` (`summarize-tweets.md`) for `TWEET` items grouped by
  builder/source, `summarizePodcast` (`summarize-podcast.md`) for
  `PODCAST_EPISODE` items, `summarizeBlogs` (`summarize-blogs.md`) for
  `BLOG_POST` items, `digestIntro` (`digest-intro.md`) to assemble the final
  digest, and `translate` (`translate.md`) to produce the final natural
  simplified Chinese output.
- Do not collapse these into one generic summary. First create source-specific
  summaries with the matching prompt, then assemble them with `digestIntro`,
  then apply `translate`.
- Include source URLs for every claim.
- If there are no items, sync a short Chinese digest saying there were no new
  subscription updates in the period.
- If the run cannot complete without a missing credential or unsupported local
  capability, write the concrete reason to the scheduled job log and stop.
