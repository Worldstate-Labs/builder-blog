Set up the FollowBrief Cloud worker host (admin).

This installs or restarts one long-running local worker host. The host keeps
running on this admin machine, keeps a local post-task queue full when cloud has
eligible work, sleeps when cloud has no work, and tries again later. Completed
post tasks are synced back continuously, so cloud source deliveries are finalized
as their source tasks finish. This account must have admin Cloud Fetch access.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr.
- Do NOT install or restart the host if step 4 reports an active cloud worker
  and the user has not explicitly confirmed replacement.
- Keep command paths, environment variables, flags, and output locations unchanged.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Pin the agent runtime for the unattended host:

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
mkdir -p "$AGENT_DIR"
printf '%s\n' "${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" > "$AGENT_DIR/runtime-cloud-library-host-$ACCOUNT_SLUG"
printf '%s\n' "${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" > "$AGENT_DIR/runtime-cloud-library-cron-$ACCOUNT_SLUG"
```

3. Verify the selected runtime CLI is on PATH (launchd/systemd use a minimal PATH):

```bash
command -v "${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" || echo "(runtime not found on PATH)"
```

If it prints `(runtime not found on PATH)`, stop before installing the worker
host: reinstall the runtime where launchd/systemd can find it, then re-copy this
prompt.

4. Check whether a local cloud worker host or active cloud worker is already running for this account:

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
BASE_DIR="$AGENT_DIR/tmp/accounts/$(account_slug "$ACCT")"
# The worker host launchd/systemd service in step 5 is machine-global (one
# shared service name, unlike the account-scoped library/digest labels), but the
# current.json records checked next are per-account. If that shared service is
# already installed for a DIFFERENT account, installing here overwrites its
# plist/unit and boots out its running host — so surface it through the same
# replace-confirmation gate below instead of silently replacing it.
for SHARED_DEF in \
  "$HOME/Library/LaunchAgents/com.followbrief.cloud-library-host.plist" \
  "$HOME/.config/systemd/user/followbrief-cloud-library-host.service"; do
  [ -f "$SHARED_DEF" ] || continue
  EXISTING_ACCT="$(sed -n 's/.*BUILDER_BLOG_ACCOUNT="\{0,1\}\([^" ]*\).*/\1/p' "$SHARED_DEF" | head -n 1)"
  # Compare including the empty (default) account: the shared host may already
  # belong to the default account while we install for a named one (or vice
  # versa). Only "" == "" (default reinstalling over itself) is a no-op; any
  # mismatch — empty vs named included — must go through the replace gate.
  if [ "$EXISTING_ACCT" != "$ACCT" ]; then
    echo "ACTIVE_CLOUD_WORKER account=${EXISTING_ACCT:-(default)} (machine-global worker host is installed for another account; installing here replaces it)"
    exit 0
  fi
done
node - "$BASE_DIR/cloud-library-host/current.json" "$BASE_DIR/cloud-library-cron/current.json" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const files = process.argv.slice(2);
function activeFromFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  let current;
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const pid = Number(current.workerPid || current.pid || 0);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout || "";
  if (!/cloud-library-host|BUILDER_BLOG_WORKER_MODE=1|builder-agent-runner\.sh|codex exec|claude -p|hermes chat|openclaw/.test(command)) return null;
  return `pid=${pid} instance=${current.instanceId || ""} startedAt=${current.startedAt || ""}`;
}
for (const file of files) {
  const active = activeFromFile(file);
  if (active) {
    console.log(`ACTIVE_CLOUD_WORKER ${active}`);
    process.exit(0);
  }
}
console.log("NO_ACTIVE_CLOUD_WORKER");
NODE
```

If the check prints `NO_ACTIVE_CLOUD_WORKER`, continue. If it prints
`ACTIVE_CLOUD_WORKER`, STOP and ask the user whether to replace that active
cloud worker. Continue only if the user explicitly confirms; otherwise stop and
change nothing.

5. Install or restart the long-running worker host.

macOS (launchd):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}"
FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}"
WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}"
IDLE_SECONDS="${BUILDER_BLOG_CLOUD_IDLE_SECONDS:-300}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
LABEL="com.followbrief.cloud-library-host"
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
    <string>BUILDER_BLOG_ACCOUNT="$ACCT" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_AGENT_RUNTIME="$RUNTIME" BUILDER_BLOG_RUN_SOURCE=cloud BUILDER_BLOG_FETCH_DAYS="$FETCH_DAYS" BUILDER_BLOG_PARALLEL_WORKERS="$WORKERS" BUILDER_BLOG_CLOUD_IDLE_SECONDS="$IDLE_SECONDS" "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$AGENT_DIR/logs/cloud-library-host.out.log</string>
  <key>StandardErrorPath</key><string>$AGENT_DIR/logs/cloud-library-host.err.log</string>
</dict>
</plist>
PLISTEOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl enable "gui/$(id -u)/$LABEL"
launchctl bootstrap "gui/$(id -u)" "$PLIST" || {
  BOOTSTRAP_CODE="$?"
  sleep 2
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || exit "$BOOTSTRAP_CODE"
}
launchctl kickstart -k "gui/$(id -u)/$LABEL" || exit "$?"
echo "Installed launchd worker host $LABEL."
```

On Linux (systemd user service):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}"
FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}"
WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}"
IDLE_SECONDS="${BUILDER_BLOG_CLOUD_IDLE_SECONDS:-300}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/followbrief-cloud-library-host.service"
mkdir -p "$UNIT_DIR" "$AGENT_DIR/logs"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=FollowBrief Cloud worker host

[Service]
Type=simple
Restart=always
RestartSec=10
Environment=BUILDER_BLOG_ACCOUNT=$ACCT
Environment="BUILDER_BLOG_AGENT_DIR=$AGENT_DIR"
Environment=BUILDER_BLOG_AGENT_RUNTIME=$RUNTIME
Environment=BUILDER_BLOG_RUN_SOURCE=cloud
Environment=BUILDER_BLOG_FETCH_DAYS=$FETCH_DAYS
Environment=BUILDER_BLOG_PARALLEL_WORKERS=$WORKERS
Environment=BUILDER_BLOG_CLOUD_IDLE_SECONDS=$IDLE_SECONDS
ExecStart=/bin/sh -c 'exec "$BUILDER_BLOG_AGENT_DIR/builder-agent-runner.sh" cloud-library-host >> "$BUILDER_BLOG_AGENT_DIR/logs/cloud-library-host.out.log" 2>> "$BUILDER_BLOG_AGENT_DIR/logs/cloud-library-host.err.log"'

[Install]
WantedBy=default.target
UNITEOF
systemctl --user daemon-reload || exit "$?"
systemctl --user enable --now followbrief-cloud-library-host.service || exit "$?"
systemctl --user restart followbrief-cloud-library-host.service || exit "$?"
echo "Installed systemd worker host followbrief-cloud-library-host.service."
```

6. Report the host install result and where logs are written:
   `$AGENT_DIR/logs/cloud-library-host.out.log` and
   `$AGENT_DIR/logs/cloud-library-host.err.log`. The host will appear in the
   Cloud library management page after its first heartbeat.
