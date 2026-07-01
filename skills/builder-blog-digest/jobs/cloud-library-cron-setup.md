Set up scheduled FollowBrief Cloud worker sessions (admin).

This installs a recurring local schedule that starts a cloud worker session every
{{CRON_FREQUENCY_LABEL}}. Each session leases cloud sources, keeps the local
post-task queue fed until the queue is empty, a safety cap is reached, or the
runner time buffer is reached, then syncs results back. This account must have
admin Cloud Fetch access.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr.
- Do NOT install the schedule until the initial validation run in step 5 exits 0.
- Keep command paths, environment variables, flags, and output locations unchanged.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Pin the agent runtime so the scheduled run is unattended:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
mkdir -p "$AGENT_DIR"
printf '%s\n' "${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" > "$AGENT_DIR/cloud-runtime"
```

3. Verify the selected runtime CLI is on PATH (schedulers use a minimal PATH):

```bash
command -v "${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" || echo "(runtime not found on PATH)"
```

If the path printed is empty, stop before installing the schedule: reinstall the
runtime where launchd/cron can find it, then re-copy this prompt.

4. Check whether a local cloud worker is already running for this account:

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
CURRENT_FILE="$AGENT_DIR/tmp/accounts/$(account_slug "$ACCT")/cloud-library-cron/current.json"
node - "$CURRENT_FILE" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const file = process.argv[2];
function inactive() {
  console.log("NO_ACTIVE_CLOUD_WORKER");
}
if (!file || !fs.existsSync(file)) {
  inactive();
  process.exit(0);
}
let current;
try {
  current = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  inactive();
  process.exit(0);
}
const pid = Number(current.workerPid || current.pid || 0);
if (!Number.isFinite(pid) || pid <= 0) {
  inactive();
  process.exit(0);
}
try {
  process.kill(pid, 0);
} catch {
  inactive();
  process.exit(0);
}
const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout || "";
if (!/BUILDER_BLOG_WORKER_MODE=1|builder-agent-runner\.sh|codex exec|claude -p|hermes chat|openclaw/.test(command)) {
  inactive();
  process.exit(0);
}
console.log(`ACTIVE_CLOUD_WORKER pid=${pid} instance=${current.instanceId || ""} startedAt=${current.startedAt || ""}`);
NODE
```

If the check prints `NO_ACTIVE_CLOUD_WORKER`, continue. If it prints
`ACTIVE_CLOUD_WORKER`, STOP and ask the user whether to replace that active
cloud worker. Continue only if the user explicitly confirms; otherwise stop and
change nothing.

5. Run one real cloud worker session now to validate before scheduling:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_RUN_SOURCE=cloud \
BUILDER_BLOG_FETCH_LIMIT="${BUILDER_BLOG_FETCH_LIMIT-{{FETCH_LIMIT}}}" \
BUILDER_BLOG_FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}" \
BUILDER_BLOG_PARALLEL_WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}" \
"$AGENT_DIR/builder-agent-runner.sh" cloud-library-cron
```

If this exits non-zero, report the command, exit code, and stderr, and stop. Do
not install the schedule.

6. Install the recurring worker session schedule (every {{CRON_INTERVAL_MINUTES}} minutes).

macOS (launchd):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}"
POST_LIMIT="${BUILDER_BLOG_FETCH_LIMIT-{{FETCH_LIMIT}}}"
FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}"
WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
LABEL="com.followbrief.cloud-library-cron"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$AGENT_DIR/logs"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>BUILDER_BLOG_ACCOUNT="$ACCT" BUILDER_BLOG_AGENT_RUNTIME="$RUNTIME" BUILDER_BLOG_RUN_SOURCE=cloud BUILDER_BLOG_FETCH_LIMIT="$POST_LIMIT" BUILDER_BLOG_FETCH_DAYS="$FETCH_DAYS" BUILDER_BLOG_PARALLEL_WORKERS="$WORKERS" "$AGENT_DIR/builder-agent-runner.sh" cloud-library-cron</string>
  </array>
  <key>StartInterval</key><integer>{{CRON_INTERVAL_SECONDS}}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$AGENT_DIR/logs/cloud-library-cron.out.log</string>
  <key>StandardErrorPath</key><string>$AGENT_DIR/logs/cloud-library-cron.err.log</string>
</dict>
</plist>
PLISTEOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed launchd schedule $LABEL (every {{CRON_INTERVAL_MINUTES}} min)."
```

On Linux (no launchd), instead add an equivalent recurring job — a crontab entry
or systemd timer — that runs the SAME command from step 4 every
{{CRON_INTERVAL_MINUTES}} minutes, writing output to
`$AGENT_DIR/logs/cloud-library-cron.*.log`. Report the schedule you installed.

7. Report the installed schedule label/interval and the initial worker session result
   (cloud source tasks leased, succeeded, and failed).
