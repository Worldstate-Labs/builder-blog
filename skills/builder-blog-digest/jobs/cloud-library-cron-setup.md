Set up the FollowBrief Cloud worker host (admin).

This installs one machine-global, long-running local worker host. The host is
owned by one FollowBrief account at a time. It keeps the Cloud post-task queue
moving, sleeps while no eligible work exists, and syncs completed work back to
FollowBrief continuously.

Execution contract:
- Run only the numbered shell blocks below, in order, and only the block for
  this machine's OS where a step has OS-specific alternatives.
- If a command fails, stop and report the command, exit code, and stderr.
- Step 3 is read-only. Do not continue past it when it reports
  `BLOCKED_CLOUD_WORKER`.
- If step 3 reports `ACTIVE_CLOUD_WORKER`, STOP and ask the user whether to
  replace that active Cloud worker. Run step 4 only after explicit confirmation.
- If step 3 reports `NO_ACTIVE_CLOUD_WORKER`, step 4 may run without another
  question; it only reconciles stale state in that case.
- Do not write the new runtime pins or service definition until step 4 finishes.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Verify the selected unattended runtime is available on PATH:

```bash
command -v "${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" || {
  echo "runtime not found on PATH: ${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" >&2
  exit 69
}
```

3. Check whether a local cloud worker host or active cloud worker is already running.
This step also resolves the owner of the shared service. It refuses to proceed
when a loaded service owner cannot be proven.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.cloud-library-host"
UNIT_NAME="followbrief-cloud-library-host.service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT="$HOME/.config/systemd/user/$UNIT_NAME"
SERVICE_FILE=""
SERVICE_LOADED=0
case "$(uname -s)" in
  Darwin)
    SERVICE_FILE="$PLIST"
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then SERVICE_LOADED=1; fi
    ;;
  *)
    command -v systemctl >/dev/null 2>&1 || {
      echo "BLOCKED_CLOUD_WORKER: systemctl is unavailable; service state cannot be proven" >&2
      exit 69
    }
    SERVICE_FILE="$UNIT"
    if systemctl --user is-active --quiet "$UNIT_NAME"; then SERVICE_LOADED=1; fi
    ;;
esac

