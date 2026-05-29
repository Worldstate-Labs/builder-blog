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

3. Install the schedule to run {{CRON_FREQUENCY_LABEL}}. Pick the path for this
machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin) → launchd LaunchAgent

On macOS you MUST use a launchd LaunchAgent, not cron. A LaunchAgent runs
inside your login session, so it can reach the login keychain and the local
agent CLI is authenticated. Plain `cron` runs outside your session and cannot
reach the keychain, so the agent fails every run with "Not logged in". The
plist label is account-scoped, so re-running replaces only this account's agent.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.digest.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key>
<array>
<string>$HOME/.builder-blog/builder-agent-runner.sh</string>
<string>digest-cron</string>
</array>
<key>EnvironmentVariables</key>
<dict><key>BUILDER_BLOG_ACCOUNT</key><string>$ACCT</string></dict>
{{LAUNCHD_SCHEDULE}}
<key>StandardOutPath</key><string>$HOME/.builder-blog/logs/digest-cron.log</string>
<key>StandardErrorPath</key><string>$HOME/.builder-blog/logs/digest-cron.log</string>
</dict>
</plist>
PLISTEOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state =|program ="
```

### Linux / other (no keychain) → crontab

The agent CLI's token is a plain file there, so cron works. This removes any
previous FollowBrief digest job for this account, then installs one idempotent
job:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief digest cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh digest-cron" ; printf "# FollowBrief digest cron · %s\n{{CRON_SCHEDULE}} BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh digest-cron >> %s/.builder-blog/logs/digest-cron.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" ) | crontab -
crontab -l | grep 'builder-agent-runner.sh digest-cron'
```

4. Run one immediate smoke check. This runs in your current session (which has
keychain access), so it validates the whole digest pipeline:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" $HOME/.builder-blog/builder-agent-runner.sh digest-cron
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
