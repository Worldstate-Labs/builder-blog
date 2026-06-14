Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
except where step 3 requires it (confirming whether to replace an existing
library fetch cron), or when crontab permissions or a missing local credential
blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context. Do not
invoke any other skill, plugin, or subagent — run the numbered steps yourself
exactly as written; this prompt is the whole task.

This setup prompt only orchestrates scheduler setup. The real fetch/summarize
work happens only through the runner command in step 6; do not manually perform
fetch-task work outside the numbered commands.

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

{{SOURCE_CREDENTIAL_PREP}}

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

On an override, do not unload the existing schedule here. Leave it loaded through
the initial run and let step 7 replace it atomically (its install block boots
out the old job, then bootstraps the new one) only after the initial run has passed —
so a failed initial run never tears down a working schedule and leaves the account
with none.

4. Keep the selected runtime and fetch mode scoped to this setup run until the
initial run passes. Do not write cron pin files yet: on an override
setup, the old schedule is still loaded, and writing new pins early could make
that old schedule run with the new runtime before this setup has been proven.
The initial run command below passes the selected settings as env vars; step 7
writes the pins immediately before installing the new schedule.

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

6. Run one real initial fetch job now. This runs in your current session (which
has keychain access), uses the selected runtime and fetch settings, and performs
the same fetch, summarize, validate, and web-sync work as the recurring
`library-cron` job. It is recorded as a one-time setup run, not a scheduled
window. This can take until the normal job timeout; do not treat a lack of
output as a hang before the command exits or the runner timeout fires.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
SETUP_TMP_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-direct"
mkdir -p "$SETUP_TMP_DIR"
BUILDER_BLOG_JOB_TMP_DIR="$SETUP_TMP_DIR" \
BUILDER_BLOG_WORKER_MODE=1 \
BUILDER_BLOG_JOB_TRIGGER=one_time \
BUILDER_BLOG_AGENT_RUNTIME="{{AGENT_RUNTIME}}" \
BUILDER_BLOG_FETCH_FORCE="{{FETCH_FLAG}}" \
BUILDER_BLOG_FETCH_DAYS="{{FETCH_DAYS}}" \
BUILDER_BLOG_PARALLEL_WORKERS="{{PARALLEL_WORKERS}}" \
BUILDER_BLOG_INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
$HOME/.builder-blog/builder-agent-runner.sh library-cron
```

Report its output. This is a real run: it writes fetch-log rows, builders, and
feed items to FollowBrief. If the command errors or times out, report the
command, exit code, and stderr, and stop — do not install the schedule in step
7.

After the command exits 0, run this gate before deciding whether to install the
schedule. It inspects the initial run's validation/sync artifacts and prints
post-level failures, if any:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-direct}"
node - "$TMP_DIR/library-fetch-result.json" "$TMP_DIR/library-agent-sync.json" <<'NODE'
const fs = require("fs");
const fetchFile = process.argv[2];
const syncFile = process.argv[3];
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
};
const fetchResult = readJson(fetchFile);
const syncPayload = readJson(syncFile);
const planned = new Map(
  (Array.isArray(fetchResult?.["fetch" + "Tasks"]) ? fetchResult["fetch" + "Tasks"] : [])
    .map((task) => [String(task.id || task.item?.externalId || task.item?.url || ""), task])
    .filter(([id]) => id),
);
const sourceLabel = (task) =>
  [task?.builder, task?.sourceType].filter(Boolean).join(" · ") || "Unknown source";
const titleLabel = (task, outcome) =>
  task?.title || task?.item?.title || task?.url || task?.item?.url || outcome.fetchTaskId;
const stageFor = (reason) => {
  const text = String(reason || "").toLowerCase();
  if (/summary|summariz|not_summarized/.test(text)) return "summarize";
  if (/sync|not_synced|persist/.test(text)) return "sync";
  return "read";
};
const failures = (Array.isArray(syncPayload?.taskOutcomes) ? syncPayload.taskOutcomes : [])
  .filter((outcome) => outcome?.status === "failed")
  .map((outcome) => {
    const task = planned.get(String(outcome.fetchTaskId)) || {};
    return {
      title: titleLabel(task, outcome),
      source: sourceLabel(task),
      stage: stageFor(outcome.reason || outcome.failureReason),
      reason: outcome.reason || outcome.failureReason || "failed",
    };
  });
console.log(JSON.stringify({ status: failures.length ? "needs_confirmation" : "ok", failures }, null, 2));
NODE
```

