Use the FollowBrief skill to run the scheduled private library job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If any command fails, stop and write the command, exit
code, and stderr to the scheduled job log. Do not browse for extra context. Do
not use `--force` unless the user explicitly requested a forced run in the
scheduled job configuration.

Agent discretion boundary: this is a command-runner job unless the CLI returns
`agentTasks` or a source requires local cookies, credentials, transcription, or
custom tooling. Do not change paths, flags, cadence, titles, output files, JSON
schema, or success criteria.
During the `agentTasks` step, failed extraction attempts are not command-contract
failures. Keep trying available local capabilities until each task is completed
or no available method can obtain real primary content.
For every newly crawled or agent-produced post, also generate a concise Chinese
single-post summary using only that post's supplied body and metadata. Use the
same discipline as the digest feed prompt: include source URLs for every claim,
prioritize launches, technical insights, funding/business moves, strong
opinions, and implementation details, and never invent missing facts.

Before doing work, ensure the skill is installed:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

Then crawl and sync normal personal source items and save the full crawl result:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" crawl-personal --days 30 --limit 3 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
cat "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
```

Rules:

- Skip posts that are already synced.
- Only use agent judgment if the CLI returns `agentTasks` or a source requires
  AI work, transcription, cookies, or custom access. In that case, use the local
  agent environment and sync the resulting items through the FollowBrief CLI.
- Complete exactly the task IDs returned by the CLI. Do not add new sources, URLs, or feed items that were not returned by the CLI or task payload.
- For `agentTasks`, do not stop just because one extraction method fails. Keep
  working through available local methods until the content is extracted. Stop
  only if this agent has no remaining available way to obtain real primary
  content for a task, and write the tried methods and concrete blocker to the
  scheduled job log.
- For YouTube, title, description, and page metadata are auxiliary only. Do not
  sync them as the item body; complete `agentTasks` with real primary content
  that meets `minimumContentQuality`.
- If the crawl result contains a non-empty `summaryTasks` array, complete
  exactly those task IDs by writing one concise Chinese summary per task. Use
  only `task.item.body`, `task.item.title`, source metadata, and `task.item.url`.
  This is a single-post summary, not a multi-post digest. Include source URLs
  for every claim. Do not browse, do not add items, and do not summarize from
  title or description alone.
- Every agent-produced item must include `rawJson.agentTaskId`,
  `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`. For YouTube,
  include `rawJson.transcriptSource="agent-transcript"` unless a better primary
  transcript source is used.
- Every item synced for a `summaryTasks` task must include `summary`; also
  include `rawJson.summaryTaskId`, `rawJson.summaryRuntime`,
  `rawJson.summaryModel` if known, and `rawJson.summaryCompletedAt` when
  possible.
- Before syncing agent-produced items or summaries, validate them:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json" \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
```

- If the run cannot complete without a missing credential or unsupported local
  capability, write the concrete reason to the scheduled job log and stop.
