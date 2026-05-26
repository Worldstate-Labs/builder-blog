Set up the FollowBrief subscription digest scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
unless crontab permissions or a missing local agent runtime blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not browse for extra context.

Agent discretion boundary: this is a scheduler setup task; the scheduled runner
is the only component that should generate digest text. Do not change paths,
flags, cadence, titles, output files, JSON schema, or success criteria. Only use
agent judgment to write the digest body from the FollowBrief context items.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Create required directories:

```bash
mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/logs"
```

3. First attempt the exact crontab install below. It removes any previous
FollowBrief digest job for this account and installs one idempotent job that
runs daily at 8:00 local time. Replace `<EMAIL>` with the value of
`BUILDER_BLOG_ACCOUNT`:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief digest cron · $ACCT" | grep -v "builder-agent-runner.sh digest-cron.*BUILDER_BLOG_ACCOUNT=\"$ACCT\"" ; printf "# FollowBrief digest cron · %s\n0 8 * * * BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh digest-cron >> %s/.builder-blog/logs/digest-cron.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" ) | crontab -
```

4. Verify the installed schedule:

```bash
crontab -l | grep 'builder-agent-runner.sh digest-cron'
```

5. Run one immediate smoke check:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" $HOME/.builder-blog/builder-agent-runner.sh digest-cron
```

Only if crontab is unavailable or blocked, install the same command and cadence
through launchd or the local agent scheduler:

```cron
# FollowBrief digest cron · <EMAIL>
0 8 * * * BUILDER_BLOG_ACCOUNT="<EMAIL>" $HOME/.builder-blog/builder-agent-runner.sh digest-cron >> $HOME/.builder-blog/logs/digest-cron.log 2>&1
```

The runner selection order is:

1. `BUILDER_BLOG_AGENT_COMMAND`, if the user configured one
2. Codex CLI
3. Claude Code CLI
4. OpenClaw CLI
5. Gemini CLI

If no local agent runtime is available, do not claim the digest cron is
installed successfully. Record that the user must install/configure an agent or
set `BUILDER_BLOG_AGENT_COMMAND`. Do not duplicate an existing FollowBrief
digest job for this account. Other accounts' cron markers must remain untouched.
