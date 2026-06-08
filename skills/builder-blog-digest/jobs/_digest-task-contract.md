The creative step is limited to producing structured summary JSON from the
FollowBrief context. The CLI assembles the final digest markdown
programmatically after this file is written.

Read the saved `builder-blog-context.json`. Use only the supplied JSON. Do not
browse the web and do not invent facts.

Write exactly one JSON object to:

```text
$TMP_DIR/builder-blog-digest-agent-output.json
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

- Language mode: normally, write digest output in `context.language`. If
  `context.language` is `source`, use the supplied post summaries as the
  language source: write each `postSummaries[]` entry in that item's existing
  summary language, write each source summary in the dominant language of that
  source group's supplied summaries, and write `headlineSummary` in the dominant
  language of all supplied summaries. If there are no supplied summaries, use
  English for the no-updates line.
- `headlineSummary`: follow `context.digest.headlinePrompt`. It must be a
  non-empty string. Current default prompt expects one line per source in the
  form `- Source name: one sentence summary`, with each source summarized once
  even when it has multiple posts.
- `sourceSummaries`: group candidate items by `entityId` and follow
  `context.digest.perSourceSummaryPrompt` for each source group. Use an empty
  string or omit a source when the prompt says no source-level summary is needed.
- `postSummaries`: for every `context.items[]` entry, follow
  `context.digest.translate` to rewrite or translate that entry's existing
  `summary`.
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
  `{ "headlineSummary": "<no-updates line in context.language, following context.digest.headlinePrompt>", "sourceSummaries": [], "postSummaries": [] }`
