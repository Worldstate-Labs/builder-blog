Build my FollowBrief private source library once.

This is an interactive local agent run. Do not ask the user questions unless
authentication or a missing local credential blocks the run.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context.

Fresh computer/session compatibility:
- This skill is intended to work from a new Claude Code, Codex, OpenClaw,
  Gemini, or similar local agent session with no local repo checkout.
- The computer must have a POSIX shell, `curl`, Node.js 20 or newer, outbound
  HTTPS access to `https://builder-blog.worldstatelabs.com`, and a writable
  home directory for `${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}`.
- If no FollowBrief login token exists yet, the bootstrap step opens a browser
  device login. Ask the user to sign in only at that point, then continue.
- Extra local capabilities such as browser cookies, paid subscriptions,
  transcription tools, or custom crawler commands are only needed when the CLI
  returns `agentTasks` or says a source needs them.

Agent discretion boundary: this is a command-runner task until the CLI returns
`agentTasks` or says a personal source needs local cookies, credentials,
transcription, or custom tooling. Do not change paths, flags, cadence, titles,
output files, JSON schema, or success criteria.
During the `agentTasks` step, failed extraction attempts are not command-contract
failures. Keep trying available local capabilities until each task is completed
or no available method can obtain real primary content.
For every newly crawled or agent-produced post, also generate a concise Chinese
single-post summary using only that post's supplied body and metadata. Use the
same discipline as the digest feed prompt: include source URLs for every claim,
prioritize launches, technical insights, funding/business moves, strong
opinions, and implementation details, and never invent missing facts.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Crawl and sync normal personal source items, and save the full result:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" crawl-personal --days 30 --limit 3 \
  > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
```

3. Print the crawl result:

```bash
cat "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json"
```

4. If it contains a non-empty `agentTasks` array: Complete exactly the task IDs
returned by the CLI using this agent's own local capabilities, subscriptions,
browser/cookie access, transcription tools, or model access. Keep working
through available methods until the content is extracted; do not stop just
because one method fails. Stop only if this agent has no remaining available way
to obtain real primary content for a task, and report the tried methods and
concrete blocker. Do not add new sources, URLs, or feed items that were not
returned by the CLI or task payload. The content must meet each task's
`minimumContentQuality`. Do not use title, description, or page metadata as the
item body. Every agent-produced item must also include `summary`.

5. If the crawl result contains a non-empty `summaryTasks` array: Complete
exactly those task IDs by writing one concise Chinese summary per task. Use only
`task.item.body`, `task.item.title`, source metadata, and `task.item.url`.
This is a single-post summary, not a multi-post digest. Include source URLs for
every claim. Do not browse, do not add items, and do not summarize from title or
description alone.

6. If you completed `agentTasks` or `summaryTasks`, write a sync payload to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json
```

Every agent-produced item must include `rawJson.agentTaskId`,
`rawJson.agentRuntime`, `rawJson.agentModel` if known,
`rawJson.agentCompletedAt`, `rawJson.agentExecutionProof`, and for YouTube
`rawJson.transcriptSource="agent-transcript"` unless a better primary transcript
source is used. Every item synced for a `summaryTasks` task must include
`summary`; also include `rawJson.summaryTaskId`, `rawJson.summaryRuntime`,
`rawJson.summaryModel` if known, and `rawJson.summaryCompletedAt` when possible.
Then run these commands exactly:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-crawl-result.json" \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json"
```

7. Report the crawl JSON plus any `validate-agent-sync` and `sync-builders`
JSON. Success means status is ok, localErrors is empty, and agentTasks is empty
or `validate-agent-sync` reports all tasks validated and `sync-builders`
succeeds. If `summaryTasks` is non-empty, success also requires
`validate-agent-sync` to report all summary tasks validated. Already-crawled
posts should remain skipped regardless of whether the user has read them.
