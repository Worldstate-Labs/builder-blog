Stop the FollowBrief subscription digest scheduled job on this machine.

This is an interactive local agent task. Do not ask the user questions except
where step 2 requires it (more than one digest job is found and the account is
ambiguous), or when a scheduler permission blocks removal. Run the numbered
steps exactly. If any command fails, stop and report the command, exit code, and
stderr. Do not invoke any other skill, plugin, or subagent — run the numbered
steps yourself exactly as written; this prompt is the whole task.

Scope — do not exceed it: remove only the recurring **schedule** (the launchd
LaunchAgent on macOS, or the crontab entry on Linux), stop this account's active
digest cron worker if one is still running, then report that stopped state to
FollowBrief. Do not delete any already-generated digests, and do not touch the
library cron.

Stopped-state contract — preserve this invariant: this account is fully stopped
only after there is no loaded service, no target plist/crontab entry, no current
worker file, no pin files, and FollowBrief has accepted `cron-status --status
stopped`. A stale LaunchAgent plist without a loaded launchd service is still
local scheduler state and must be removed. When `BUILDER_BLOG_ACCOUNT` is set,
continue through worker cleanup, pin cleanup, and web status sync even if no
local schedule is found; otherwise the web app can keep expecting cron runs.

1. Install or refresh the skill so local audit/status commands are current:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Find the existing FollowBrief digest job(s) on this machine. Run the path for
this machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin)

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
JOB_PREFIX="com.followbrief.digest"
if [ -n "$ACCT" ]; then
  LABEL="$JOB_PREFIX.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    printf 'loaded:%s\n' "$LABEL"
  elif [ -f "$PLIST" ]; then
    printf 'stale-plist:%s\n' "$LABEL"
  else
    printf 'no-local-schedule:%s\n' "$LABEL"
  fi
else
  FOUND="$({
    launchctl list 2>/dev/null | awk '{ print $3 }' | grep -E '^com\.followbrief\.digest\.' || true
    find "$HOME/Library/LaunchAgents" -maxdepth 1 -name 'com.followbrief.digest.*.plist' -exec basename {} .plist \; 2>/dev/null || true
  } | sort -u | sed '/^$/d')"
  [ -n "$FOUND" ] && printf '%s\n' "$FOUND" || echo "(none found)"
fi
```

### Linux / other

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -n "$ACCT" ]; then
  crontab -l 2>/dev/null | grep -E "# FollowBrief digest cron · $ACCT|BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner\.sh digest-cron" || echo "(none found)"
else
  crontab -l 2>/dev/null | grep -E 'builder-agent-runner\.sh digest-cron' || echo "(none found)"
fi
```

If `BUILDER_BLOG_ACCOUNT` is set, continue even when step 2 prints
`no-local-schedule:<label>` or "(none found)"; steps 4-6 still make the stopped
state complete. If `BUILDER_BLOG_ACCOUNT` is not set and the result is "(none
found)", STOP because there is no safe account to report. If more than one
digest job is listed and `BUILDER_BLOG_ACCOUNT` is not set (so you can't tell
which account to stop), list them and ask the user which to stop before
continuing — removing all of them stops every FollowBrief account on this
machine. Treat `stale-plist:<label>` as scheduler state that must be removed.

3. Remove the schedule. Use the path for this machine's OS.

### macOS (`uname` is Darwin) → unload the LaunchAgent and delete its plist

Set `LABEL` to the job you are stopping. When the account email is available it
derives the label exactly as the setup did; otherwise set `LABEL` to the exact
label printed in step 2.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
if [ -n "$ACCT" ]; then
  LABEL="com.followbrief.digest.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
fi
# If BUILDER_BLOG_ACCOUNT is unset, set LABEL to the exact label from step 2,
# e.g. LABEL="com.followbrief.digest.jie_worldstatelabs_com"
[ -n "$LABEL" ] || { echo "LABEL is required"; exit 1; }
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  LOADED=1
else
  LOADED=0
fi
if [ -f "$PLIST" ]; then
  PLIST_EXISTS=1
else
  PLIST_EXISTS=0
fi

if [ "$LOADED" = "1" ] || [ "$PLIST_EXISTS" = "1" ]; then
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_bootout_start --label "$LABEL" --plist-exists "$PLIST_EXISTS" --launchctl-loaded "$LOADED" --reason stop_cron
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  BOOTOUT_CODE="$?"
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    LOADED_AFTER=1
  else
    LOADED_AFTER=0
  fi
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_bootout_finished --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --launchctl-loaded "$LOADED_AFTER" --reason "exit_$BOOTOUT_CODE"
  rm -f "$PLIST"
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_remove_plist --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --launchctl-loaded "$LOADED_AFTER" --reason stop_cron
else
  node "$AGENT_DIR/builder-digest.mjs" cron-audit --job digest-cron --event launchd_no_schedule_found --label "$LABEL" --plist-exists 0 --launchctl-loaded 0 --reason stop_cron
