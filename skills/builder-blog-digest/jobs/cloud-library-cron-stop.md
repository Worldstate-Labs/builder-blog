Stop the FollowBrief Cloud worker host on this machine.

This is an account-scoped admin operation over a machine-global service. It
must never unload a service that belongs to another FollowBrief account. The
runner owns exact PID verification and terminal job status updates for both the
`cloud-library-host/current.json` and compatibility
`cloud-library-cron/current.json` records.

Execution contract:
- Run the numbered blocks in order and only the block for this machine's OS.
- If any command fails, stop and report the command, exit code, and stderr.
- Do not delete Cloud content, submissions, source tasks, or regular Fetch
  sources / AI Brief schedules.
- The service must be proven to belong to this account before it is unloaded.
  If a loaded service owner cannot be proven, stop without changing anything.
- Runtime pins are removed only after service removal and runner cleanup both
  succeed.

1. Install or refresh the skill so the strict lifecycle controls are current:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Verify ownership, unload this account's shared service, and prove it absent.

macOS (`uname -s` is `Darwin`):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
LABEL="com.followbrief.cloud-library-host"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVICE_LOADED=0
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then SERVICE_LOADED=1; fi
SERVICE_ACCOUNT=""
SERVICE_OWNER_KNOWN=0
if [ -f "$PLIST" ]; then
  if SERVICE_ACCOUNT="$(node -e 'const fs=require("node:fs"); const text=fs.readFileSync(process.argv[1], "utf8"); const match=text.match(/BUILDER_BLOG_ACCOUNT="([^"]*)"/); if (!match) process.exit(2); process.stdout.write(match[1]);' "$PLIST")"; then
    SERVICE_OWNER_KNOWN=1
  fi
fi
if [ "$SERVICE_LOADED" = "1" ] && [ "$SERVICE_OWNER_KNOWN" != "1" ]; then
  echo "loaded service owner cannot be proven; refusing to stop it" >&2
  exit 65
fi
if [ -f "$PLIST" ] && [ "$SERVICE_OWNER_KNOWN" != "1" ]; then
  echo "installed service owner cannot be proven; refusing to remove it" >&2
  exit 65
fi
if [ "$SERVICE_OWNER_KNOWN" = "1" ] && [ "$SERVICE_ACCOUNT" != "$ACCT" ]; then
  echo "service belongs to another FollowBrief account: ${SERVICE_ACCOUNT:-(default)}" >&2
  exit 77
fi
if [ "$SERVICE_LOADED" = "1" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" || exit "$?"
fi
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "service is still loaded: $LABEL" >&2
  exit 75
fi
rm -f "$PLIST" || exit "$?"
[ ! -f "$PLIST" ] || { echo "service definition still exists: $PLIST" >&2; exit 75; }
echo "SERVICE_ABSENT launchd $LABEL"
```

Linux (systemd user service):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
UNIT_NAME="followbrief-cloud-library-host.service"
UNIT="$HOME/.config/systemd/user/$UNIT_NAME"
command -v systemctl >/dev/null 2>&1 || {
  echo "systemctl is unavailable; service state cannot be proven" >&2
  exit 69
}
SERVICE_LOADED=0
if systemctl --user is-active --quiet "$UNIT_NAME"; then SERVICE_LOADED=1; fi
SERVICE_ACCOUNT=""
SERVICE_OWNER_KNOWN=0
if [ -f "$UNIT" ]; then
  if SERVICE_ACCOUNT="$(node -e 'const fs=require("node:fs"); const text=fs.readFileSync(process.argv[1], "utf8"); const match=text.match(/^Environment=BUILDER_BLOG_ACCOUNT=(.*)$/m); if (!match) process.exit(2); process.stdout.write(String(match[1]).replace(/^"|"$/g, ""));' "$UNIT")"; then
    SERVICE_OWNER_KNOWN=1
  fi
fi
if [ "$SERVICE_LOADED" = "1" ] && [ "$SERVICE_OWNER_KNOWN" != "1" ]; then
  echo "loaded service owner cannot be proven; refusing to stop it" >&2
  exit 65
fi
if [ -f "$UNIT" ] && [ "$SERVICE_OWNER_KNOWN" != "1" ]; then
  echo "installed service owner cannot be proven; refusing to remove it" >&2
  exit 65
fi
if [ "$SERVICE_OWNER_KNOWN" = "1" ] && [ "$SERVICE_ACCOUNT" != "$ACCT" ]; then
  echo "service belongs to another FollowBrief account: ${SERVICE_ACCOUNT:-(default)}" >&2
  exit 77
fi
if systemctl --user is-active --quiet "$UNIT_NAME"; then
  systemctl --user stop "$UNIT_NAME" || exit "$?"
fi
if systemctl --user is-enabled --quiet "$UNIT_NAME"; then
  systemctl --user disable "$UNIT_NAME" || exit "$?"
fi
if systemctl --user is-active --quiet "$UNIT_NAME"; then
  echo "service is still active: $UNIT_NAME" >&2
  exit 75
fi
rm -f "$UNIT" || exit "$?"
systemctl --user daemon-reload || exit "$?"
[ ! -f "$UNIT" ] || { echo "service definition still exists: $UNIT" >&2; exit 75; }
echo "SERVICE_ABSENT systemd $UNIT_NAME"
```

3. Ask the runner to stop only this account's recorded Cloud workers. It checks
the exact `builder-agent-runner.sh` argv, uses TERM then KILL with verification,
updates the server terminal state strictly, and keeps the marker on any failure.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
BUILDER_BLOG_ACCOUNT="$ACCT" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1 BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current \
  "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host
```

4. Remove this account's runtime pins only after step 3 succeeds:

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
rm -f "$AGENT_DIR/runtime-cloud-library-host-$ACCOUNT_SLUG" \
      "$AGENT_DIR/runtime-cloud-library-cron-$ACCOUNT_SLUG"
```

5. Report that the service was absent, whether each recorded worker was stopped
or already absent/stale, and that the account's Cloud runtime pins were removed.
