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
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap)"
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

{{SOURCE_CREDENTIAL_PREP}}

3. Before changing anything, check FollowBrief's server state for this
account's library fetch cron, then check whether the schedule already exists on
this machine. The server check detects another machine that may already own the
recurring schedule.

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-state --job library-cron
```

If the JSON output contains `"status": "active"`, STOP: report the current
frequency, runtime, hostname, platform, and ownerId from the server output,
explain that continuing replaces the server-authorized library fetch schedule
owner after this setup proves a new initial run and schedule install, and ask
the user whether to replace it. Only continue after the user explicitly
confirms. If they decline, stop and change nothing. Do not run `cron-status`
yet: the old server owner must remain authorized until this setup's initial run
and local schedule install both succeed.

Next, check whether this account's library fetch cron already exists on this
machine. Run the check for this machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin)

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
legacy_account_slug() {
  node - "${1:-default}" <<'NODE'
const account = String(process.argv[2] || "default");
console.log(account.replace(/[^a-zA-Z0-9]/g, "_"));
NODE
}
LABEL="com.followbrief.library.$(account_slug "$ACCT")"
LEGACY_LABEL="com.followbrief.library.$(legacy_account_slug "$ACCT")"
FOUND=0
for CANDIDATE_LABEL in "$LABEL" "$LEGACY_LABEL"; do
  PLIST="$HOME/Library/LaunchAgents/$CANDIDATE_LABEL.plist"
  if launchctl list 2>/dev/null | awk '{ print $3 }' | grep -x "$CANDIDATE_LABEL"; then
    FOUND=1
  fi
  if [ -f "$PLIST" ]; then
    echo "LaunchAgent plist exists: $PLIST"
    FOUND=1
  fi
done
if [ "$FOUND" -eq 0 ]; then
  echo "(none found)"
fi
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

6. Run one real initial fetch job now. This runs on this machine through the
selected local runtime, uses the selected fetch settings, and performs the same
fetch, summarize, validate, and web-sync work as the recurring `library-cron`
job. It is recorded as a one-time setup run, not a scheduled window. This can
take until the normal job timeout; do not treat a lack of output as a hang before
the command exits or the runner timeout fires.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "$ACCT")"
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
BUILDER_BLOG_ACCOUNT="$ACCT" \
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
ACCT="${BUILDER_BLOG_ACCOUNT}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "$ACCT")"
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
scheduled. The concrete launchd/crontab schedule is generated from this install
time after validation succeeds. The first scheduled fetch window is
install anchor + {{CRON_INTERVAL_MINUTES}} minutes, and later windows stay on
that same anchor, so long previous runs cannot drift the cadence. Pick the path
for this machine's OS — run `uname` if unsure.

Write the per-account, per-job pins immediately before installing the schedule:
`runtime-library-cron-$ACCOUNT_SLUG` makes the runner use the picked agent's
unattended mode; `fetch-force-library-cron-$ACCOUNT_SLUG` controls re-fetching
already-fetched posts; `fetch-days-library-cron-$ACCOUNT_SLUG` pins the lookback
window; and `parallel-library-cron-$ACCOUNT_SLUG` pins the worker count.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "$ACCT")"
ANCHOR_FILE="$AGENT_DIR/schedule-anchor-library-cron-$ACCOUNT_SLUG"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-schedule"
OWNER_FILE="$AGENT_DIR/cron-owner-library-cron-$ACCOUNT_SLUG"
if [ ! -s "$OWNER_FILE" ]; then
  node - "$ACCOUNT_SLUG" <<'NODE' > "$OWNER_FILE"
const { randomUUID } = require("node:crypto");
const os = require("node:os");
const accountSlug = process.argv[2] || "default";
const host = (os.hostname() || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
console.log(`local:${host}:${accountSlug}:library-cron:${randomUUID()}`);
NODE
  chmod 600 "$OWNER_FILE" 2>/dev/null || true
fi
printf '{{AGENT_RUNTIME}}\n' > "$AGENT_DIR/runtime-library-cron-$ACCOUNT_SLUG"
printf '{{FETCH_FORCE}}\n' > "$AGENT_DIR/fetch-force-library-cron-$ACCOUNT_SLUG"
printf '{{FETCH_DAYS}}\n' > "$AGENT_DIR/fetch-days-library-cron-$ACCOUNT_SLUG"
printf '{{PARALLEL_WORKERS}}\n' > "$AGENT_DIR/parallel-library-cron-$ACCOUNT_SLUG"
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
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "$ACCT")"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-schedule"
LAUNCHD_SCHEDULE_XML="$(cat "$SCHEDULE_SPEC_DIR/launchd.xml")"
LABEL="com.followbrief.library.$(account_slug "$ACCT")"
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
$LAUNCHD_SCHEDULE_XML
<key>StandardOutPath</key><string>$HOME/.builder-blog/logs/$LABEL.log</string>
<key>StandardErrorPath</key><string>$HOME/.builder-blog/logs/$LABEL.log</string>
</dict>
</plist>
PLISTEOF
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_bootout_start --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason setup_replace
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
BOOTOUT_CODE="$?"
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_bootout_finished --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason "exit_$BOOTOUT_CODE"
if launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_bootstrap_succeeded --label "$LABEL" --plist-exists 1 --reason setup_install
else
  BOOTSTRAP_CODE="$?"
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_bootstrap_failed --label "$LABEL" --plist-exists 1 --reason "exit_$BOOTSTRAP_CODE"
  exit "$BOOTSTRAP_CODE"
fi
launchctl enable "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state =|program ="
```