fi
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "STILL LOADED: $LABEL" || echo "launchd absent: $LABEL"
[ -f "$PLIST" ] && echo "STILL PLIST: $PLIST" || echo "plist absent: $PLIST"
```

### Linux / other → drop the crontab entry

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -n "$ACCT" ]; then
  crontab -l 2>/dev/null | grep -v "# FollowBrief digest cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh digest-cron" | crontab -
else
  crontab -l 2>/dev/null | grep -v "# FollowBrief digest cron" | grep -v "builder-agent-runner.sh digest-cron" | crontab -
fi
BUILDER_BLOG_ACCOUNT="$ACCT" node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-audit --job digest-cron --event crontab_remove_succeeded --reason stop_cron
crontab -l 2>/dev/null | grep -E 'builder-agent-runner\.sh digest-cron' && echo "STILL PRESENT" || echo "removed"
```

4. Stop this account's active digest cron worker instance, if one is still
running. This matters because the LaunchAgent only prevents future scheduled
fires; the current worker may already have been detached by the supervisor.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
CURRENT_FILE="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron/current.json"

json_get_number() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$2" 2>/dev/null | head -n 1
}
json_get_string() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" 2>/dev/null | head -n 1
}
terminate_process_tree() {
  pid="${1:-}"
  signal="${2:-TERM}"
  wait_seconds="${3:-30}"
  [ -n "$pid" ] || return 0
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do terminate_process_tree "$child" "$signal" "$wait_seconds"; done
  kill "-$signal" "$pid" 2>/dev/null || kill -s "$signal" "$pid" 2>/dev/null || true
  left="$wait_seconds"
  while [ "$left" -gt 0 ]; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
    left=$((left - 1))
  done
  return 1
}

if [ -r "$CURRENT_FILE" ]; then
  WORKER_PID="$(json_get_number workerPid "$CURRENT_FILE")"
  INSTANCE_ID="$(json_get_string instanceId "$CURRENT_FILE")"
  STARTED_AT="$(json_get_string startedAt "$CURRENT_FILE")"
  EXPECTED_AT="$(json_get_string expectedAt "$CURRENT_FILE")"
  if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    CMD="$(ps -p "$WORKER_PID" -o command= 2>/dev/null || true)"
    if printf '%s' "$CMD" | grep -q 'builder-agent-runner.sh\|codex exec\|claude -p\|gemini\|openclaw'; then
      terminate_process_tree "$WORKER_PID" TERM 30 || terminate_process_tree "$WORKER_PID" KILL 3 || true
      node "$AGENT_DIR/builder-digest.mjs" job-run-update \
        --job-type digest-build \
        --trigger scheduled \
        --schedule-job digest-cron \
        --instance-id "$INSTANCE_ID" \
        --expected-at "$EXPECTED_AT" \
        --started-at "${STARTED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
        --status killed \
        --summary "Stopped by user." \
        --reason "stop_cron"
    else
      echo "current worker pid $WORKER_PID is not a FollowBrief worker; leaving it alone"
    fi
  elif [ -n "$INSTANCE_ID" ]; then
    node "$AGENT_DIR/builder-digest.mjs" job-run-update \
      --job-type digest-build \
      --trigger scheduled \
      --schedule-job digest-cron \
      --instance-id "$INSTANCE_ID" \
      --expected-at "$EXPECTED_AT" \
      --started-at "${STARTED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
      --status stale \
      --summary "Stop cron found no live worker for the recorded instance." \
      --reason "stop_cron_stale"
  fi
  rm -f "$CURRENT_FILE"
else
  echo "no active digest cron worker recorded"
fi
```

5. Remove this account's per-job pin files so a future re-install starts clean
(safe if they are absent):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
rm -f "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime-digest-cron-$ACCOUNT_SLUG" \
      "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/regenerate-digest-cron-$ACCOUNT_SLUG"
```

6. Report the stopped status to FollowBrief so the web app can hide Stop cron
and show the schedule as stopped:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job digest-cron \
  --status stopped
```

7. Report the outcome to the user: which label (macOS) or crontab entry (Linux)
was removed (or that no local schedule existed), whether an active worker was
stopped or no active worker was recorded, and that step 3 printed both
"launchd absent" and "plist absent" on macOS (or "removed" on Linux). Tell the
user they can resume later by re-running the digest cron setup prompt.
