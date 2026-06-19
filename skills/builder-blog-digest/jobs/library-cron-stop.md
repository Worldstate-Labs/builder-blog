Stop the FollowBrief private source library scheduled job on this machine.

This is an interactive local agent task. Do not ask the user questions except
where step 1 requires it (more than one library job is found and the account is
ambiguous), or when a scheduler permission blocks removal. Run the numbered
steps exactly. If any command fails, stop and report the command, exit code, and
stderr. Do not invoke any other skill, plugin, or subagent — run the numbered
steps yourself exactly as written; this prompt is the whole task.

Scope — do not exceed it: remove only the recurring **schedule** (the launchd
LaunchAgent on macOS, or the crontab entry on Linux), stop this account's active
library cron worker if one is still running, then report that stopped state to
FollowBrief. Do not delete any already-fetched library content, and do not touch
the digest cron.

1. Find the existing FollowBrief library job(s) on this machine. Run the path
for this machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin)

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -n "$ACCT" ]; then
  printf 'com.followbrief.library.%s\n' "$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
else
  launchctl list 2>/dev/null | awk '{ print $3 }' | grep -E '^com\.followbrief\.library\.' || echo "(none found)"
fi
```

### Linux / other

```bash
crontab -l 2>/dev/null | grep -E 'builder-agent-runner\.sh library-cron' || echo "(none found)"
```

If the result is "(none found)" — or, on macOS, the account-scoped label is not
present in `launchctl list 2>/dev/null | awk '{ print $3 }'` — STOP: report that
there is no library schedule to remove, and change nothing. If more than one
library job is listed and `BUILDER_BLOG_ACCOUNT` is not set (so you can't tell
which account to stop), list them and ask the user which to stop before
continuing — removing all of them stops every FollowBrief account on this
machine.

2. Remove the schedule. Use the path for this machine's OS.

### macOS (`uname` is Darwin) → unload the LaunchAgent and delete its plist

Set `LABEL` to the job you are stopping. When the account email is available it
derives the label exactly as the setup did; otherwise set `LABEL` to the exact
label printed in step 1.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
[ -n "$ACCT" ] && LABEL="com.followbrief.library.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
# If BUILDER_BLOG_ACCOUNT is unset, replace the line above with the label from
# step 1, e.g. LABEL="com.followbrief.library.jie_worldstatelabs_com"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_bootout_start --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason stop_cron
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
BOOTOUT_CODE="$?"
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_bootout_finished --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason "exit_$BOOTOUT_CODE"
rm -f "$PLIST"
node "$AGENT_DIR/builder-digest.mjs" cron-audit --job library-cron --event launchd_remove_plist --label "$LABEL" --plist-exists "$([ -f "$PLIST" ] && echo 1 || echo 0)" --reason stop_cron
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "STILL PRESENT: $LABEL" || echo "removed: $LABEL"
```

### Linux / other → drop the crontab entry

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -n "$ACCT" ]; then
  crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron" | crontab -
else
  crontab -l 2>/dev/null | grep -v "# FollowBrief library cron" | grep -v "builder-agent-runner.sh library-cron" | crontab -
fi
BUILDER_BLOG_ACCOUNT="$ACCT" node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-audit --job library-cron --event crontab_remove_succeeded --reason stop_cron
crontab -l 2>/dev/null | grep -E 'builder-agent-runner\.sh library-cron' && echo "STILL PRESENT" || echo "removed"
```

3. Stop this account's active library cron worker instance, if one is still
running. This matters because the LaunchAgent only prevents future scheduled
fires; the current worker may already have been detached by the supervisor.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
CURRENT_FILE="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron/current.json"

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
        --job-type library-fetch \
        --trigger scheduled \
        --schedule-job library-cron \
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
      --job-type library-fetch \
      --trigger scheduled \
      --schedule-job library-cron \
      --instance-id "$INSTANCE_ID" \
      --expected-at "$EXPECTED_AT" \
      --started-at "${STARTED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
      --status stale \
      --summary "Stop cron found no live worker for the recorded instance." \
      --reason "stop_cron_stale"
  fi
  rm -f "$CURRENT_FILE"
else
  echo "no active library cron worker recorded"
fi
```

4. Remove this account's per-job pin files so a future re-install starts clean
(safe if they are absent):

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
ACCOUNT_SLUG="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
rm -f "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime-library-cron-$ACCOUNT_SLUG" \
      "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-force-library-cron-$ACCOUNT_SLUG" \
      "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-days-library-cron-$ACCOUNT_SLUG" \
      "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/parallel-library-cron-$ACCOUNT_SLUG"
```

5. Report the stopped status to FollowBrief so the web app stops expecting
future library fetch runs:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job library-cron \
  --status stopped
```

6. Report the outcome to the user: which label (macOS) or crontab entry (Linux)
was removed (or that none existed), whether an active worker was stopped or no
active worker was recorded, and that the step-2 verification line printed
"removed". Tell the user they can resume later by re-running the library cron
setup prompt.
