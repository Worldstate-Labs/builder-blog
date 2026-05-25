Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
unless authentication, crontab permissions, or a missing local credential blocks
the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context.

Agent discretion boundary: this is a scheduler setup task until the smoke check
reports `agentTasks` or `summaryTasks`. Do not change paths, flags, cadence,
titles, output files, JSON schema, or success criteria.
During the `agentTasks` step, failed extraction attempts are not command-contract
failures. Keep trying available local capabilities until each task is completed
or no available method can obtain real primary content.
During the `summaryTasks` step, generate one concise Chinese single-post summary
per task by following `task.summaryInstructions.prompt`. The CLI embeds the
correct source-specific prompt in each task. Do not read prompt files or fetch
`context.prompts`.

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

If the smoke check JSON contains a non-empty `agentTasks` array: complete
exactly the task IDs returned by the CLI. Keep working through available methods
until the content is extracted; do not stop just because one method fails. Stop
only if this agent has no remaining available way to obtain real primary content
for a task, and report the tried methods and concrete blocker. Do not add new
sources, URLs, or feed items that were not returned by the CLI or task payload.
The item body must be real primary content meeting `minimumContentQuality`, not
a title, description, or page metadata. The agent-produced sync payload must
pass `validate-agent-sync` before `sync-builders` is considered successful.

If the smoke check JSON contains a non-empty `summaryTasks` array: complete
exactly those task IDs by writing one concise Chinese single-post summary per
task. Follow `task.summaryInstructions.prompt`; do not read prompt files and do
not summarize from title or description alone. Use `task.item` and
`task.builderSync` to build the sync payload so the item is uploaded only after
the summary is present. Validate with `validate-agent-sync` before
`sync-builders` is considered successful.

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
   returns `agentTasks` or `summaryTasks`, it exits and requires a local agent
   runtime instead of silently leaving work incomplete

Do not duplicate an existing FollowBrief private library job.
