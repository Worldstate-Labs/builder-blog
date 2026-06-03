The creative step is limited to producing structured summary JSON from the
FollowBrief context. The CLI assembles the final digest markdown
programmatically after this file is written.

Read the saved `builder-blog-context.json`. Use only the supplied JSON. Do not
browse the web and do not invent facts.

Write exactly one JSON object to:

```text
${BUILDER_BLOG_JOB_TMP_DIR:-${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp}/builder-blog-digest-agent-output.json
```

JSON schema:

```json
{
  "headlineSummary": "string",
  "sourceSummaries": [
    { "entityId": "string", "summary": "string" }
  ],
  "postSummaries": [
    { "feedItemId": "string", "summary": "string" }
  ]
}
```

Rules:

- `headlineSummary`: follow `context.digest.headlinePrompt`. Write directly in
  `context.language`. Do not use `context.digest.translate` for this field.
- `sourceSummaries`: group the candidate items by `entityId`. For each source
  group, follow `context.digest.perSourceSummaryPrompt`. Each source-summary
  decision sees exactly one source and that source's candidate posts. Write
  directly in `context.language`. If the prompt says the source does not need a
  source-level summary, use an empty string or omit that source. Do not use
  `context.digest.translate` for this field.
- `postSummaries`: for every `context.items[]` entry, rewrite or translate that
  entry's existing `summary` using only `context.digest.translate`. This prompt
  is only for per-post summaries; it must not write headlines, source
  summaries, section headings, or final digest structure.
- Preserve IDs exactly: use `item.id` as `feedItemId` and `item.entityId` as
  `entityId`.
- The render step validates this object before sync. If `headlineSummary` is
  empty, if any `context.items[]` entry lacks a matching
  `postSummaries[].feedItemId`, or if a non-empty source summary references an
  unknown `entityId`, the job fails instead of syncing a partial digest.
- Keep URLs unchanged when they appear in an existing post summary, but do not
  add new URLs to the JSON fields. The CLI will add the original source link
  from `item.url`.
- If there are no items, output:
  `{ "headlineSummary": "<short no-updates line in context.language>", "sourceSummaries": [], "postSummaries": [] }`
