Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
unless crontab permissions or a missing local credential blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context.

Agent discretion boundary: this is a scheduler setup task until the smoke check
reports `fetchTasks`. Do not change paths, flags, cadence, titles, output
files, JSON schema, or success criteria.
During the `fetchTasks` step, failed extraction attempts are not
command-contract failures. Keep trying available local capabilities until each
task is completed or no available method can obtain real primary content.

Fetch task boundary:
- `fetchTasks` are the only work items. Each task represents one post that must
  end as one synced item with both `body` and `summary`.
- If `task.contentStatus="ready"`, copy `task.item.body` and generate only
  one concise Chinese single-post summary in `summary` from
  `task.summaryInstructions.prompt`.
- If `task.contentStatus="requires_agent"`, first obtain real primary content,
  then generate one concise Chinese single-post summary in `summary` from
  `task.summaryInstructions.prompt`.
- do not read prompt files, do not fetch `context.prompts`, and do not use any
  separate digest prompt at runtime.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Create required directories:

```bash
mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/logs"
```

3. First attempt the exact crontab install below. It removes any previous
FollowBrief library job for this account and installs one idempotent job that
runs every 6 hours. Replace `<EMAIL>` with the value of `BUILDER_BLOG_ACCOUNT`:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "builder-agent-runner.sh library-cron.*BUILDER_BLOG_ACCOUNT=\"$ACCT\"" ; printf "# FollowBrief library cron · %s\n0 */6 * * * BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh library-cron >> %s/.builder-blog/logs/library-cron.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" ) | crontab -
```

4. Verify the installed schedule:

```bash
crontab -l | grep 'builder-agent-runner.sh library-cron'
```

5. Run one immediate smoke check:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" $HOME/.builder-blog/builder-agent-runner.sh library-cron
```

If the smoke check JSON contains a non-empty `fetchTasks` array: complete
exactly the task IDs returned by the CLI. Do not add new sources, URLs, or feed
items that were not returned by the CLI or task payload.

How to execute each `fetchTask` in this smoke-check step:
- Read `task.id`; the finished item must set `rawJson.fetchTaskId` to exactly
  this value so validation can bind the output item to this task.
- Copy `task.builderSync` exactly as the enclosing builder object in the sync
  payload. Do not infer builder fields from names, handles, or URLs.
- Read `task.contentStatus`.
  - For `ready`, use `task.item.body` as the final item body exactly; do not
    fetch or rewrite the source content.
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
- For every output item, include `rawJson.fetchTaskId`. For `requires_agent`,
  also include `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`; for YouTube
  include `rawJson.transcriptSource`.

Validate with `validate-agent-sync` before `sync-builders` is considered
successful.

Only if crontab is unavailable or blocked, install the same command and cadence
through launchd or the local agent scheduler:

```cron
# FollowBrief library cron · <EMAIL>
0 */6 * * * BUILDER_BLOG_ACCOUNT="<EMAIL>" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1
```

The runner selection order is:

1. `BUILDER_BLOG_AGENT_COMMAND`, if the user configured one
2. Codex CLI
3. Claude Code CLI
4. OpenClaw CLI
5. Gemini CLI
6. Non-AI library fetch fallback for simple supported sources only; if it
   returns `fetchTasks`, it exits and requires a local agent
   runtime instead of silently leaving work incomplete

Do not duplicate an existing FollowBrief private library job for this account.
Other accounts' cron markers must remain untouched.