### Linux / other (no keychain) → crontab

The agent CLI's token is a plain file there, so cron works. This removes any
previous FollowBrief library job for this account, then installs one idempotent
job:

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "$ACCT")"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-schedule"
CRON_SCHEDULE_EXPR="$(cat "$SCHEDULE_SPEC_DIR/cron.txt")"
LABEL="com.followbrief.library.$(account_slug "$ACCT")"
(
  crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron"
  printf "# FollowBrief library cron · %s\n%s BUILDER_BLOG_ACCOUNT=\"%s\" %s/.builder-blog/builder-agent-runner.sh library-cron >> %s/.builder-blog/logs/%s.log 2>&1\n" "$ACCT" "$CRON_SCHEDULE_EXPR" "$ACCT" "$HOME" "$HOME" "$LABEL"
) | crontab -
BUILDER_BLOG_ACCOUNT="$ACCT" node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-audit --job library-cron --event crontab_install_succeeded --label "$LABEL" --reason setup_install
crontab -l | grep 'builder-agent-runner.sh library-cron'
```

8. After the schedule is installed, report the active schedule to FollowBrief so
the web app can compare expected runs with fetch logs. This is a status update
only; it does not fetch content. Do not run this step before the initial run and
schedule install have both finished successfully:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "$ACCT")"
ANCHOR_FILE="$AGENT_DIR/schedule-anchor-library-cron-$ACCOUNT_SLUG"
SCHEDULE_SPEC_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-schedule"
OWNER_FILE="$AGENT_DIR/cron-owner-library-cron-$ACCOUNT_SLUG"
OWNER_ID="$(cat "$OWNER_FILE")"
ANCHOR_AT="$(cat "$ANCHOR_FILE")"
SCHEDULE_STATUS="$(cat "$SCHEDULE_SPEC_DIR/status.txt")"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job library-cron \
  --status active \
  --freq "{{CRON_FREQUENCY_KEY}}" \
  --label "{{CRON_FREQUENCY_LABEL}}" \
  --schedule "$SCHEDULE_STATUS" \
  --started-at "$ANCHOR_AT" \
  --runtime "{{AGENT_RUNTIME}}" \
  --owner-id "$OWNER_ID" \
  --force "{{FETCH_FORCE}}"
```
