Set up the FollowBrief subscription digest scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
except where step 3 requires it (confirming whether to replace an existing
digest cron), or when crontab permissions or a missing local agent runtime
blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not browse for extra context. Do not invoke any other
skill, plugin, or subagent — run the numbered steps yourself exactly as written;
this prompt is the whole task.

This setup prompt only orchestrates scheduler setup. The real digest build
happens only through the runner command in step 6; do not manually produce
digest JSON or sync digest state outside the numbered commands.

Scheduled runtime: **{{AGENT_RUNTIME_LABEL}}** ({{AGENT_RUNTIME}}). Every step
below uses this pinned runtime; do not fall back to a different one.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Create required directories and verify this account's local credential before
changing scheduler state. The web Copy-prompt version runs a one-time exchange
step after step 1 and before this check; static local copies cannot create the account file
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
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
FOUND=0
if launchctl list 2>/dev/null | awk '{ print $3 }' | grep -x "$LABEL"; then
  FOUND=1
fi
if [ -f "$PLIST" ]; then
  echo "LaunchAgent plist exists: $PLIST"
  FOUND=1
fi
if [ "$FOUND" -eq 0 ]; then
  echo "(none found)"
fi
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

On an override, do not unload the existing schedule here. Leave it loaded through
the initial run and let step 7 replace it atomically (its install block boots
out the old job, then bootstraps the new one) only after the initial run has passed —
so a failed initial run never tears down a working schedule and leaves the account
with none.

4. Keep the selected runtime and digest mode scoped to this setup run until the
initial run passes. Do not write cron pin files yet: on an override
setup, the old schedule is still loaded, and writing new pins early could make
that old schedule run with the new runtime before this setup has been proven.
The initial run command below passes the selected settings as env vars; step 7
writes the pins immediately before installing the new schedule.

5. Verify the runtime CLI is on PATH for the scheduler. Schedulers (launchd and
cron) do not inherit the interactive shell PATH; the runner injects this
FollowBrief scheduler-safe PATH so default user-level installs can still be
found:

```bash
SCHEDULER_PATH="$HOME/.local/bin:$HOME/bin:$HOME/.codex/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
PATH="$SCHEDULER_PATH" command -v {{AGENT_RUNTIME}}
```

If the path printed is empty, stop before installing the schedule: the selected
runtime is not installed in a location FollowBrief can find from launchd/cron.
Reinstall that runtime with its normal installer, or configure
`BUILDER_BLOG_AGENT_COMMAND` to an absolute command path, then re-run this
setup prompt.

For OpenClaw only, also verify that scheduled runs will not wait for exec
approval prompts. Do not change OpenClaw policy from this setup prompt; just
fail fast if this machine is configured to ask. The user can either configure
OpenClaw for unattended exec or choose a different Local Agent. This setup
prompt raises OpenClaw's response timeout to the scheduled FollowBrief job
timeout when needed, and the runner does the same before each unattended run.

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

6. Run one real initial digest job now. This runs on this machine through the
selected local runtime, uses the selected digest mode, and performs the same
candidate preparation, agent JSON output, rendering, and web-sync work as the
recurring `digest-cron` job. It is recorded as a one-time setup run, not a
scheduled window. This can take until the normal job timeout; do not treat a lack
of output as a hang before the command exits or the runner timeout fires.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
SETUP_TMP_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron-direct"
mkdir -p "$SETUP_TMP_DIR"
BUILDER_BLOG_JOB_TMP_DIR="$SETUP_TMP_DIR" \
BUILDER_BLOG_WORKER_MODE=1 \
BUILDER_BLOG_JOB_TRIGGER=one_time \
BUILDER_BLOG_AGENT_RUNTIME="{{AGENT_RUNTIME}}" \
BUILDER_BLOG_DIGEST_REGENERATE="{{DIGEST_REGENERATE_FLAG}}" \
BUILDER_BLOG_INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
BUILDER_BLOG_ACCOUNT="$ACCT" \
$HOME/.builder-blog/builder-agent-runner.sh digest-cron
```

Report its output. It succeeds when the command exits 0 and the digest is
generated and synced to FollowBrief. This is a real run: it writes a DigestRun,
digest, and digested-item markers. If it errors or times out, report the
command, exit code, and stderr, and stop — do not install the schedule in step
7. If the pinned runtime CLI is not installed, do not claim the digest cron is
installed successfully — record that the user must install
{{AGENT_RUNTIME_LABEL}} (or set `BUILDER_BLOG_AGENT_COMMAND`) first.

7. Only after the initial run has succeeded, pin the
scheduled runtime/digest mode and install the schedule to run
{{CRON_FREQUENCY_LABEL}}. Installing it last means the schedule is never armed
while the unmanaged initial run above is still executing, and a pipeline that
failed the initial run never gets scheduled. The concrete launchd/crontab
schedule is generated from this install time after validation succeeds. The
first scheduled digest window is install anchor + {{CRON_INTERVAL_MINUTES}}
minutes, and later windows stay on that same anchor, so long previous runs
cannot drift the cadence. Pick the path for this machine's OS — run `uname` if
unsure.

Write the per-account, per-job pins immediately before installing the schedule:
`runtime-digest-cron-$ACCOUNT_SLUG` makes the runner use the picked agent's
unattended mode, and `regenerate-digest-cron-$ACCOUNT_SLUG` controls whether
the recurring job replaces the existing same-day digest.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
ANCHOR_FILE="$AGENT_DIR/schedule-anchor-digest-cron-$ACCOUNT_SLUG"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron-schedule"
printf '{{AGENT_RUNTIME}}\n' > "$AGENT_DIR/runtime-digest-cron-$ACCOUNT_SLUG"
printf '{{DIGEST_REGENERATE}}\n' > "$AGENT_DIR/regenerate-digest-cron-$ACCOUNT_SLUG"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$ANCHOR_FILE"
ANCHOR_AT="$(cat "$ANCHOR_FILE")"
mkdir -p "$SCHEDULE_SPEC_DIR"
node "$AGENT_DIR/builder-digest.mjs" schedule-spec \
  --freq "{{CRON_FREQUENCY_KEY}}" \
  --anchor-file "$ANCHOR_FILE" \
  --cron-out "$SCHEDULE_SPEC_DIR/cron.txt" \
  --launchd-out "$SCHEDULE_SPEC_DIR/launchd.xml" \
  --status-out "$SCHEDULE_SPEC_DIR/status.txt"
```

