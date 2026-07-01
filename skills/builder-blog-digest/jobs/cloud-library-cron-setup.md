Set up the FollowBrief Cloud source library scheduled fetch (admin).

This installs a recurring local schedule that leases and fetches a batch of cloud
source tasks every {{CRON_FREQUENCY_LABEL}}. This account must have admin Cloud
Fetch access.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr.
- Do NOT install the schedule until the initial validation run in step 4 exits 0.
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

4. Run one real cloud fetch now to validate before scheduling:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_RUN_SOURCE=cloud \
BUILDER_BLOG_CLOUD_FETCH_LIMIT="${BUILDER_BLOG_CLOUD_FETCH_LIMIT-10}" \
"$AGENT_DIR/builder-agent-runner.sh" cloud-library-cron
```

If this exits non-zero, report the command, exit code, and stderr, and stop — do
not install the schedule.

5. Install the recurring schedule (every {{CRON_INTERVAL_MINUTES}} minutes).

macOS (launchd):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}"
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
    <string>BUILDER_BLOG_ACCOUNT="$ACCT" BUILDER_BLOG_AGENT_RUNTIME="$RUNTIME" BUILDER_BLOG_RUN_SOURCE=cloud "$AGENT_DIR/builder-agent-runner.sh" cloud-library-cron</string>
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

6. Report the installed schedule label/interval and the initial run result
   (cloud source tasks leased, succeeded, and failed).
