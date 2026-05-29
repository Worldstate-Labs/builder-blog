Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
unless crontab permissions or a missing local credential blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context.

Agent discretion boundary: this is a scheduler setup task. Do not change paths,
flags, cadence, titles, output files, JSON schema, or success criteria. You are
only installing the cron job and running one smoke check — you never complete
fetch tasks yourself. The smoke check delegates that to the runner, which feeds
the agent the `library-cron` prompt (the single source of truth for how fetch
tasks are fetched, summarized, validated, and synced); this file does not
restate any of it.

Scheduled runtime: **{{AGENT_RUNTIME_LABEL}}** ({{AGENT_RUNTIME}}). The picker
on the website pinned this. Every step below assumes that pinned runtime; do
not fall back to a different one.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Create required directories:

```bash
mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/logs"
```

3. Pin the scheduled runtime so the runner uses the picked agent's unattended
mode instead of discovering whatever's first on PATH. The runner reads this
file at cron-fire time; if you skip this step the cron job will fall back to
the discovery chain (which prompts for permissions every run).

```bash
printf '{{AGENT_RUNTIME}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime"
```

4. Verify the runtime CLI is on PATH for cron. Cron uses a minimal PATH; the
runner injects `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, so the
relevant binary must live in one of those. Check:

```bash
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" command -v {{AGENT_RUNTIME}}
```

If the path printed is empty, install or symlink the CLI into
`/usr/local/bin` before continuing — cron will not find it otherwise.

5. Install the crontab. It removes any previous FollowBrief library job for this
account and installs one idempotent job that runs every 6 hours. Replace
`<EMAIL>` with the value of `BUILDER_BLOG_ACCOUNT`:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "builder-agent-runner.sh library-cron.*BUILDER_BLOG_ACCOUNT=\"$ACCT\"" ; printf "# FollowBrief library cron · %s\n0 */6 * * * BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh library-cron >> %s/.builder-blog/logs/library-cron.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" ) | crontab -
```

6. Verify the installed schedule:

```bash
crontab -l | grep 'builder-agent-runner.sh library-cron'
```

7. Run one immediate smoke check. The runner will read
`~/.builder-blog/runtime` and invoke {{AGENT_RUNTIME_LABEL}} in its unattended
mode — no permission prompts.

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" $HOME/.builder-blog/builder-agent-runner.sh library-cron
```

The smoke check runs the exact scheduled job through the runner, which feeds it
the `library-cron` prompt. That prompt is the single source of truth for how
fetch tasks are completed, validated, and synced — this setup file does not
restate it. Just run the command above and report its output: the run succeeds
when the JSON shows status ok, localErrors empty, and `fetchTasks` either empty
or all validated and synced. If it errors, report the command, exit code, and
stderr, and stop.

Only if crontab is unavailable or blocked, install the same command and cadence
through launchd or the local agent scheduler:

```cron
# FollowBrief library cron · <EMAIL>
0 */6 * * * BUILDER_BLOG_ACCOUNT="<EMAIL>" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1
```

Permission allowlist that {{AGENT_RUNTIME_LABEL}} runs under at cron-fire time
(applied by `builder-agent-runner.sh` based on the pinned runtime):

- **claude** — `--permission-mode acceptEdits --allowedTools "Bash,Edit,Read,Write,Grep,Glob,WebFetch"` so no per-tool approval prompt fires under cron.
- **codex** — `--full-auto` (Codex's documented unattended mode; combines `approval_policy=never` and the workspace-write sandbox).
- **gemini** — `--yolo` (skip all confirmation prompts).
- **openclaw** — `--auto-approve` (skip the interactive approval gate).

If you want to widen or narrow what {{AGENT_RUNTIME_LABEL}} is allowed to do
at cron-fire time, edit the `run_with_{{AGENT_RUNTIME}}_unattended` function
in `~/.builder-blog/builder-agent-runner.sh` and re-run the smoke check.

Do not duplicate an existing FollowBrief private library job for this account.
Other accounts' cron markers must remain untouched.
