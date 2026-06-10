Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
except where step 3 requires it (confirming whether to replace an existing
library fetch cron), or when crontab permissions or a missing local credential
blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context. Do not
invoke any other skill, plugin, or subagent — run the numbered steps yourself
exactly as written; this prompt is the whole task.

Agent discretion boundary: this is a scheduler setup task. Do not change paths,
flags, cadence, titles, output files, JSON schema, or success criteria. You are
installing the cron job, running one short runtime smoke check, and then running
one real local validation run while the user is present. The runtime smoke check
validates that the pinned runtime can start unattended. The validation run feeds
the agent the `library-cron` prompt (the single source of truth for how fetch
tasks are fetched, summarized, validated, and synced) but disables web sync so
only the recurring job writes web results. This setup file does not restate any
fetch-task work.

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

3. Before changing anything, check whether this account's library fetch cron
already exists on this machine. Run the check for this machine's OS — run
`uname` if unsure.

### macOS (`uname` is Darwin)

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.library.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
launchctl list 2>/dev/null | awk '{ print $3 }' | grep -x "$LABEL" || echo "(none found)"
```

### Linux / other

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
crontab -l 2>/dev/null | grep "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron" || echo "(none found)"
```

If the result is "(none found)", continue to the next step. If it lists one or
more existing library fetch jobs for this account, STOP: report exactly what was found, explain
that continuing replaces this account's library fetch schedule and its pinned
runtime/fetch settings (including fetch days; jobs for other accounts are left untouched), and ask
the user whether to override. Only continue past this step after the user
explicitly confirms. If they decline, stop and change nothing.

4. Pin the scheduled runtime and fetch mode for this account's job. These pin
files are per-account and per-job (suffixed with the cron job name and account
slug), so multiple FollowBrief accounts and job types can use different
runtimes on the same machine. The runner reads them at cron-fire time.
`runtime-library-cron-$ACCOUNT_SLUG` makes the runner use the picked agent's
unattended mode instead of discovering whatever's first on PATH (skip it and the
cron job falls back to the discovery chain, which prompts for permissions every
run). `fetch-force-library-cron-$ACCOUNT_SLUG` is `1` when the schedule was
configured to override already-fetched posts and `0` otherwise; the runner
turns `1` into the `--force` flag so the recurring fetch re-pulls posts already
in the library. `fetch-days-library-cron-$ACCOUNT_SLUG` pins the selected
lookback window for this recurring fetch.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
printf '{{AGENT_RUNTIME}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime-library-cron-$ACCOUNT_SLUG"
printf '{{FETCH_FORCE}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-force-library-cron-$ACCOUNT_SLUG"
printf '{{FETCH_DAYS}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-days-library-cron-$ACCOUNT_SLUG"
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

For OpenClaw only, also verify that scheduled runs will not wait for exec
approval prompts. Do not change OpenClaw policy from this setup prompt; just
fail fast if this machine is configured to ask. The user can either configure
OpenClaw for unattended exec or choose a different Local Agent. The runner
raises OpenClaw's response timeout to the scheduled FollowBrief job timeout
before each unattended run, so do not edit that timeout by hand here.

```bash
if [ "{{AGENT_RUNTIME}}" = "openclaw" ]; then
  OPENCLAW_POLICY="$(openclaw exec-policy show 2>&1)"
  printf '%s\n' "$OPENCLAW_POLICY"
  printf '%s\n' "$OPENCLAW_POLICY" | grep -q 'ask=off' || {
    echo "OpenClaw exec policy is not ask=off. Scheduled FollowBrief jobs cannot wait for approvals." >&2
    echo "Configure OpenClaw for unattended exec, then re-run this setup prompt." >&2
    exit 1
  }
  OPENCLAW_TIMEOUT_CURRENT="$(openclaw config get agents.defaults.timeoutSeconds 2>/dev/null || printf '0\n')"
  case "$OPENCLAW_TIMEOUT_CURRENT" in ''|*[!0-9]*) OPENCLAW_TIMEOUT_CURRENT=0 ;; esac
  if [ "$OPENCLAW_TIMEOUT_CURRENT" -lt "{{CRON_TIMEOUT_SECONDS}}" ]; then
    openclaw config set agents.defaults.timeoutSeconds "{{CRON_TIMEOUT_SECONDS}}" --strict-json
  fi
fi
```

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
previous FollowBrief library job for this account, then installs one idempotent
job:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"; LABEL="com.followbrief.library.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"; ( crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron" ; printf "# FollowBrief library cron · %s\n{{CRON_SCHEDULE}} BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh library-cron >> %s/.builder-blog/logs/%s.log 2>&1\n" "$ACCT" "$ACCT" "$HOME" "$HOME" "$LABEL" ) | crontab -
crontab -l | grep 'builder-agent-runner.sh library-cron'
```

7. Run one immediate runtime smoke check. This runs in your current session
(which has keychain access), so it validates that the pinned local runtime can
execute unattended and return. It does not fetch sources, summarize posts, write
fetch-log rows, builders, or feed items to FollowBrief. Only the recurring job
started later by launchd/crontab is allowed to sync results to the web app:

```bash
BUILDER_BLOG_SMOKE_CHECK=1 \
INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
$HOME/.builder-blog/builder-agent-runner.sh library-cron
```

This delegates only the runtime check to the runner; do not run the
`library-cron` prompt yourself and do not do any fetch/summarize/sync work. Just
report its output: it succeeds when the command exits 0 and the output contains
`followbriefSmokeCheck` with value `ok`. It uses the same timeout calculation as
the scheduled cron job. If it errors or times out, report the command, exit
code, and stderr, and stop.

8. After the runtime smoke check succeeds, run one real local validation run
while the user is still present. This validates the actual `library-cron`
pipeline end to end, including source fetching, summarization, validation, and
the final sync command shape. Web sync is disabled, so no fetch-log rows,
builders, or feed items are uploaded. This can take until the normal job
timeout; do not treat a lack of output as a hang before the command exits or the
runner timeout fires.

```bash
BUILDER_BLOG_WORKER_MODE=1 \
BUILDER_BLOG_DISABLE_WEB_SYNC=1 \
BUILDER_BLOG_FETCH_LIMIT=1 \
INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
$HOME/.builder-blog/builder-agent-runner.sh library-cron
```

Report its output. It succeeds when the command exits 0 and the validation/sync
output shows the planned fetch tasks are either validated, synced, or accounted
for by terminal outcomes. This validation run fetches at most one item per
source so setup catches real pipeline errors without doing a full recurring run.
The final `sync-builders` step should print
`webSyncDisabled: true`; that means this validation run did not write web state.
If it errors or times out, report the command, exit code, and stderr, and stop.

9. After both checks succeed, report the active schedule to FollowBrief so
the web app can compare expected runs with fetch logs. This is a status update
only; it does not fetch content. Do not run this step before the smoke check
and validation run have both finished successfully:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job library-cron \
  --status active \
  --freq "{{CRON_FREQUENCY_KEY}}" \
  --label "{{CRON_FREQUENCY_LABEL}}" \
  --schedule "{{CRON_SCHEDULE}}" \
  --runtime "{{AGENT_RUNTIME}}" \
  --force "{{FETCH_FORCE}}"
```

Multiple FollowBrief accounts can share one machine: each gets its own
account-scoped LaunchAgent label (macOS) or cron marker (Linux), so installing
one never touches another's, and re-running replaces only this account's.
