<!--
  Per-task core of the fetch-task / summarize execution contract. This is
  the SINGLE SOURCE OF TRUTH for how one fetchTask is completed. It is included
  by the library-worker prompt only; the runner owns fetch-personal, discovery
  expansion, merge, validation, repair, and sync. It deliberately contains no
  discovery flow and no validate / sync commands.

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
  FollowBrief. Use "sync" for this step; do not call it "save". The sync command
  applies source-specific raw retention policy before the server stores a row:
  full raw content may be used locally for summarization, but only the durable
  body allowed for that source type is uploaded/stored.

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
- Use only this run's scratch space for reusable local artifacts.
  `$BUILDER_BLOG_JOB_TMP_DIR`, `$BUILDER_BLOG_SHARD_CHECKPOINT_DIR`, and the
  shard file/result directories define the current account/job boundary.
  Globally installed tools and their normal binary, package, model, and auth
  caches may live outside this directory. Per-job content artifacts from this
  run must stay under `$BUILDER_BLOG_JOB_TMP_DIR`: audio/video downloads,
  subtitles, transcripts, browser profiles, screenshots, page dumps, and scratch
  files. Do not write those per-job artifacts to `/tmp`, `/var/folders`,
  `~/Downloads`, `~/.cache`, another account/job directory, or global scratch.
  Do not read or reuse local artifacts from other accounts, other job types, or
  global scratch directories.
  Never read from `~/.builder-blog/tmp/accounts/<other account>`,
  `~/.builder-blog/tmp/whisper`, or another account's transcript/audio cache. If
  a useful artifact exists outside the current account/job boundary, treat it as
  unavailable and fetch or transcribe the task inside the current scratch path,
  or report a terminal task outcome with concrete evidence.
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
- Treat `body` in this local sync payload as the final primary content used for
  validation and summarization. Do not put raw HTML, full transcripts, raw API
  responses, or large copied source text into `rawJson`; `rawJson` is for
  provenance and execution proof only. The CLI will scrub high-risk raw content
  from the upload according to source type.
- For every output item, include `rawJson.fetchTaskId`. For `requires_agent`,
  also include `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`; for YouTube
  include `rawJson.transcriptSource="agent-transcript"` unless a better primary
  transcript source is used. Also include `rawJson.acquisition` when known:
  `{ provider, method, processedLocally: true, rawPersistedRequested,
  rightsBasis }`.

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
