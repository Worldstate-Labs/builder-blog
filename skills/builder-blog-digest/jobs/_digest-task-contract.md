The only creative step is writing a concise digest using only `context.items`,
in the language given by `context.language`.
Before writing, read `context.sources` and `context.digest` from the context
JSON and use them as the required digest-writing method:

- For each item, pick its summary prompt BY SOURCE TYPE, not by kind: use
  `context.sources[item.builder.sourceType].summaryPrompt.body`. This covers
  every source type — x, blog, youtube, podcast, pdf, website — and any added
  later.
- Group items by source/entity within each section.
- Use `context.digest.digestIntro` to assemble the final digest, honoring its
  section-order, source-link, and no-fabrication rules. Respect
  `context.digest.order` for section sequencing.
- Use `context.digest.translate` to produce the final natural output in
  `context.language`.

Do not collapse these into one generic summary. First create source-specific
summaries with the matching prompt, then assemble them with
`context.digest.digestIntro`, then apply `context.digest.translate` to render
the result in `context.language`. Include the source URL for every claim, do not
browse the web, and do not invent facts. If there are no items, write a short
digest in `context.language` saying there were no new subscription updates.
