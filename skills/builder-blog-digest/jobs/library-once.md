Objective: crawl this user's FollowBrief private source library once, sync any
newly crawled items, and complete any agent-required extraction or summary tasks
returned by the CLI.

You are the local agent executing this job. Treat this file as the execution
contract, not as user-facing documentation.

Execution contract:
- Run the numbered command steps exactly.
- If a command outside the explicit `agentTasks` work fails, stop and report the
  command, exit code, and stderr.
- Do not use `--force`.
- Do not browse for extra context unless an `agentTasks` payload requires local
  extraction from a returned source URL.
- Do not change paths, flags, cadence, titles, output files, JSON schema, or
  success criteria.
- Stay in command-runner mode until the CLI returns `agentTasks`, `summaryTasks`,
  or says a personal source needs local cookies, credentials, transcription, or
  custom tooling.
- During `agentTasks`, failed extraction attempts are not command-contract
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
  transcription tools, or custom crawler commands only when the CLI returns
  `agentTasks` or says a source needs them.
- If the local agent runtime blocks the bootstrap command under its safety
  policy, stop and report that the bootstrap needs explicit user approval. Do
  not invent alternate install URLs such as `/install.sh`; the only install URL
  for this job is `/api/skill/bootstrap`.

For every newly crawled or agent-produced post, also generate a concise Chinese
single-post summary using `summaryInstructions.prompt` from the task. The CLI
builds that prompt by adapting the source-specific reference prompt for the item
kind: `summarize-tweets.md` for `TWEET`, `summarize-podcast.md` for
`PODCAST_EPISODE`, and `summarize-blogs.md` for `BLOG_POST`. These filenames are
only provenance labels; do not read prompt files, do not fetch `context.prompts`,
and do not use the digest-feed prompt directly at runtime. Follow the task's
embedded single-post prompt.

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
item body. Every agent-produced item must also include `summary` written from
that task's `summaryInstructions.prompt`.

5. If the crawl result contains a non-empty `summaryTasks` array: Complete
exactly those task IDs by writing one concise Chinese summary per task. Follow
each task's `summaryInstructions.prompt`. This is a single-post summary, not a
multi-post digest. Do not browse, do not read prompt files, do not add items,
and do not summarize from title or description alone.

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