If the gate prints `"status": "ok"`, tell the user the validation run completed
without failed post tasks, then continue automatically to step 7 and install the
original scheduled job.

If the gate prints `"status": "needs_confirmation"`, list every failed post
task for the user with its title, source, failed stage (`read`, `summarize`, or
`sync`), and reason. Then ask whether to install the scheduled run anyway. Only
continue to step 7 if the user explicitly agrees; otherwise stop and do not
install or report an active schedule.

If this initial run surfaces an `x_token_missing` (or any `*_token_missing`)
notice, that is expected when the user declined or skipped that token in the
credential-prep step earlier. Report it as an "Action needed" notice and
continue — do NOT re-ask. That source stays in "Action needed" until its token
is added to `~/.builder-blog/secrets.json` later.

7. Only after the initial run has passed the schedule gate above, pin the
scheduled runtime/fetch settings and install the schedule to run
{{CRON_FREQUENCY_LABEL}}. Installing it last means the schedule is never armed
while the unmanaged initial run above is still executing, and a pipeline that
failed the initial run or was not approved after post-task failures never gets
scheduled. On macOS, the LaunchAgent runs a short scheduler tick every minute;
the real fetch windows are anchored to this install time plus
N × {{CRON_INTERVAL_MINUTES}} minutes, so a long previous run cannot drift the
next scheduled window. Pick the path for this machine's OS — run `uname` if
unsure.

Write the per-account, per-job pins immediately before installing the schedule:
`runtime-library-cron-$ACCOUNT_SLUG` makes the runner use the picked agent's
unattended mode; `fetch-force-library-cron-$ACCOUNT_SLUG` controls re-fetching
already-fetched posts; `fetch-days-library-cron-$ACCOUNT_SLUG` pins the lookback
window; and `parallel-library-cron-$ACCOUNT_SLUG` pins the worker count.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
printf '{{AGENT_RUNTIME}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime-library-cron-$ACCOUNT_SLUG"
printf '{{FETCH_FORCE}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-force-library-cron-$ACCOUNT_SLUG"
printf '{{FETCH_DAYS}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-days-library-cron-$ACCOUNT_SLUG"
printf '{{PARALLEL_WORKERS}}\n' > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/parallel-library-cron-$ACCOUNT_SLUG"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/schedule-anchor-library-cron-$ACCOUNT_SLUG"
```

### macOS (`uname` is Darwin) → launchd LaunchAgent

On macOS you MUST use a launchd LaunchAgent, not cron. A LaunchAgent runs
inside your login session, so it can reach the login keychain and the pinned
agent ({{AGENT_RUNTIME_LABEL}}) is authenticated. Plain `cron` runs outside
your session and cannot reach the keychain, so the agent CLI fails every run
with "Not logged in".

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
<dict>
<key>BUILDER_BLOG_ACCOUNT</key><string>$ACCT</string>
<key>BUILDER_BLOG_SCHEDULER_TICK</key><string>1</string>
<key>BUILDER_BLOG_INTERVAL_MINUTES</key><string>{{CRON_INTERVAL_MINUTES}}</string>
<key>INTERVAL_MINUTES</key><string>{{CRON_INTERVAL_MINUTES}}</string>
</dict>
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

8. After the schedule is installed, report the active schedule to FollowBrief so
the web app can compare expected runs with fetch logs. This is a status update
only; it does not fetch content. Do not run this step before the initial run and
schedule install have both finished successfully:

```bash
SCHEDULE_STATUS="{{CRON_SCHEDULE}}"
if [ "$(uname)" = "Darwin" ]; then
  SCHEDULE_STATUS="interval:{{CRON_INTERVAL_SECONDS}}"
fi
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job library-cron \
  --status active \
  --freq "{{CRON_FREQUENCY_KEY}}" \
  --label "{{CRON_FREQUENCY_LABEL}}" \
  --schedule "$SCHEDULE_STATUS" \
  --runtime "{{AGENT_RUNTIME}}" \
  --force "{{FETCH_FORCE}}"
```