### macOS (`uname` is Darwin) → launchd LaunchAgent

On macOS you MUST use a launchd LaunchAgent, not cron. A LaunchAgent runs
inside your login session, so it can reach the login keychain and the pinned
agent ({{AGENT_RUNTIME_LABEL}}) is authenticated. Plain `cron` runs outside
your session and cannot reach the keychain, so the agent CLI fails every run
with "Not logged in". The generated plist uses `StartCalendarInterval`
entries derived from the install anchor.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron-schedule"
LAUNCHD_SCHEDULE_XML="$(cat "$SCHEDULE_SPEC_DIR/launchd.xml")"
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
<dict>
<key>BUILDER_BLOG_ACCOUNT</key><string>$ACCT</string>
<key>BUILDER_BLOG_SCHEDULER_TICK</key><string>1</string>
<key>BUILDER_BLOG_INTERVAL_MINUTES</key><string>{{CRON_INTERVAL_MINUTES}}</string>
<key>INTERVAL_MINUTES</key><string>{{CRON_INTERVAL_MINUTES}}</string>
</dict>
$LAUNCHD_SCHEDULE_XML
<key>StandardOutPath</key><string>$HOME/.builder-blog/logs/$LABEL.log</string>
<key>StandardErrorPath</key><string>$HOME/.builder-blog/logs/$LABEL.log</string>
</dict>
</plist>
PLISTEOF
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_bootout_start --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason setup_replace
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
BOOTOUT_CODE="$?"
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_bootout_finished --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason "exit_$BOOTOUT_CODE"
if launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_bootstrap_succeeded --label "$LABEL" --plist-exists 1 --reason setup_install
else
  BOOTSTRAP_CODE="$?"
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_bootstrap_failed --label "$LABEL" --plist-exists 1 --reason "exit_$BOOTSTRAP_CODE"
  exit "$BOOTSTRAP_CODE"
fi
launchctl enable "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state =|program ="
```

### Linux / other (no keychain) → crontab

The agent CLI's token is a plain file there, so cron works. This removes any
previous FollowBrief digest job for this account, then installs one idempotent
job:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron-schedule"
CRON_SCHEDULE_EXPR="$(cat "$SCHEDULE_SPEC_DIR/cron.txt")"
LABEL="com.followbrief.digest.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
(
  crontab -l 2>/dev/null | grep -v "# FollowBrief digest cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh digest-cron"
  printf "# FollowBrief digest cron · %s\n%s BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh digest-cron >> %s/.builder-blog/logs/%s.log 2>&1\n" "$ACCT" "$CRON_SCHEDULE_EXPR" "$ACCT" "$HOME" "$HOME" "$LABEL"
) | crontab -
BUILDER_BLOG_ACCOUNT="$ACCT" node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-audit --job digest-cron --event crontab_install_succeeded --label "$LABEL" --reason setup_install
crontab -l | grep 'builder-agent-runner.sh digest-cron'
```

8. After the schedule is installed, report the active scheduled job to
FollowBrief. Do not run this before the initial run and schedule install have
both finished successfully.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
ANCHOR_FILE="$AGENT_DIR/schedule-anchor-digest-cron-$ACCOUNT_SLUG"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron-schedule"
ANCHOR_AT="$(cat "$ANCHOR_FILE")"
SCHEDULE_STATUS="$(cat "$SCHEDULE_SPEC_DIR/status.txt")"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job digest-cron \
  --status active \
  --freq "{{CRON_FREQUENCY_KEY}}" \
  --label "{{CRON_FREQUENCY_LABEL}}" \
  --schedule "$SCHEDULE_STATUS" \
  --started-at "$ANCHOR_AT" \
  --runtime "{{AGENT_RUNTIME}}" \
  --regenerate "{{DIGEST_REGENERATE}}"
```
