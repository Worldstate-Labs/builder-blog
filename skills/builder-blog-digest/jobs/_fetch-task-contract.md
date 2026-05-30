<!--
  Canonical fetch-task / summarize execution contract for the FollowBrief
  private library jobs. This is the SINGLE SOURCE OF TRUTH for how each
  fetchTask is completed and synced. Do not copy this content into the
  job prompts — they pull it in with:

      {{INCLUDE:fetch-task-contract REPORT_TARGET="..."}}

  The only once-vs-cron difference is REPORT_TARGET (where to surface
  action-needed notices and blockers): "to the user" for interactive
  runs, "to the scheduled job log" for unattended cron runs. Everything
  about WHAT to fetch and HOW to build the synced item lives here so the
  two jobs can never drift.
-->
Fetch task boundary:
- `fetchTasks` are the only work items. Each task represents one post that must
  end as one synced item with both `body` and `summary`.
- If `task.contentStatus="ready"`, the normal fetcher already produced
  `task.item.body`; do not fetch content again. Generate one concise single-post
  `summary` from `task.summaryInstructions.prompt`.
- If `task.contentStatus="requires_agent"`, first obtain real primary content,
  then generate one concise single-post `summary` from
  `task.summaryInstructions.prompt`.
- `task.summaryInstructions.prompt` is the only prompt source for the summary;
  it already bakes in the global common rules, the per-source rules, and the
  output language (do not assume a language — write the summary in the one that
  prompt states). Do not read prompt files from disk, and do not fetch
  `context.prompts`, `context.sources[*].summaryPrompt`, or
  `context.commonSummaryRules` separately.

If the fetch result contains a non-empty `fetchTasks` array, complete exactly
the task IDs returned by the CLI. Do not add new sources, URLs, or feed items
that were not returned by the CLI or task payload. Every produced item must
include `summary`.

How to execute each `fetchTask`:
- Read `task.id`; the finished item must set `rawJson.fetchTaskId` to exactly
  this value so validation can bind the output item to this task.
- Copy `task.builderSync` exactly as the enclosing builder object in the sync
  payload. Do not infer builder fields from names, handles, or URLs.
- If `task.agentWorkType="x_token_missing"`, do NOT try to fetch. Report
  `task.agentMessage` {{REPORT_TARGET}} as an "Action needed" notice and skip
  this task — do not include it in the sync payload. The validator treats these
  as informational and will not flag them as missing.
- Read `task.contentStatus`.
  - For `ready`, use `task.item.body` as the final item body exactly; do not
    fetch or rewrite the source content.
  - For `requires_agent`, follow `task.fetchInstructions.prompt` as the
    authoritative extraction guide. This string is always present and is either
    your per-source fetch prompt (when configured) or the FollowBrief
    default extraction guidance (use task.item.url, task.sourceType,
    task.agentWorkType, and any available method — web fetch, local CLI tools
    yt-dlp/curl/ffmpeg, transcription APIs, headless browser, anything you have
    — until real primary content meeting task.minimumContentQuality is
    obtained). Do not override the prompt with your own heuristics. Do not stop
    just because one extraction method fails; stop only if no available method
    can obtain real primary content for a task, then write the tried methods and
    concrete blocker {{REPORT_TARGET}} and skip it.
    Source-specific extraction rules — including what counts as primary content
    for that medium and how to confirm an item genuinely has no content — live
    in that source's fetch prompt, not here; follow
    `task.fetchInstructions.prompt` for EACH task independently.
- Use `task.minimumContentQuality` for `requires_agent` tasks as the minimum
  acceptance bar for the extracted body. The structured fields drive acceptance:
  `minChars`, `minWords`, the optional ratios, and `disallowedPrimarySources` —
  never accept body content whose origin string appears in
  `disallowedPrimarySources` (the list is per source). Title, description, feed
  description, and page metadata are never acceptable body content for any source.
- Generate `summary` only after the body is final. Follow
  `task.summaryInstructions.prompt` and summarize this one task item only.
- Build one output item under the copied builder. Copy stable item fields from
  `task.item` (`kind`, `externalId`, `title`, `url`, `publishedAt`,
  `sourceName`), set `body`, set `summary`, and set `rawJson`.
- For every output item, include `rawJson.fetchTaskId`. For `requires_agent`,
  also include `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`; for YouTube
  include `rawJson.transcriptSource="agent-transcript"` unless a better primary
  transcript source is used.

Per-task independence and accountability (CRITICAL):
- Process EACH task on its own. NEVER infer one task's content or availability
  from another task, and NEVER apply a single blanket decision/reason to several
  tasks (e.g. do not skip a batch of videos because the first one was silent —
  check every video).
- EVERY planned fetchTaskId must end in exactly one terminal state: synced as an
  item, OR reported in a `taskOutcomes` entry. Do not silently omit any task.
- Report every non-synced task as one `taskOutcomes` entry shaped
  `{ fetchTaskId, status, reason, evidence? }`, where `status` is one of:
  - `skipped` — the item genuinely has no primary content. Requires this item's
    OWN `evidence` (the per-item check you ran, e.g.
    `{ meanVolumeDb: -91, hasCaptions: false }`); a skip without per-task
    evidence is rejected.
  - `failed` — you tried but couldn't finish; `reason` required (e.g.
    `fetch_error`, `content_too_short`, `summary_error`).
  - `blocked` — a missing credential or capability; `reason` required.

Write the sync payload to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json
```

The payload is `{ builders: [{ …builderSync, items: [synced items] }],
taskOutcomes: [non-synced task outcomes] }`.

Then validate before sync, and sync, running these commands exactly:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-fetch-result.json" \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
```

A fetchTask is complete ONLY when its item is synced with real crawled content
(`body` meeting the source's `minimumContentQuality`) AND a non-empty `summary`.
The server enforces both: a post with no/insufficient content, or with no
summary, is refused and recorded in the fetch log as a FAILURE (reason
`content_missing` / `content_too_short` / `summary_missing`) — not a partial
success. So summarize every task you fetch before syncing — do not silently drop a
task from the sync payload because you couldn't summarize it. If a specific task
genuinely cannot be summarized, write the concrete reason {{REPORT_TARGET}} and
continue with the rest; the server will mark that one failed.

Run `validate-agent-sync` over the FULL fetch-result file (not a subset) before
`sync-builders`, and stop if it reports errors — it checks that every planned
task is either synced (with content + summary) or accounted for in
`taskOutcomes`, and that every `skipped` carries its own per-task evidence (so a
blanket bulk-skip fails). Success means status is ok, localErrors
is empty, and `fetchTasks` is empty or `validate-agent-sync` reports all fetch
tasks validated and `sync-builders` succeeds. Already-fetched posts remain
skipped regardless of read state. If the run cannot complete without a missing
credential or unsupported local capability, write the concrete reason
{{REPORT_TARGET}} and stop.
