Stop the FollowBrief Cloud worker host on this machine.

This is an interactive local agent task for a FollowBrief admin. Run the
numbered steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not invoke any other skill, plugin, or subagent; this
prompt is the whole task.

Scope: remove only the long-running Cloud worker host service on this machine,
stop this account's active Cloud worker host process if one is still running,
and report the stopped worker host to FollowBrief as a `cloud-library-fetch`
job run. Do not delete Cloud library content, source submissions, source tasks,
or regular Fetch sources / AI Digest schedules.

Stopped-state contract: this account is fully stopped only after there is no
loaded `com.followbrief.cloud-library-host` LaunchAgent on macOS or
`followbrief-cloud-library-host.service` user service on Linux, no target local
current worker file, no Cloud worker runtime pin files, and the active worker
host record has been marked terminal in FollowBrief when a recorded instance
existed.

1. Install or refresh the skill so local status commands are current:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Remove the persistent Cloud worker host service for this machine. Run the
path for this machine's OS; run `uname` if unsure.

### macOS (`uname` is Darwin)

```bash
LABEL="com.followbrief.cloud-library-host"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL"
else
  echo "launchd not loaded: $LABEL"
fi
rm -f "$PLIST"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "STILL LOADED: $LABEL" || echo "launchd absent: $LABEL"
[ -f "$PLIST" ] && echo "STILL PLIST: $PLIST" || echo "plist absent: $PLIST"
```

### Linux / other

```bash
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now followbrief-cloud-library-host.service 2>/dev/null || true
  systemctl --user stop followbrief-cloud-library-host.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/followbrief-cloud-library-host.service"
  systemctl --user daemon-reload 2>/dev/null || true
else
  echo "systemctl not found; continuing to active worker cleanup"
fi
systemctl --user is-active followbrief-cloud-library-host.service 2>/dev/null && echo "STILL ACTIVE" || echo "systemd absent: followbrief-cloud-library-host.service"
[ -f "$HOME/.config/systemd/user/followbrief-cloud-library-host.service" ] && echo "STILL UNIT" || echo "unit absent: followbrief-cloud-library-host.service"
```

3. Stop this account's active Cloud worker host instance, if one is still
recorded. This matters because removing launchd/systemd only prevents automatic
restart; the current host may still be running.

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
ACCOUNT_SLUG="$(account_slug "$ACCT")"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
BASE_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG"

json_get_number() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$2" 2>/dev/null | head -n 1
}
json_get_string() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" 2>/dev/null | head -n 1
}
process_tree_pids() {
  root="${1:-}"
  [ -n "$root" ] || return 0
  queue="$root"
  seen=""
  while [ -n "$queue" ]; do
    next=""
    for pid in $queue; do
      case " $seen " in *" $pid "*) continue ;; esac
      seen="$seen $pid"
      printf '%s\n' "$pid"
      children="$(pgrep -P "$pid" 2>/dev/null || true)"
      [ -z "$children" ] || next="$next $children"
    done
    queue="$next"
  done
}
terminate_process_tree() {
  root="${1:-}"
  signal="${2:-TERM}"
  wait_seconds="${3:-30}"
  [ -n "$root" ] || return 0
  kill -0 "$root" 2>/dev/null || return 0
  targets="$(process_tree_pids "$root" | awk 'NF { lines[++n]=$1 } END { for (i=n; i>=1; i--) print lines[i] }')"
  for pid in $targets; do kill -s "$signal" "$pid" 2>/dev/null || true; done
  left="$wait_seconds"
  while [ "$left" -gt 0 ]; do
    alive=0
    for pid in $targets; do
      if kill -0 "$pid" 2>/dev/null; then alive=1; break; fi
    done
    [ "$alive" -eq 0 ] && return 0
    sleep 1
    left=$((left - 1))
  done
  return 1
}
stop_current_file() {
  current_file="$1"
  label="$2"
  if [ ! -r "$current_file" ]; then
    echo "no active $label worker recorded"
    return 0
  fi
  worker_pid="$(json_get_number workerPid "$current_file")"
  instance_id="$(json_get_string instanceId "$current_file")"
  started_at="$(json_get_string startedAt "$current_file")"
  expected_at="$(json_get_string expectedAt "$current_file")"
  if [ -n "$worker_pid" ] && kill -0 "$worker_pid" 2>/dev/null; then
    cmd="$(ps -p "$worker_pid" -o command= 2>/dev/null || true)"
    if printf '%s' "$cmd" | grep -q 'cloud-library-host\|BUILDER_BLOG_WORKER_MODE=1\|builder-agent-runner.sh\|codex exec\|claude -p\|hermes chat\|openclaw'; then
      terminate_process_tree "$worker_pid" TERM 30 || terminate_process_tree "$worker_pid" KILL 3 || true
      if [ -n "$instance_id" ]; then
        node "$AGENT_DIR/builder-digest.mjs" job-run-update \
          --job-type cloud-library-fetch \
          --trigger manual_cli \
          --instance-id "$instance_id" \
          --expected-at "$expected_at" \
          --started-at "${started_at:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
          --status killed \
          --stage stopped \
          --summary "Cloud worker host stopped by admin." \
          --reason "stop_cloud_worker_host"
      fi
    else
      echo "current worker pid $worker_pid is not a FollowBrief Cloud worker; leaving it alone"
      return 0
    fi
  elif [ -n "$instance_id" ]; then
    node "$AGENT_DIR/builder-digest.mjs" job-run-update \
      --job-type cloud-library-fetch \
      --trigger manual_cli \
      --instance-id "$instance_id" \
      --expected-at "$expected_at" \
      --started-at "${started_at:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
      --status stale \
      --stage stopped \
      --summary "Stop Cloud worker host found no live worker for the recorded instance." \
      --reason "stop_cloud_worker_host_stale"
  fi
  rm -f "$current_file"
}

stop_current_file "$BASE_DIR/cloud-library-host/current.json" "cloud-library-host"
stop_current_file "$BASE_DIR/cloud-library-cron/current.json" "cloud-library-cron"
```

4. Remove this account's Cloud worker runtime pin files so a future setup starts
cleanly:

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
ACCOUNT_SLUG="$(account_slug "$ACCT")"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
rm -f "$AGENT_DIR/runtime-cloud-library-host-$ACCOUNT_SLUG" \
      "$AGENT_DIR/runtime-cloud-library-cron-$ACCOUNT_SLUG"
```

5. Report the outcome to the user: which local service was removed (or was
already absent), whether an active Cloud worker host was stopped or no active
worker was recorded, and that macOS printed both "launchd absent" and "plist
absent" or Linux printed "systemd absent" and "unit absent".
