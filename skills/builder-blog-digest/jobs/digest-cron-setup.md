Set up the FollowBrief subscription digest scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
except where step 3 requires it (confirming whether to replace an existing
digest cron), or when crontab permissions or a missing local agent runtime
blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not browse for extra context. Do not invoke any other
skill, plugin, or subagent — run the numbered steps yourself exactly as written;
this prompt is the whole task.

Agent discretion boundary: this is a scheduler setup task; the scheduled runner
is the only component that should produce structured digest summary JSON. Do not
change paths, flags, cadence, titles, output files, JSON schema, or success
criteria.

Scheduled runtime: **{{AGENT_RUNTIME_LABEL}}** ({{AGENT_RUNTIME}}). Every step
below uses this pinned runtime; do not fall back to a different one.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Create required directories and verify this account's local credential before
changing scheduler state. The web Copy-prompt version runs a one-time exchange
step before step 1; static local copies cannot create the account file
themselves. If the credential is missing, stop before pinning settings or
installing the schedule.

```bash
mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/logs"
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -z "$ACCT" ]; then
  echo "BUILDER_BLOG_ACCOUNT is empty. Re-copy this setup prompt from FollowBrief." >&2
  exit 1
fi
SAFE_ACCT="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9._@+-' '_')"
ACCOUNT_FILE="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/accounts/$SAFE_ACCT.json"
if [ ! -s "$ACCOUNT_FILE" ]; then
  echo "Account file not found for $ACCT (expected $ACCOUNT_FILE)." >&2
  echo "Stop before installing the schedule. Re-copy this setup prompt from FollowBrief so it includes a fresh one-time exchange code, then run that prompt." >&2
  exit 1
fi
```

3. Before changing anything, check whether this account's digest cron already
exists on this machine. Run the check for this machine's OS — run `uname` if
unsure.

### macOS (`uname` is Darwin)

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.digest.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
launchctl list 2>/dev/null | awk '{ print $3 }' | grep -x "$LABEL" || echo "(none found)"
```

### Linux / other

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
crontab -l 2>/dev/null | grep "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh digest-cron" || echo "(none found)"
```

If the result is "(none found)", continue to the next step. If it lists one or
more existing digest jobs for this account, STOP: report exactly what was found, explain that
continuing replaces this account's digest schedule and its pinned runtime
(jobs for other accounts are left untouched), and ask the user whether to
override. Only continue past this step after the user explicitly confirms. If
they decline, stop and change nothing.

4. Pin the scheduled runtime and digest mode for this account's job. These pin
files are per-account and per-job (suffixed with the cron job name and account
slug), so multiple FollowBrief accounts and job types can use different
runtimes on the same machine. The runner reads them at fire time; if you skip
the runtime pin the scheduled job falls back to the discovery chain (which
prompts for permissions every run). `regenerate-digest-cron-$ACCOUNT_SLUG` is
`1` when the schedule was configured to re-generate today's digest and `0`
otherwise; the runner turns `1` into the `--regenerate` flag so each recurring
run replaces the account's existing same-day digest instead of stacking a
duplicate.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
printf '{{AGENT_RUNTIME}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime-digest-cron-$ACCOUNT_SLUG"
printf '{{DIGEST_REGENERATE}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/regenerate-digest-cron-$ACCOUNT_SLUG"
```

5. Verify the runtime CLI is on PATH for the scheduler. Schedulers (launchd and
cron) run with a minimal PATH; the runner injects
`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, so the relevant binary must
live in one of those. Check:

```bash
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" command -v {{AGENT_RUNTIME}}
```

If the path printed is empty, install or symlink the CLI into
`/usr/local/bin` before continuing — the scheduler will not find it otherwise.

6. Install the schedule to run {{CRON_FREQUENCY_LABEL}}. Pick the path for this
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
<key>StandardOutPath</key><string>$HOME/.builder-blog/logs/$LABEL.log</string>
<key>StandardErrorPath</key><string>$HOME/.builder-blog/logs/$LABEL.log</string>
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
ACCT="${BUILDER_BLOG_ACCOUNT}"; LABEL="com.followbrief.digest.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief digest cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh digest-cron" ; printf "# FollowBrief digest cron · %s\n{{CRON_SCHEDULE}} BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh digest-cron >> %s/.builder-blog/logs/%s.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" "$LABEL" ) | crontab -
crontab -l | grep 'builder-agent-runner.sh digest-cron'
```

7. Run one immediate smoke check. This runs in your current session (which has
keychain access), so it validates the local digest pipeline without writing a
DigestRun, digest, or digested-item markers to FollowBrief. The recurring
launchd/crontab job is the only run that should sync web state:

```bash
BUILDER_BLOG_DISABLE_WEB_SYNC=1 \
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
$HOME/.builder-blog/builder-agent-runner.sh digest-cron
```

Just report its output: it succeeds when the digest is generated locally and
the final sync step prints `webSyncDisabled: true`. If it errors, report the
command, exit code, and stderr, and stop. If the pinned runtime CLI is not
installed, do not claim the digest cron is installed successfully — record that
the user must install {{AGENT_RUNTIME_LABEL}} (or set
`BUILDER_BLOG_AGENT_COMMAND`) first.

8. After the smoke check succeeds, report the active scheduled job to
FollowBrief. Do not run this before the smoke check succeeds.

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job digest-cron \
  --status active \
  --freq "{{CRON_FREQUENCY_KEY}}" \
  --label "{{CRON_FREQUENCY_LABEL}}" \
  --schedule "{{CRON_SCHEDULE}}" \
  --runtime "{{AGENT_RUNTIME}}" \
  --regenerate "{{DIGEST_REGENERATE}}"
```

Multiple FollowBrief accounts can share one machine: each gets its own
account-scoped LaunchAgent label (macOS) or cron marker (Linux), so installing
one never touches another's, and re-running replaces only this account's.
