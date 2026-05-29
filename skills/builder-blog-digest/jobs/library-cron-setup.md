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

Scheduled runtime: **{{AGENT_RUNTIME_LABEL}}** ({{AGENT_RUNTIME}}). Every step
below uses this pinned runtime; do not fall back to a different one.

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

4. Verify the runtime CLI is on PATH for the scheduler. Schedulers (launchd and
cron) run with a minimal PATH; the runner injects
`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, so the relevant binary must
live in one of those. Check:

```bash
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" command -v {{AGENT_RUNTIME}}
```

If the path printed is empty, install or symlink the CLI into
`/usr/local/bin` before continuing — the scheduler will not find it otherwise.

5. Install the schedule to run {{CRON_FREQUENCY_LABEL}}. Pick the path for this
machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin) → launchd LaunchAgent

On macOS you MUST use a launchd LaunchAgent, not cron. A LaunchAgent runs
inside your login session, so it can reach the login keychain and the pinned
agent ({{AGENT_RUNTIME_LABEL}}) is authenticated. Plain `cron` runs outside
your session and cannot reach the keychain, so the agent CLI fails every run
with "Not logged in". The plist label is account-scoped, so multiple accounts
coexist as separate agents, and re-running this replaces only this account's
agent.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.library.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
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
<string>library-cron</string>
</array>
<key>EnvironmentVariables</key>
<dict><key>BUILDER_BLOG_ACCOUNT</key><string>$ACCT</string></dict>
{{LAUNCHD_SCHEDULE}}
<key>StandardOutPath</key><string>$HOME/.builder-blog/logs/library-cron.log</string>
<key>StandardErrorPath</key><string>$HOME/.builder-blog/logs/library-cron.log</string>
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
previous FollowBrief library job for this account, then installs one idempotent
job:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron" ; printf "# FollowBrief library cron · %s\n{{CRON_SCHEDULE}} BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh library-cron >> %s/.builder-blog/logs/library-cron.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" ) | crontab -
crontab -l | grep 'builder-agent-runner.sh library-cron'
```

6. Run one immediate smoke check. This runs in your current session (which has
keychain access), so it validates the whole fetch → sync pipeline:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" $HOME/.builder-blog/builder-agent-runner.sh library-cron
```

This delegates the fetch/summarize/sync to the runner (the `library-cron`
prompt); do not do that work yourself. Just report its output: it succeeds when
the JSON shows status ok, localErrors empty, and `fetchTasks` either empty or
all validated and synced. If it errors, report the command, exit code, and
stderr, and stop.

Multiple FollowBrief accounts can share one machine: each gets its own
account-scoped LaunchAgent label (macOS) or cron marker (Linux), so installing
one never touches another's, and re-running replaces only this account's.
