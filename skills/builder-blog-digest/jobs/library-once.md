Build my FollowBrief private source library once.

This is an interactive local agent run. Do not ask the user questions unless
authentication or a missing local credential blocks the run.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context.

Agent discretion boundary: this is a command-runner task until the CLI returns
`agentTasks` or says a personal source needs local cookies, credentials,
transcription, or custom tooling. Do not change paths, flags, cadence, titles,
output files, JSON schema, or success criteria.
During the `agentTasks` step, failed extraction attempts are not command-contract
failures. Keep trying available local capabilities until each task is completed
or no available method can obtain real primary content.

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
item body.

5. If you completed `agentTasks`, write a sync payload to:

```text
${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/library-agent-sync.json
```

Every agent-produced item must include `rawJson.agentTaskId`,
`rawJson.agentRuntime`, `rawJson.agentModel` if known,
`rawJson.agentCompletedAt`, `rawJson.agentExecutionProof`, and for YouTube
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
JSON. Success means status is ok, localErrors is empty, and agentTasks is empty
or `validate-agent-sync` reports all tasks validated and `sync-builders`
succeeds. Already-crawled posts should remain skipped regardless of whether the
user has read them.
