Objective: fetch this user's FollowBrief private source library once, complete
the returned fetch tasks, and sync only fully completed posts.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered command steps exactly.
- If a command outside the explicit `fetchTasks` work fails, stop and report the
  command, exit code, and stderr.
- Do not use `--force`.
- Do not browse for extra context unless a `fetchTasks` payload requires you to
  extract content from a URL the task supplies.
- Do not change paths, flags, cadence, titles, output files, JSON schema, or
  success criteria.
- Stay in command-runner mode until the CLI returns `fetchTasks` or says a
  personal source needs local cookies, credentials, transcription, or custom
  tooling.
- During `fetchTasks`, failed extraction attempts are not command-contract
  failures. Keep trying available capabilities — web fetch, local CLI tools,
  transcription APIs, headless browser, etc. — until each task is completed or
  no available method can obtain real primary content.

Fetch task boundary:
- `fetchTasks` are the only work items. Each task represents one post that must
  end as one synced item with both `body` and `summary`.
- If `task.contentStatus="ready"`, the normal fetcher already produced
  `task.item.body`; do not fetch content again. Generate one concise
  single-post `summary` from `task.summaryInstructions.prompt` (it declares the
  required language), copy the original item fields from `task.item`, and
  include `rawJson.fetchTaskId`.
- If `task.contentStatus="requires_agent"`, first obtain real primary content
  using whatever extraction capabilities this agent has (web fetch, local CLI
  tools, transcription APIs, headless browser, etc.), then generate one concise single-post
  `summary` from `task.summaryInstructions.prompt`. Include
  `rawJson.fetchTaskId`, `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`.
- `task.summaryInstructions.prompt` is the only prompt source for the summary;
  it already bakes in the global common rules and the per-source rules. Do not
  read prompt files from disk, and do not fetch `context.prompts`,
  `context.sources[*].summaryPrompt`, or `context.commonSummaryRules`
  separately.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Fetch normal personal source items and save the full result:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" fetch-personal --days 30 --limit 3 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-fetch-result.json"
```

3. Print the fetch result:

```bash
cat "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-fetch-result.json"
```

4. If it contains a non-empty `fetchTasks` array: Complete exactly the task IDs
returned by the CLI. Do not add new sources, URLs, or feed items that were not
returned by the CLI or task payload. Every produced item must include
`summary`.

How to execute each `fetchTask` in this step:
- Read `task.id`; the finished item must set `rawJson.fetchTaskId` to exactly
  this value so validation can bind the output item to this task.
- Copy `task.builderSync` exactly as the enclosing builder object in the sync
  payload. Do not infer builder fields from names, handles, or URLs.
- Read `task.contentStatus`.
  - For `ready`, use `task.item.body` as the final item body exactly; do not
    fetch or rewrite the source content.
  - For `requires_agent`, use `task.item.url`, `task.sourceType`, and
    `task.agentWorkType` to pick any extraction method available — web fetch,
    local CLI tools (yt-dlp, curl, ffmpeg…), transcription APIs, headless
    browser, anything you have. Keep trying available methods until real
    primary content is obtained or no method remains.
- Use `task.minimumContentQuality` for `requires_agent` tasks as the minimum
  acceptance bar for the extracted body. The structured fields drive
  acceptance: `minChars`, `minWords`, the optional ratios, and
  `disallowedPrimarySources` — never accept body content whose origin string
  appears in `disallowedPrimarySources`.
- Generate `summary` only after the body is final. Follow
  `task.summaryInstructions.prompt` and summarize this one task item only.
- Build one output item under the copied builder. Copy stable item fields from
  `task.item` (`kind`, `externalId`, `title`, `url`, `publishedAt`,
  `sourceName`), set `body`, set `summary`, and set `rawJson`.
- For every output item, include `rawJson.fetchTaskId`. For `requires_agent`,
  also include `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`; for YouTube
  include `rawJson.transcriptSource`.

5. If you completed `fetchTasks`, write a sync payload to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json
```

Use each `task.builderSync` for the enclosing builder fields. Every item must
include `rawJson.fetchTaskId`; for YouTube include
`rawJson.transcriptSource="agent-transcript"` unless a better primary transcript
source is used. Then run these commands exactly:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-fetch-result.json" \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
```

6. Report the fetch JSON plus any `validate-agent-sync` and `sync-builders`
JSON. Success means status is ok, localErrors is empty, and `fetchTasks` is
empty or `validate-agent-sync` reports all fetch tasks validated and
`sync-builders` succeeds. Already-fetched posts should remain skipped regardless
of whether the user has read them.
