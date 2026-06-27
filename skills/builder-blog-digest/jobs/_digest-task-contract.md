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
  ]
}
```

Rules:

- The runner invokes this contract only after it has already verified that
  `context.items[]` contains one or more candidate posts. Read the exact context
  file before deciding what to write; do not stop for "no candidates" unless
  that exact file read proves `context.items[]` is empty.
- Do not write per-post summaries. The CLI copies each `context.items[]` entry's
  existing `summary` into the digest verbatim; you must not rewrite, translate,
  restate, or shorten them, and the output JSON has no `postSummaries` field.
- Language mode: write digest output in `context.language`. If
  `context.language` is `source`, write each source summary in the dominant
  language of that source group's supplied post summaries, and write
  `headlineSummary` in the dominant language of all supplied post summaries.
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
  Use `item.entityId` exactly as each `sourceSummaries[].entityId`.
- Do not add URLs to the JSON fields. The CLI adds the original source link from
  `item.url`.
- If `headlineSummary` is empty or longer than 1200 characters, or a non-empty
  source summary references an unknown `entityId`, the job fails instead of
  syncing a partial digest.

Before finishing, reopen
`$TMP_DIR/builder-blog-digest-agent-output.json` and self-check the saved JSON.
If `headlineSummary` is empty or over 1200 characters, revise and save the JSON
again. A later validation step rejects oversized headlines and unknown
`sourceSummaries[]` entity IDs.