SERVICE_ACCOUNT=""
SERVICE_OWNER_KNOWN=0
if [ -f "$SERVICE_FILE" ]; then
  if SERVICE_ACCOUNT="$(node -e 'const fs=require("node:fs"); const text=fs.readFileSync(process.argv[1], "utf8"); const match=text.match(/BUILDER_BLOG_ACCOUNT="([^"]*)"/) || text.match(/^Environment=BUILDER_BLOG_ACCOUNT=(.*)$/m); if (!match) process.exit(2); process.stdout.write(String(match[1]).replace(/^"|"$/g, ""));' "$SERVICE_FILE")"; then
    SERVICE_OWNER_KNOWN=1
  fi
fi
if [ "$SERVICE_LOADED" = "1" ] && [ "$SERVICE_OWNER_KNOWN" != "1" ]; then
  echo "BLOCKED_CLOUD_WORKER: loaded service owner cannot be proven" >&2
  exit 65
fi
if [ -f "$SERVICE_FILE" ] && [ "$SERVICE_OWNER_KNOWN" != "1" ]; then
  echo "BLOCKED_CLOUD_WORKER: installed service owner cannot be proven" >&2
  exit 65
fi

account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACTIVE_REASON=""
if [ "$SERVICE_LOADED" = "1" ]; then
  ACTIVE_REASON="loaded shared service"
elif [ "$SERVICE_OWNER_KNOWN" = "1" ] && [ "$SERVICE_ACCOUNT" != "$ACCT" ]; then
  ACTIVE_REASON="shared service is installed for another account"
fi
check_current_for_account() {
  _check_acct="$1"
  _check_base="$AGENT_DIR/tmp/accounts/$(account_slug "$_check_acct")"
  for _check_file in \
    "$_check_base/cloud-library-host/current.json" \
    "$_check_base/cloud-library-cron/current.json"; do
    [ -r "$_check_file" ] || continue
    if node - "$_check_file" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
let current;
try { current = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { process.exit(1); }
const pid = Number(current.workerPid || 0);
if (!Number.isInteger(pid) || pid <= 0) process.exit(1);
try { process.kill(pid, 0); } catch { process.exit(1); }
const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout || "";
process.exit(command.includes("builder-agent-runner.sh") ? 0 : 1);
NODE
    then
      ACTIVE_REASON="recorded FollowBrief runner is alive for ${_check_acct:-(default)}"
    fi
  done
}
check_current_for_account "$ACCT"
if [ "$SERVICE_OWNER_KNOWN" = "1" ] && [ "$SERVICE_ACCOUNT" != "$ACCT" ]; then
  check_current_for_account "$SERVICE_ACCOUNT"
fi
if [ -n "$ACTIVE_REASON" ]; then
  EXISTING_ACCT="$ACCT"
  if [ "$SERVICE_OWNER_KNOWN" = "1" ]; then EXISTING_ACCT="$SERVICE_ACCOUNT"; fi
  echo "ACTIVE_CLOUD_WORKER account=${EXISTING_ACCT:-(default)} reason=$ACTIVE_REASON"
else
  echo "NO_ACTIVE_CLOUD_WORKER"
fi
```

If this prints `ACTIVE_CLOUD_WORKER`, ask the user whether to replace that active
worker. Continue only if the user explicitly confirms; otherwise stop and change
nothing.

4. Reconcile the old account state, remove the old shared service, verify it is
absent, and stop the old runner. The first control action records `replaced`
before service mutation. The second performs exact-PID termination and will
preserve `current.json` if termination or the terminal status update fails.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.cloud-library-host"
UNIT_NAME="followbrief-cloud-library-host.service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT="$HOME/.config/systemd/user/$UNIT_NAME"
SERVICE_FILE="$UNIT"
[ "$(uname -s)" = "Darwin" ] && SERVICE_FILE="$PLIST"
if [ "$(uname -s)" != "Darwin" ] && ! command -v systemctl >/dev/null 2>&1; then
  echo "BLOCKED_CLOUD_WORKER: systemctl is unavailable; service state cannot be proven" >&2
  exit 69
fi
EXISTING_ACCT="$ACCT"
if [ -f "$SERVICE_FILE" ]; then
  if ! EXISTING_ACCT="$(node -e 'const fs=require("node:fs"); const text=fs.readFileSync(process.argv[1], "utf8"); const match=text.match(/BUILDER_BLOG_ACCOUNT="([^"]*)"/) || text.match(/^Environment=BUILDER_BLOG_ACCOUNT=(.*)$/m); if (!match) process.exit(2); process.stdout.write(String(match[1]).replace(/^"|"$/g, ""));' "$SERVICE_FILE")"; then
    echo "installed service owner cannot be proven" >&2
    exit 65
  fi
fi

BUILDER_BLOG_ACCOUNT="$EXISTING_ACCT" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1 BUILDER_BLOG_CLOUD_HOST_CONTROL=mark-replaced \
  "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host
if [ "$EXISTING_ACCT" != "$ACCT" ]; then
  BUILDER_BLOG_ACCOUNT="$ACCT" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1 BUILDER_BLOG_CLOUD_HOST_CONTROL=mark-replaced \
    "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host
fi

case "$(uname -s)" in
  Darwin)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "gui/$(id -u)/$LABEL" || exit "$?"
    fi
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "shared launchd service is still loaded" >&2
      exit 75
    fi
    rm -f "$PLIST" || exit "$?"
    ;;
  *)
    if systemctl --user is-active --quiet "$UNIT_NAME"; then
      systemctl --user stop "$UNIT_NAME" || exit "$?"
    fi
    if systemctl --user is-enabled --quiet "$UNIT_NAME"; then
      systemctl --user disable "$UNIT_NAME" || exit "$?"
    fi
    if systemctl --user is-active --quiet "$UNIT_NAME"; then
      echo "shared systemd service is still active" >&2
      exit 75
    fi
    rm -f "$UNIT" || exit "$?"
    systemctl --user daemon-reload || exit "$?"
    ;;
esac

BUILDER_BLOG_ACCOUNT="$EXISTING_ACCT" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1 BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current \
  "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host
if [ "$EXISTING_ACCT" != "$ACCT" ]; then
  BUILDER_BLOG_ACCOUNT="$ACCT" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1 BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current \
    "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host
fi
echo "OLD_CLOUD_WORKER_STOPPED"
```

5. Pin the selected runtime for the new account only after the old host cleanup
has succeeded:

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

6. Install and start the new long-running worker host.

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
sleep 2
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || {
  echo "launchd worker host did not stay loaded: $LABEL" >&2
  exit 75
}
echo "Installed launchd worker host $LABEL."
```

Linux (systemd user service):

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
systemctl --user is-active --quiet followbrief-cloud-library-host.service || {
  echo "systemd worker host is not active: followbrief-cloud-library-host.service" >&2
  exit 75
}
echo "Installed systemd worker host followbrief-cloud-library-host.service."
```

7. Report the install result and log paths:
`$AGENT_DIR/logs/cloud-library-host.out.log` and
`$AGENT_DIR/logs/cloud-library-host.err.log`.
