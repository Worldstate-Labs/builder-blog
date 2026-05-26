Use the FollowBrief skill to run the scheduled private library job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If any command fails, stop and write the command, exit
code, and stderr to the scheduled job log. Do not browse for extra context. Do
not use `--force` unless the user explicitly requested a forced run in the
scheduled job configuration.

Agent discretion boundary: this is a command-runner job unless the CLI returns
`crawlTasks` or a source requires local cookies, credentials, transcription, or
custom tooling. Do not change paths, flags, cadence, titles, output files, JSON
schema, or success criteria.
During the `crawlTasks` step, failed extraction attempts are not command-contract
failures. Keep trying available local capabilities until each task is completed
or no available method can obtain real primary content.

Crawl task boundary:
- `crawlTasks` are the only work items. Each task represents one post that must
  end as one synced item with both `body` and `summary`.
- If `task.contentStatus="ready"`, copy `task.item.body` and generate only
  one concise Chinese single-post summary in `summary` from
  `task.summaryInstructions.prompt`.
- If `task.contentStatus="requires_agent"`, first obtain real primary content,
  then generate one concise Chinese single-post summary in `summary` from
  `task.summaryInstructions.prompt`.
- do not read prompt files, do not fetch `context.prompts`, and do not use any
  separate digest prompt at runtime.

Before doing work, ensure the skill is installed:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

Then crawl normal personal source items and save the full crawl result:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
BUILDER_BLOG_TOKEN="${BUILDER_BLOG_TOKEN}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" crawl-personal --days 30 --limit 3 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
cat "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
```

Rules:

- Skip posts that are already synced.
- Only use agent judgment if the CLI returns `crawlTasks` or a source requires
  AI work, transcription, cookies, or custom access. In that case, use the local
  agent environment and sync the resulting items through the FollowBrief CLI.
- Complete exactly the task IDs returned by the CLI. Do not add new sources, URLs, or feed items that were not returned by the CLI or task payload.
  How to execute each `crawlTask`:
  - Read `task.id`; the finished item must set `rawJson.crawlTaskId` to exactly
    this value so validation can bind the output item to this task.
  - Copy `task.builderSync` exactly as the enclosing builder object in the sync
    payload. Do not infer builder fields from names, handles, or URLs.
  - Read `task.contentStatus`.
    - For `ready`, use `task.item.body` as the final item body exactly; do not
      crawl or rewrite the source content.
    - For `requires_agent`, use `task.item.url`, `task.sourceType`, and
      `task.agentWorkType` to choose local extraction methods. Keep trying
      available methods until real primary content is obtained or no method
      remains.
  - Use `task.minimumContentQuality` for `requires_agent` tasks as the minimum
    acceptance bar for the extracted body. For YouTube, title, description, feed
    description, and page metadata are not acceptable body content.
  - Generate `summary` only after the body is final. Follow
    `task.summaryInstructions.prompt` and summarize this one task item only.
  - Build one output item under the copied builder. Copy stable item fields from
    `task.item` (`kind`, `externalId`, `title`, `url`, `publishedAt`,
    `sourceName`), set `body`, set `summary`, and set `rawJson`.
  - For every output item, include `rawJson.crawlTaskId`. For
    `requires_agent`, also include `rawJson.agentRuntime`,
    `rawJson.agentModel` if known, `rawJson.agentCompletedAt`, and
    `rawJson.agentExecutionProof`; for YouTube include
    `rawJson.transcriptSource`.
- For `crawlTasks` with `contentStatus="requires_agent"`, do not stop just
  because one extraction method fails. Keep working through available local
  methods until the content is extracted. Stop only if this agent has no
  remaining available way to obtain real primary content for a task, and write
  the tried methods and concrete blocker to the scheduled job log.
- For YouTube, title, description, and page metadata are auxiliary only. Do not
  sync them as the item body; complete `requires_agent` tasks with real primary
  content that meets `minimumContentQuality`.
- Every synced item must include `summary`, `rawJson.crawlTaskId`, and use
  `task.builderSync` for the enclosing builder fields. For `requires_agent`
  tasks, also include `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`. For YouTube,
  include `rawJson.transcriptSource="agent-transcript"` unless a better primary
  transcript source is used.
- Before syncing agent-produced items or summaries, validate them:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
BUILDER_BLOG_TOKEN="${BUILDER_BLOG_TOKEN}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json" \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
BUILDER_BLOG_TOKEN="${BUILDER_BLOG_TOKEN}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
```

- If the run cannot complete without a missing credential or unsupported local
  capability, write the concrete reason to the scheduled job log and stop.
