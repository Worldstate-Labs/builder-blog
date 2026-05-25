Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
unless authentication, crontab permissions, or a missing local credential blocks
the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context.

Agent discretion boundary: this is a scheduler setup task until the smoke check
reports `crawlTasks`. Do not change paths, flags, cadence, titles, output
files, JSON schema, or success criteria.
During the `crawlTasks` step, failed extraction attempts are not
command-contract failures. Keep trying available local capabilities until each
task is completed or no available method can obtain real primary content.

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

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Create required directories:

```bash
mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/logs"
```

3. First attempt the exact crontab install below. It removes any previous
FollowBrief library job and installs one idempotent job that runs every 6 hours:

```bash
APP_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"; ( crontab -l 2>/dev/null | grep -v 'builder-agent-runner.sh library-cron' ; echo "0 */6 * * * BUILDER_BLOG_URL=\"$APP_URL\" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1" ) | crontab -
```

4. Verify the installed schedule:

```bash
crontab -l | grep 'builder-agent-runner.sh library-cron'
```

5. Run one immediate smoke check:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" $HOME/.builder-blog/builder-agent-runner.sh library-cron
```

If the smoke check JSON contains a non-empty `crawlTasks` array: complete
exactly the task IDs returned by the CLI. Do not add new sources, URLs, or feed
items that were not returned by the CLI or task payload. For
`contentStatus="ready"` tasks, copy `task.item.body` and write the summary. For
`contentStatus="requires_agent"` tasks, keep working through available methods
until real primary content is extracted; do not stop just because one method
fails. Stop only if this agent has no remaining available way to obtain real
primary content for a task, and report the tried methods and concrete blocker.
Do not use title, description, or page metadata as the item body. Use
`task.item` and `task.builderSync` to build the sync payload so the item is
uploaded only after both `body` and `summary` are present. Validate with
`validate-agent-sync` before `sync-builders` is considered successful.

Only if crontab is unavailable or blocked, install the same command and cadence
through launchd or the local agent scheduler:

```cron
0 */6 * * * BUILDER_BLOG_URL="https://builder-blog.worldstatelabs.com" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1
```

The runner selection order is:

1. `BUILDER_BLOG_AGENT_COMMAND`, if the user configured one
2. Codex CLI
3. Claude Code CLI
4. OpenClaw CLI
5. Gemini CLI
6. Non-AI library crawl fallback for simple supported sources only; if it
   returns `crawlTasks`, it exits and requires a local agent
   runtime instead of silently leaving work incomplete

Do not duplicate an existing FollowBrief private library job.
