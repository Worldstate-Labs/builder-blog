<!--
  Per-task core of the fetch-task / summarize execution contract. This is
  the SINGLE SOURCE OF TRUTH for how one fetchTask is completed — it is
  shared by the single-agent jobs (library-once.md, library-cron.md) AND by
  the parallel shard worker (library-worker.md), so per-task behavior can
  never drift between sequential and parallel runs. It deliberately contains
  no discovery flow and no payload-path / validate / sync commands — those
  live in _fetch-task-discovery.md and _fetch-task-syncing.md, which the
  worker does not include (the runner owns merge/validate/sync there).

      {{INCLUDE:fetch-task-core REPORT_TARGET="..."}}

  REPORT_TARGET is where to surface action-needed notices and blockers:
  "to the user" for interactive runs, "to the scheduled job log" for
  unattended cron runs, the worker log for shard workers.
-->
If the fetch result contains a non-empty `fetchTasks` array, complete exactly
the task IDs returned by the CLI. Do not add new sources, URLs, or feed items
that were not returned by the CLI, the task payload, or a CLI-expanded
candidate discovery result. Every produced item must include `summary`.

Lifecycle vocabulary for this contract:
- Planned = each CLI-returned post task that must end in one terminal outcome.
- Read = obtain the final primary body for the post. For `contentStatus="ready"`,
  the CLI already did this and `task.item.body` is the body.
- Summarize = generate exactly one single-post summary from
  `task.summaryInstructions.prompt`.
- Sync = validate and upload the item or a `taskOutcomes` terminal outcome to
  FollowBrief. Use "sync" for this step; do not call it "save".

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
    the common fetching rules plus your per-source fetch prompt (when
    configured), or just the common fetching rules for that source (use
    task.item.url, task.sourceType, task.agentWorkType, and any available
    method — web fetch, local CLI tools
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
  `minChars`, `minContentUnits`, and optional density/diversity gates such as
  `minLocalDiversity` and `maxTimestampDensity`. Never accept body content whose origin string appears in
  `disallowedPrimarySources` (the list is per source). Title, description, feed
  description, and page metadata are never acceptable body content for any source.
- Generate a single-post `summary` only after the body is final. Follow
  `task.summaryInstructions.prompt` and summarize this one task item only.
  `task.summaryInstructions.prompt` is the only prompt source for fetch-task
  summaries. It already includes the common post-summary rules, source-specific
  rules, and output language. Do not re-compose it from `context.sources` or
  other prompt configuration. Keep the finished summary under 1200 characters —
  the validator rejects longer ones as `summary_too_long`.
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
