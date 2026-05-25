Objective: crawl this user's FollowBrief private source library once, complete
the returned crawl tasks, and sync only fully completed posts.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered command steps exactly.
- If a command outside the explicit `crawlTasks` work fails, stop and report the
  command, exit code, and stderr.
- Do not use `--force`.
- Do not browse for extra context unless a `crawlTasks` payload requires local
  extraction from a returned source URL.
- Do not change paths, flags, cadence, titles, output files, JSON schema, or
  success criteria.
- Stay in command-runner mode until the CLI returns `crawlTasks` or says a
  personal source needs local cookies, credentials, transcription, or custom
  tooling.
- During `crawlTasks`, failed extraction attempts are not command-contract
  failures. Keep trying available local capabilities until each task is
  completed or no available method can obtain real primary content.

Environment contract:
- Do not assume a local repo checkout or local database.
- Required local tools are a POSIX shell, `curl`, Node.js 20 or newer, outbound
  HTTPS access to `https://builder-blog.worldstatelabs.com`, and a writable
  directory at `${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}`.
- If a required local tool is missing, first try to make it available using this
  agent's normal local capabilities, such as an existing package manager,
  runtime manager, or shell-compatible fallback. Stop only if no available
  method can provide the prerequisite, or if the local runtime requires user
  approval for the repair. Report the tried repair methods and the concrete
  blocker.
- If no FollowBrief login token exists, the bootstrap command will open a
  browser device login. Ask the user to sign in only at that point, then
  continue.
- Use extra local capabilities such as browser cookies, paid subscriptions,
  transcription tools, or custom crawler commands only when a `crawlTasks` item
  has `contentStatus="requires_agent"` or says a source needs them.
- If the local agent runtime blocks the bootstrap command under its safety
  policy, stop and report that the bootstrap needs explicit user approval. Do
  not invent alternate install URLs such as `/install.sh`; the only install URL
  for this job is `/api/skill/bootstrap`.

Crawl task boundary:
- `crawlTasks` are the only work items. Each task represents one post that must
  end as one synced item with both `body` and `summary`.
- If `task.contentStatus="ready"`, the normal crawler already produced
  `task.item.body`; do not crawl content again. Generate one concise Chinese
  single-post summary in `summary` from `task.summaryInstructions.prompt`, copy
  the original item fields from `task.item`, and include
  `rawJson.crawlTaskId`.
- If `task.contentStatus="requires_agent"`, first obtain real primary content
  using this agent's local capabilities, then generate one concise Chinese
  single-post summary in `summary` from `task.summaryInstructions.prompt`.
  Include `rawJson.crawlTaskId`, `rawJson.agentRuntime`, `rawJson.agentModel`
  if known, `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`.
- do not read prompt files, do not fetch `context.prompts`, and do not use any
  separate digest prompt at runtime.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Crawl normal personal source items and save the full result:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" crawl-personal --days 30 --limit 3 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
```

3. Print the crawl result:

```bash
cat "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
```

4. If it contains a non-empty `crawlTasks` array: Complete exactly the task IDs
returned by the CLI. Do not add new sources, URLs, or feed items that were not
returned by the CLI or task payload. Every produced item must include
`summary`.

How to execute each `crawlTask` in this step:
- Read `task.id`; the finished item must set `rawJson.crawlTaskId` to exactly
  this value so validation can bind the output item to this task.
- Copy `task.builderSync` exactly as the enclosing builder object in the sync
  payload. Do not infer builder fields from names, handles, or URLs.
- Read `task.contentStatus`.
  - For `ready`, use `task.item.body` as the final item body exactly; do not
    crawl or rewrite the source content.
  - For `requires_agent`, use `task.item.url`, `task.sourceType`,
    `task.agentWorkType`, `task.normalCrawler`, and `task.suggestedAction` to
    choose local extraction methods. Keep trying available methods until real
    primary content is obtained or no method remains.
- Use `task.minimumContentQuality` for `requires_agent` tasks as the minimum
  acceptance bar for the extracted body. For YouTube, title, description, feed
  description, and page metadata are not acceptable body content.
- Generate `summary` only after the body is final. Follow
  `task.summaryInstructions.prompt` and summarize this one task item only.
- Build one output item under the copied builder. Copy stable item fields from
  `task.item` (`kind`, `externalId`, `title`, `url`, `publishedAt`,
  `sourceName`), set `body`, set `summary`, and set `rawJson`.
- For every output item, include `rawJson.crawlTaskId`. For `requires_agent`,
  also include `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`; for YouTube
  include `rawJson.transcriptSource`.

5. If you completed `crawlTasks`, write a sync payload to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json
```

Use each `task.builderSync` for the enclosing builder fields. Every item must
include `rawJson.crawlTaskId`; for YouTube include
`rawJson.transcriptSource="agent-transcript"` unless a better primary transcript
source is used. Then run these commands exactly:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json" \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
```

6. Report the crawl JSON plus any `validate-agent-sync` and `sync-builders`
JSON. Success means status is ok, localErrors is empty, and `crawlTasks` is
empty or `validate-agent-sync` reports all crawl tasks validated and
`sync-builders` succeeds. Already-crawled posts should remain skipped regardless
of whether the user has read them.
