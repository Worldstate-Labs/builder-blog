The only creative step is writing a concise digest using only `context.items`,
in the language given by `context.language` (defaults to simplified Chinese).
Before writing, read `context.sources` and `context.digest` from the context
JSON and use them as the required digest-writing method:

- For each `TWEET` item, group by builder/source and use
  `context.sources.x.summaryPrompt.body` as the summary prompt.
- For each `PODCAST_EPISODE` item, use
  `context.sources.podcast.summaryPrompt.body` (or
  `context.sources.youtube.summaryPrompt.body` when the item originated from a
  YouTube source) as the summary prompt.
- For each `BLOG_POST` item, use `context.sources.blog.summaryPrompt.body` as
  the summary prompt.
- Use `context.digest.digestIntro` to assemble the final digest, honoring its
  section-order, source-link, and no-fabrication rules. Respect
  `context.digest.order` for section sequencing.
- Use `context.digest.translate` to produce the final natural output in
  `context.language` (default simplified Chinese).

Do not collapse these into one generic summary. First create source-specific
summaries with the matching prompt, then assemble them with
`context.digest.digestIntro`, then apply `context.digest.translate` to render
the result in `context.language`. Include the source URL for every claim, do not
browse the web, and do not invent facts. If there are no items, write a short
digest in `context.language` saying there were no new subscription updates.
