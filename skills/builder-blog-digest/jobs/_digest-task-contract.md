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
  non-empty string and must be 1200 characters or fewer. Before writing the JSON,
  count or conservatively estimate the final string length. If the headline
  would be too long, shorten lines or combine related / lower-priority sources
  into one line such as `- Source A and Source B: one sentence summary`. Current
  default prompt expects compact source lines in the form
  `- Source name: one sentence summary`, with each source covered once even when
  it has multiple posts.
- `sourceSummaries`: group candidate items by `entityId` and follow
  `context.digest.perSourceSummaryPrompt` for each source group. Use an empty
  string or omit a source when the prompt says no source-level summary is needed.
- `postSummaries`: for every `context.items[]` entry, follow
  `context.digest.translate` to rewrite or translate that entry's existing
  `summary`.
- Preserve IDs exactly: use `item.id` as `feedItemId` and `item.entityId` as
  `entityId`.
- The render step validates this object before sync. If `headlineSummary` is
  empty or longer than 1200 characters, if any `context.items[]` entry lacks a matching
  `postSummaries[].feedItemId`, or if a non-empty source summary references an
  unknown `entityId`, the job fails instead of syncing a partial digest.
- Keep URLs unchanged when they appear in an existing post summary, but do not
  add new URLs to the JSON fields. The CLI will add the original source link
  from `item.url`.
- If there are no items, output:
  `{ "headlineSummary": "<no-updates line in context.language, following context.digest.headlinePrompt>", "sourceSummaries": [], "postSummaries": [] }`

Before proceeding to the render command, reopen
`$TMP_DIR/builder-blog-digest-agent-output.json` and self-check the saved JSON.
If `headlineSummary` is empty or over 1200 characters, revise and save the JSON
again before running render. The render command is the final validation gate; do
not use a failed render as the first time you discover an oversized headline.
