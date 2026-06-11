#!/bin/sh
set -eu

JOB_NAME="${1:-}"
APP_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PROMPT_FILE="$AGENT_DIR/jobs/$JOB_NAME.md"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
JOB_TMP_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/$JOB_NAME"
# A direct worker-mode invocation (the setup validation run, or any manual
# BUILDER_BLOG_WORKER_MODE=1 run) bypasses run_cron_supervisor and its
# current.json single-instance lock. Only such direct calls carry WORKER_MODE=1
# at entry — the scheduled path enters without it and the supervisor sets it
# later in-process, after JOB_TMP_DIR is already fixed. Give the bypassing run
# an isolated temp dir so it can never race a launchd-scheduled run of the same
# job over the shared library-cron/digest-cron temp files.
if [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; then
  JOB_TMP_DIR="$JOB_TMP_DIR-validate"
fi
HEARTBEAT_INTERVAL_SECONDS=60

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
# Tag every fetch the CLI emits as "cron" while we're inside the cron
# runner so the per-user fetch log can distinguish scheduled jobs from
# manual terminal invocations.
BUILDER_BLOG_RUN_SOURCE=cron
export PATH BUILDER_BLOG_URL="$APP_URL" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_RUN_SOURCE
export BUILDER_BLOG_ACCOUNT_SLUG="$ACCOUNT_SLUG" BUILDER_BLOG_JOB_TMP_DIR="$JOB_TMP_DIR"

if [ -z "$JOB_NAME" ]; then
  echo "Usage: builder-agent-runner.sh <library-once|digest-once|library-cron-setup|digest-cron-setup|library-cron|digest-cron>" >&2
  exit 64
fi

mkdir -p "$AGENT_DIR/logs" "$AGENT_DIR/tmp" "$JOB_TMP_DIR"

# Self-update: pull the latest runner and, if it changed, atomically swap it
# in and re-exec, so scheduled jobs pick up runner fixes from the server
# without the user re-running setup. refresh_skill_files below already keeps
# the CLI, prompts (with server-expanded includes), and sources.json current
# every run; the runner is the one file it can't refresh in place, so it
# self-updates here. The temp+rename+exec pattern is safe: the running shell
# keeps reading the old (now-unlinked) inode while exec hands off to the new
# file — unlike an in-place `curl -o` over a running script. Guarded against
# a re-exec loop by BUILDER_BLOG_RUNNER_UPDATED.
self_update_and_reexec() {
  if [ -n "${BUILDER_BLOG_RUNNER_UPDATED:-}" ]; then return 0; fi
  command -v curl >/dev/null 2>&1 || return 0
  _self="$AGENT_DIR/builder-agent-runner.sh"
  _next="$AGENT_DIR/.builder-agent-runner.$ACCOUNT_SLUG.$JOB_NAME.next"
  if curl -fsSL "$APP_URL/api/skill/files/builder-agent-runner.sh" -o "$_next" 2>/dev/null && [ -s "$_next" ]; then
    if ! cmp -s "$_next" "$_self" 2>/dev/null; then
      chmod +x "$_next" 2>/dev/null || true
      if mv "$_next" "$_self" 2>/dev/null; then
        BUILDER_BLOG_RUNNER_UPDATED=1
        export BUILDER_BLOG_RUNNER_UPDATED
        exec "$_self" "$@"
      fi
    fi
    rm -f "$_next" 2>/dev/null || true
  fi
}
self_update_and_reexec "$@"

refresh_skill_files() {
  mkdir -p "$AGENT_DIR" "$AGENT_DIR/jobs" "$AGENT_DIR/logs" "$AGENT_DIR/tmp"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest.md" -o "$AGENT_DIR/SKILL.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-digest.mjs" -o "$AGENT_DIR/builder-digest.mjs"
  curl -fsSL "$APP_URL/api/skill/files/sources.json" -o "$AGENT_DIR/sources.json"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-once.md" -o "$AGENT_DIR/jobs/library-once.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest-once.md" -o "$AGENT_DIR/jobs/digest-once.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-cron-setup.md" -o "$AGENT_DIR/jobs/library-cron-setup.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest-cron-setup.md" -o "$AGENT_DIR/jobs/digest-cron-setup.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-cron.md" -o "$AGENT_DIR/jobs/library-cron.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest-cron.md" -o "$AGENT_DIR/jobs/digest-cron.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-worker.md" -o "$AGENT_DIR/jobs/library-worker.md"
  curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-discovery.md" -o "$AGENT_DIR/jobs/library-discovery.md"
  chmod +x "$AGENT_DIR/builder-digest.mjs"
}

# Always pull latest CLI to avoid version drift between cached prompt/CLI and the server.
refresh_skill_files

if [ -n "${BUILDER_BLOG_PROMPT_URL:-}" ]; then
  mkdir -p "$AGENT_DIR/jobs"
  curl -fsSL "$BUILDER_BLOG_PROMPT_URL" -o "$PROMPT_FILE"
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Missing FollowBrief job prompt: $PROMPT_FILE" >&2
  echo "Run: /bin/sh -c \"\$(curl -fsSL $APP_URL/api/skill/bootstrap)\"" >&2
  exit 66
fi

run_with_override() {
  BUILDER_BLOG_JOB="$JOB_NAME" BUILDER_BLOG_PROMPT_FILE="$PROMPT_FILE" sh -c "$BUILDER_BLOG_AGENT_COMMAND"
}

# Interactive (user is watching) — each runtime runs with its default
# permission gates. Used when no runtime is pinned and the user is at
# a TTY (library-once / digest-once from the command line).
run_with_codex() {
  codex exec --skip-git-repo-check -C "$AGENT_DIR" - < "$PROMPT_FILE"
}

run_with_claude() {
  claude -p "$(cat "$PROMPT_FILE")" --add-dir "$AGENT_DIR"
}

run_with_openclaw() {
  # `agent` requires a session selector on 2026.5.20+ (the bare form errors
  # with "Pass --to/--session-id/--agent"); default to the `main` agent.
  if [ -n "${OPENCLAW_SESSION_ID:-}" ]; then
    openclaw agent --local --session-id "$OPENCLAW_SESSION_ID" --message "$(cat "$PROMPT_FILE")"
  else
    openclaw agent --local --agent "${OPENCLAW_AGENT:-main}" --message "$(cat "$PROMPT_FILE")"
  fi
}

run_with_gemini() {
  gemini -p "$(cat "$PROMPT_FILE")"
}

# Unattended (cron / launchd) — each runtime gets the permission
# allowlist or auto-approve mode appropriate for it. Mirror these in
# the user-facing cron setup prompt (library-cron-setup.md) so users
# know what each runtime is allowed to do.
run_with_codex_unattended() {
  # Codex `--full-auto` = approval_policy=never + workspace-write sandbox.
  # workspace-write disables outbound network by default, which blocks the
  # library fetch (FollowBrief API + content sources) and surfaces as a
  # generic "fetch failed". Re-enable network for the workspace sandbox so the
  # job can reach the network while keeping the filesystem sandbox intact.
  codex exec --skip-git-repo-check --full-auto \
    -c sandbox_workspace_write.network_access=true \
    -C "$AGENT_DIR" - < "$PROMPT_FILE"
}

run_with_claude_unattended() {
  # acceptEdits auto-approves edits; allowedTools whitelists the tool
  # surface the library-once skill actually uses (Bash for node CLI +
  # curl, WebFetch for content extraction, file IO under tmp/).
  claude -p "$(cat "$PROMPT_FILE")" \
    --add-dir "$AGENT_DIR" \
    --permission-mode acceptEdits \
    --allowedTools "Bash,Edit,Read,Write,Grep,Glob,WebFetch"
}

run_with_openclaw_unattended() {
  # OpenClaw's DEFAULT exec policy is already security=full / ask=off (verified
  # via `openclaw exec-policy show` with no approvals file present), so a
  # non-interactive `agent` turn auto-approves exec on its own — confirmed by a
  # live non-TTY run. The old global-yolo preset command was both unnecessary AND
  # harmful: it wrote the GLOBAL ~/.openclaw/exec-approvals.json, disarming
  # approval for EVERY openclaw session on the host (and `--profile` does not
  # relocate that file, so it can't be scoped that way). So we don't touch
  # global policy at all. `agent` requires a session selector on 2026.5.20
  # (the bare `--local --message` form errors "Pass --to/--session-id/--agent");
  # parallel workers can set OPENCLAW_SESSION_ID for isolated sessions, and the
  # regular path otherwise uses the configured main agent.
  _openclaw_timeout="${BUILDER_BLOG_AGENT_TIMEOUT_SECONDS:-${_timeout:-$(timeout_seconds_for_job "${INTERVAL_MINUTES:-60}" "$JOB_NAME")}}"
  sync_openclaw_timeout_config "$_openclaw_timeout"
  _openclaw_output="$JOB_TMP_DIR/openclaw-agent-output-$$.log"
  set +e
  if [ -n "${OPENCLAW_SESSION_ID:-}" ]; then
    openclaw agent --local --session-id "$OPENCLAW_SESSION_ID" --timeout "$_openclaw_timeout" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
  else
    openclaw agent --local --agent "${OPENCLAW_AGENT:-main}" --timeout "$_openclaw_timeout" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
  fi
  _openclaw_code="$?"
  set -e
  cat "$_openclaw_output"
  if openclaw_output_has_timeout "$_openclaw_output"; then
    return 124
  fi
  return "$_openclaw_code"
}

sync_openclaw_timeout_config() {
  _seconds="${1:-}"
  case "$_seconds" in
    ''|*[!0-9]*) return 0 ;;
  esac
  _current="$(openclaw config get agents.defaults.timeoutSeconds 2>/dev/null || true)"
  case "$_current" in
    *[!0-9]*|'') _current="0" ;;
  esac
  if [ "$_current" -ge "$_seconds" ]; then
    return 0
  fi
  if ! openclaw config set agents.defaults.timeoutSeconds "$_seconds" --strict-json >/dev/null 2>&1; then
    echo "Warning: failed to set OpenClaw agents.defaults.timeoutSeconds to ${_seconds}s; continuing with --timeout." >&2
  fi
}

openclaw_output_has_timeout() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  grep -E -q \
    "Request timed out before a response was generated|codex app-server turn idle timed out|embedded run failover decision:.*reason=timeout" \
    "$_file"
}

run_with_gemini_unattended() {
  gemini --yolo -p "$(cat "$PROMPT_FILE")"
}

run_shell_library_fallback() {
  echo "No local agent runtime found; running non-AI library fetch fallback." >&2
  echo "Sources requiring AI, cookies, transcription, summaries, or custom tools will need BUILDER_BLOG_AGENT_COMMAND, codex, claude, openclaw, or gemini." >&2
  refresh_skill_files
  RESULT_FILE="$JOB_TMP_DIR/library-fallback-fetch-result.json"
  node "$AGENT_DIR/builder-digest.mjs" fetch-personal --days "${BUILDER_BLOG_FETCH_DAYS:-30}" --limit 3 > "$RESULT_FILE"
  cat "$RESULT_FILE"
  node - "$RESULT_FILE" <<'NODE'
const fs = require("fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const fetchTasks = Array.isArray(result.fetchTasks) ? result.fetchTasks.length : 0;
if (fetchTasks > 0) {
  console.error(
    "Library fetch produced fetchTasks, but no local agent runtime is available to complete them.",
  );
  console.error("Install/configure Codex, Claude Code, OpenClaw, Gemini CLI, or set BUILDER_BLOG_AGENT_COMMAND.");
  process.exit(78);
}
NODE
}

run_runtime_smoke_check() {
  SMOKE_PROMPT_FILE="$JOB_TMP_DIR/runtime-smoke.md"
  cat > "$SMOKE_PROMPT_FILE" <<EOF
You are validating a FollowBrief scheduled local runtime.

Run exactly one harmless shell command:

printf 'followbrief-runtime-smoke:%s\n' "$JOB_NAME"

Then print exactly one JSON object and stop:

{"followbriefSmokeCheck":"ok","job":"$JOB_NAME","runtime":"${BUILDER_BLOG_RUNTIME:-auto}"}

Do not run FollowBrief fetch, digest, sync, cron-status, or setup commands.
Do not browse the web.
EOF
  PROMPT_FILE="$SMOKE_PROMPT_FILE"
  export BUILDER_BLOG_RUN_SOURCE=smoke
  _timeout="${BUILDER_BLOG_AGENT_TIMEOUT_SECONDS:-$(timeout_seconds_for_job "${INTERVAL_MINUTES:-60}" "$JOB_NAME")}"
  echo "Running FollowBrief runtime smoke check for $JOB_NAME with ${PINNED_RUNTIME:-auto} (timeout ${_timeout}s)." >&2
  set +e
  run_selected_runtime &
  SMOKE_PID="$!"
  _elapsed=0
  while kill -0 "$SMOKE_PID" 2>/dev/null; do
    if [ "$_elapsed" -ge "$_timeout" ]; then
      echo "FollowBrief runtime smoke check timed out after ${_timeout}s." >&2
      terminate_process_tree "$SMOKE_PID" TERM 10 || terminate_process_tree "$SMOKE_PID" KILL 3 || true
      wait "$SMOKE_PID" 2>/dev/null || true
      set -e
      return 124
    fi
    sleep 2
    _elapsed=$(( _elapsed + 2 ))
  done
  wait "$SMOKE_PID"
  _code="$?"
  set -e
  return "$_code"
}

# Cron-setup pins config in per-account, per-job files so two FollowBrief
# accounts and two job types can use different runtimes/fetch modes on one
# machine. Read the account-scoped file first, then fall back to the legacy
# per-job/global files so crons installed before the split keep working after
# the runner self-updates.
#
# One-time jobs additionally fall back to their recurring job's pins: the user
# expectation for library-once / digest-once is "run the scheduled job right
# now", so when the once job has no pin of its own it inherits the cron job's
# runtime, fetch-force, fetch-days, and parallel settings. Cron jobs never
# fall back the other way.
case "$JOB_NAME" in
  library-once) PIN_FALLBACK_JOB="library-cron" ;;
  digest-once) PIN_FALLBACK_JOB="digest-cron" ;;
  *) PIN_FALLBACK_JOB="" ;;
esac

read_pin() {
  # $1 = base name (runtime | fetch-force | fetch-days | regenerate | parallel)
  for _pin_job in "$JOB_NAME" $PIN_FALLBACK_JOB; do
    if [ -r "$AGENT_DIR/$1-$_pin_job-$ACCOUNT_SLUG" ]; then
      tr -d ' \t\r\n' < "$AGENT_DIR/$1-$_pin_job-$ACCOUNT_SLUG"
      return 0
    fi
    if [ -r "$AGENT_DIR/$1-$_pin_job" ]; then
      tr -d ' \t\r\n' < "$AGENT_DIR/$1-$_pin_job"
      return 0
    fi
  done
  if [ -r "$AGENT_DIR/$1" ]; then
    tr -d ' \t\r\n' < "$AGENT_DIR/$1"
  fi
}

# The pinned runtime is a single word: claude | codex | gemini | openclaw.
# We honor it for *-cron jobs so unattended runs use the matching allowlist /
# auto-approve flags. Interactive jobs (library-once, digest-once) keep the
# discovery chain — the user is at a TTY and sees any permission prompts.
PINNED_RUNTIME="$(read_pin runtime)"

# Surface the resolved runtime to the CLI so the fetch-run record (and the web
# fetch log) can label which agent ran it. The CLI also auto-detects
# codex/claude from their own env, but the pin is authoritative and is the only
# signal for gemini/openclaw. Empty for un-pinned interactive runs → the CLI
# falls back to env detection.
export BUILDER_BLOG_RUNTIME="$PINNED_RUNTIME"

# Forced re-fetch: cron-setup writes 1 to the fetch-force pin when the user
# picked "override already-fetched posts". We expose it as
# BUILDER_BLOG_FETCH_FORCE, which the library-cron prompt drops straight into
# the fetch-personal command (`${BUILDER_BLOG_FETCH_FORCE:-}` → --force). "1" →
# --force (re-pull posts already in the library, ignoring the fetchedAt cutoff
# + externalId dedup); anything else → no flag.
BUILDER_BLOG_FETCH_FORCE=""
if [ "$(read_pin fetch-force)" = "1" ]; then
  BUILDER_BLOG_FETCH_FORCE="--force"
fi
export BUILDER_BLOG_FETCH_FORCE

# Fetch lookback window: cron-setup writes a bounded 1-90 day value. Default to
# 30 for older schedules that have no pin yet.
BUILDER_BLOG_FETCH_DAYS="$(read_pin fetch-days)"
case "$BUILDER_BLOG_FETCH_DAYS" in
  ''|*[!0-9]*)
    BUILDER_BLOG_FETCH_DAYS="30"
    ;;
  *)
    if [ "$BUILDER_BLOG_FETCH_DAYS" -lt 1 ]; then BUILDER_BLOG_FETCH_DAYS="1"; fi
    if [ "$BUILDER_BLOG_FETCH_DAYS" -gt 90 ]; then BUILDER_BLOG_FETCH_DAYS="90"; fi
    ;;
esac
export BUILDER_BLOG_FETCH_DAYS

# Re-generate today's digest: digest-cron-setup writes 1 to the regenerate pin
# when the user picked "re-generate today's digest". We expose it as
# BUILDER_BLOG_DIGEST_REGENERATE, which the digest-cron prompt drops into the
# prepare/sync commands (`${BUILDER_BLOG_DIGEST_REGENERATE:-}` → --regenerate).
# "1" → re-cover the full window and replace the existing same-day digest;
# anything else → no flag (normal incremental digest).
BUILDER_BLOG_DIGEST_REGENERATE=""
if [ "$(read_pin regenerate)" = "1" ]; then
  BUILDER_BLOG_DIGEST_REGENERATE="--regenerate"
fi
export BUILDER_BLOG_DIGEST_REGENERATE

# Parallel fetch fan-out: when the parallel pin is >= 2 the runner orchestrates
# the library job itself — fetch-personal, shard-tasks, merge-task-results,
# validate-agent-sync, and sync-builders are deterministic CLI steps, and N
# runtime workers each complete one shard of fetchTasks. The pin is per-account
# and per-job with the usual once→cron fallback, so a one-time run parallelizes
# exactly like the recurring job. Absent/0/1 → single-agent path (default).
MAX_PARALLEL_WORKERS="$(read_pin parallel)"
case "$MAX_PARALLEL_WORKERS" in
  ''|*[!0-9]*) MAX_PARALLEL_WORKERS="1" ;;
esac
if [ "$MAX_PARALLEL_WORKERS" -gt 8 ]; then MAX_PARALLEL_WORKERS="8"; fi

job_type_for_name() {
  case "$JOB_NAME" in
    library-*) printf '%s\n' "library-fetch" ;;
    digest-*) printf '%s\n' "digest-build" ;;
    *) printf '%s\n' "library-fetch" ;;
  esac
}

schedule_job_for_name() {
  case "$JOB_NAME" in
    library-cron) printf '%s\n' "library-cron" ;;
    digest-cron) printf '%s\n' "digest-cron" ;;
    *) printf '%s\n' "" ;;
  esac
}

timeout_seconds_for_job() {
  _interval="${1:-60}"
  _job="${2:-$JOB_NAME}"
  _base=$(( _interval * 48 ))
  _min=$(( 20 * 60 ))
  case "$_job" in
    library-cron) _max=$(( 120 * 60 )) ;;
    digest-cron) _max=$(( 45 * 60 )) ;;
    *) _max=$(( 45 * 60 )) ;;
  esac
  if [ "$_base" -lt "$_min" ]; then _base="$(( 20 * 60 ))"; fi
  if [ "$_base" -gt "$_max" ]; then _base="$_max"; fi
  printf '%s\n' "$_base"
}

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

job_run_update() {
  if [ "${BUILDER_BLOG_DISABLE_WEB_SYNC:-}" = "1" ]; then return 0; fi
  _status="$1"
  _summary="${2:-}"
  _reason="${3:-}"
  _finished=""
  case "$_status" in
    succeeded|failed|timed_out|killed|replaced|stale) _finished="$(iso_now)" ;;
  esac
  node "$AGENT_DIR/builder-digest.mjs" job-run-update \
    --job-type "$(job_type_for_name)" \
    --trigger "${BUILDER_BLOG_JOB_TRIGGER:-manual_cli}" \
    --schedule-job "${BUILDER_BLOG_SCHEDULE_JOB:-}" \
    --instance-id "${BUILDER_BLOG_JOB_RUN_ID:-}" \
    --expected-at "${BUILDER_BLOG_EXPECTED_AT:-}" \
    --started-at "${BUILDER_BLOG_JOB_STARTED_AT:-$(iso_now)}" \
    --heartbeat-at "$(iso_now)" \
    --status "$_status" \
    --runtime "${BUILDER_BLOG_RUNTIME:-}" \
    --runner-pid "${BUILDER_BLOG_RUNNER_PID:-$$}" \
    --worker-pid "${BUILDER_BLOG_WORKER_PID:-$$}" \
    --finished-at "$_finished" \
    --summary "$_summary" \
    --reason "$_reason" >/dev/null 2>&1 || true
}

verify_followbrief_pid() {
  _pid="${1:-}"
  [ -n "$_pid" ] || return 1
  kill -0 "$_pid" 2>/dev/null || return 1
  _args="$(ps -p "$_pid" -o command= 2>/dev/null || true)"
  printf '%s' "$_args" | grep -q "BUILDER_BLOG_WORKER_MODE=1\|builder-agent-runner.sh\|codex exec\|claude -p\|gemini\|openclaw" || return 1
}

terminate_process_tree() {
  _pid="${1:-}"
  _signal="${2:-TERM}"
  _wait_seconds="${3:-30}"
  [ -n "$_pid" ] || return 0
  _children="$(pgrep -P "$_pid" 2>/dev/null || true)"
  for _child in $_children; do
    terminate_process_tree "$_child" "$_signal" "$_wait_seconds"
  done
  kill "-$_signal" "$_pid" 2>/dev/null || kill -s "$_signal" "$_pid" 2>/dev/null || true
  _left="$_wait_seconds"
  while [ "$_left" -gt 0 ]; do
    kill -0 "$_pid" 2>/dev/null || return 0
    sleep 1
    _left=$(( _left - 1 ))
  done
  return 1
}

json_get_number() {
  _key="$1"
  _file="$2"
  sed -n "s/.*\"$_key\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$_file" 2>/dev/null | head -n 1
}

json_get_string() {
  _key="$1"
  _file="$2"
  sed -n "s/.*\"$_key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$_file" 2>/dev/null | head -n 1
}

next_schedule_arrived() {
  return 0
}

write_current_file() {
  _file="$1"
  _instance="$2"
  _worker_pid="$3"
  _started="$4"
  _expected="$5"
  printf '{\n  "instanceId": "%s",\n  "workerPid": %s,\n  "startedAt": "%s",\n  "expectedAt": "%s"\n}\n' \
    "$_instance" "$_worker_pid" "$_started" "$_expected" > "$_file"
}

clear_current_file() {
  _file="$1"
  _instance="$2"
  if [ -r "$_file" ] && [ "$(json_get_string instanceId "$_file")" = "$_instance" ]; then
    rm -f "$_file"
  fi
}

run_cron_supervisor() {
  INSTANCE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  STARTED_AT="$(iso_now)"
  EXPECTED_AT="$STARTED_AT"
  CURRENT_FILE="$JOB_TMP_DIR/current.json"
  export BUILDER_BLOG_JOB_RUN_ID="$INSTANCE_ID"
  export BUILDER_BLOG_JOB_TRIGGER="scheduled"
  export BUILDER_BLOG_SCHEDULE_JOB="$JOB_NAME"
  export BUILDER_BLOG_EXPECTED_AT="$EXPECTED_AT"
  export BUILDER_BLOG_JOB_STARTED_AT="$STARTED_AT"
  export BUILDER_BLOG_RUNNER_PID="$$"

  if [ -r "$CURRENT_FILE" ]; then
    OLD_PID="$(json_get_number workerPid "$CURRENT_FILE")"
    OLD_INSTANCE="$(json_get_string instanceId "$CURRENT_FILE")"
    if [ -n "$OLD_PID" ] && verify_followbrief_pid "$OLD_PID"; then
      OLD_ENV_INSTANCE="$BUILDER_BLOG_JOB_RUN_ID"
      BUILDER_BLOG_JOB_RUN_ID="$OLD_INSTANCE"
      export BUILDER_BLOG_JOB_RUN_ID
      job_run_update replaced "Replaced by a newer scheduled run." "status replaced next_schedule_arrived"
      if ! terminate_process_tree "$OLD_PID" TERM 30; then
        terminate_process_tree "$OLD_PID" KILL 3 || true
        job_run_update killed "Previous run was force-killed before the new schedule." "status killed next_schedule_arrived"
      fi
      BUILDER_BLOG_JOB_RUN_ID="$OLD_ENV_INSTANCE"
      export BUILDER_BLOG_JOB_RUN_ID
    elif [ -n "$OLD_INSTANCE" ]; then
      OLD_ENV_INSTANCE="$BUILDER_BLOG_JOB_RUN_ID"
      BUILDER_BLOG_JOB_RUN_ID="$OLD_INSTANCE"
      export BUILDER_BLOG_JOB_RUN_ID
      job_run_update stale "Previous run pid was no longer alive." "stale_pid"
      BUILDER_BLOG_JOB_RUN_ID="$OLD_ENV_INSTANCE"
      export BUILDER_BLOG_JOB_RUN_ID
    fi
  fi

  job_run_update starting "Scheduled run accepted by local supervisor." "next_schedule_arrived"
  export BUILDER_BLOG_WORKER_MODE=1
  export BUILDER_BLOG_WORKER_PID="$$"
  write_current_file "$CURRENT_FILE" "$INSTANCE_ID" "$BUILDER_BLOG_WORKER_PID" "$STARTED_AT" "$EXPECTED_AT"
  job_run_update running "Scheduled worker running in launchd foreground." "worker_started"

  set +e
  run_cron_worker
  _code="$?"
  set -e
  clear_current_file "$CURRENT_FILE" "$INSTANCE_ID"
  exit "$_code"
}

run_cron_worker() {
  run_with_job_tracking scheduled
}

run_with_job_tracking() {
  _trigger="$1"
  export BUILDER_BLOG_JOB_TRIGGER="$_trigger"
  export BUILDER_BLOG_SCHEDULE_JOB="$(schedule_job_for_name)"
  export BUILDER_BLOG_JOB_RUN_ID="${BUILDER_BLOG_JOB_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
  export BUILDER_BLOG_JOB_STARTED_AT="${BUILDER_BLOG_JOB_STARTED_AT:-$(iso_now)}"
  export BUILDER_BLOG_EXPECTED_AT="${BUILDER_BLOG_EXPECTED_AT:-$BUILDER_BLOG_JOB_STARTED_AT}"
  export BUILDER_BLOG_WORKER_PID="$$"
  export BUILDER_BLOG_RUNNER_PID="${BUILDER_BLOG_RUNNER_PID:-$$}"
  if [ "$_trigger" = "scheduled" ]; then
    BUILDER_BLOG_RUN_SOURCE=cron
  else
    BUILDER_BLOG_RUN_SOURCE=manual
  fi
  export BUILDER_BLOG_RUN_SOURCE

  _timeout="$(timeout_seconds_for_job "${INTERVAL_MINUTES:-60}" "$JOB_NAME")"
  job_run_update running "Runtime agent started." "runtime_agent_started"
  run_job_payload &
  RUNTIME_PID="$!"
  _elapsed=0
  _status="succeeded"
  while kill -0 "$RUNTIME_PID" 2>/dev/null; do
    if [ "$_elapsed" -ge "$_timeout" ]; then
      _status="timed_out"
      job_run_update timed_out "Runtime exceeded timeout and will be terminated." "timeout_seconds_for_job"
      terminate_process_tree "$RUNTIME_PID" TERM 30 || terminate_process_tree "$RUNTIME_PID" KILL 3 || true
      wait "$RUNTIME_PID" 2>/dev/null || true
      job_run_update timed_out "Runtime timed out." "timeout_seconds_for_job"
      return 124
    fi
    if [ $(( _elapsed % HEARTBEAT_INTERVAL_SECONDS )) -eq 0 ]; then
      job_run_update running "Runtime heartbeat." "heartbeat"
    fi
    sleep 5
    _elapsed=$(( _elapsed + 5 ))
  done
  wait "$RUNTIME_PID"
  _code="$?"
  if [ "$_code" -eq 0 ]; then
    job_run_update succeeded "Runtime completed successfully." "runtime_finished"
  elif [ "$_code" -eq 124 ]; then
    job_run_update timed_out "Runtime reported a timeout." "runtime_reported_timeout"
  else
    job_run_update failed "Runtime exited with code $_code." "runtime_finished"
  fi
  return "$_code"
}

IS_CRON_JOB=0
case "$JOB_NAME" in
  *-cron) IS_CRON_JOB=1 ;;
esac

run_selected_runtime() {
  if [ -n "${BUILDER_BLOG_AGENT_COMMAND:-}" ]; then
    run_with_override
  elif [ "$IS_CRON_JOB" = 0 ] && [ -n "$PINNED_RUNTIME" ]; then
    # One-time run with a pinned runtime (its own pin, or inherited from the
    # recurring job via the read_pin fallback): use the SAME agent the cron
    # job runs with, so a manual "run it now" produces the same results as the
    # schedule — instead of whatever the discovery chain finds first on PATH.
    # Interactive permission gates are kept (the user is at a TTY). A missing
    # binary falls back to the discovery chain rather than failing the run.
    case "$PINNED_RUNTIME" in
      claude|codex|gemini|openclaw)
        if command -v "$PINNED_RUNTIME" >/dev/null 2>&1; then
          "run_with_$PINNED_RUNTIME"
          return "$?"
        fi
        echo "Pinned runtime '$PINNED_RUNTIME' not on PATH for this one-time run — falling back to the discovery chain." >&2
        PINNED_RUNTIME=""
        ;;
      *)
        echo "Unknown pinned runtime '$PINNED_RUNTIME' in $AGENT_DIR — falling back to the discovery chain." >&2
        PINNED_RUNTIME=""
        ;;
    esac
  elif [ "$IS_CRON_JOB" = 1 ] && [ -n "$PINNED_RUNTIME" ]; then
    case "$PINNED_RUNTIME" in
      claude)
        command -v claude >/dev/null 2>&1 || { echo "Pinned runtime 'claude' not on PATH for cron." >&2; exit 78; }
        run_with_claude_unattended
        ;;
      codex)
        command -v codex >/dev/null 2>&1 || { echo "Pinned runtime 'codex' not on PATH for cron." >&2; exit 78; }
        run_with_codex_unattended
        ;;
      gemini)
        command -v gemini >/dev/null 2>&1 || { echo "Pinned runtime 'gemini' not on PATH for cron." >&2; exit 78; }
        run_with_gemini_unattended
        ;;
      openclaw)
        command -v openclaw >/dev/null 2>&1 || { echo "Pinned runtime 'openclaw' not on PATH for cron." >&2; exit 78; }
        run_with_openclaw_unattended
        ;;
      *)
        echo "Unknown pinned runtime '$PINNED_RUNTIME' in $AGENT_DIR/runtime — falling back to discovery chain." >&2
        PINNED_RUNTIME=""
        ;;
    esac
  fi
  if [ -z "${BUILDER_BLOG_AGENT_COMMAND:-}" ] && { [ "$IS_CRON_JOB" = 0 ] || [ -z "$PINNED_RUNTIME" ]; }; then
    if command -v codex >/dev/null 2>&1; then
      run_with_codex
    elif command -v claude >/dev/null 2>&1; then
      run_with_claude
    elif command -v openclaw >/dev/null 2>&1; then
      run_with_openclaw
    elif command -v gemini >/dev/null 2>&1; then
      run_with_gemini
    elif [ "$JOB_NAME" = "library-cron" ] || [ "$JOB_NAME" = "library-once" ]; then
      run_shell_library_fallback
    else
      echo "No local agent runtime found for FollowBrief digest generation." >&2
      echo "Install/configure Codex, Claude Code, OpenClaw, Gemini CLI, or set BUILDER_BLOG_AGENT_COMMAND." >&2
      echo "Digest cron requires an agent because it must summarize returned items with AI before sync." >&2
      exit 78
    fi
  fi
}

# The job payload run inside the supervised/tracked worker. Library jobs with
# a parallel pin >= 2 use the sharded orchestration; everything else (digest
# jobs, un-pinned accounts) keeps the single-agent path. The runtime smoke
# check never goes through here — it calls run_selected_runtime directly.
run_job_payload() {
  case "$JOB_NAME" in
    library-once|library-cron)
      if [ "$MAX_PARALLEL_WORKERS" -ge 2 ]; then
        run_sharded_library
        return "$?"
      fi
      ;;
  esac
  run_selected_runtime
}

# Sharded library run: the runner owns every deterministic step (fetch, shard,
# merge, validate, sync) and runtime agents only do the genuinely agentic work
# — a discovery pre-pass when the fetch result contains candidate-discovery
# tasks, then one worker per shard completing that shard's fetchTasks. Workers
# write per-shard result files; merge-task-results assembles the single sync
# payload and backfills a failed taskOutcome for any task a worker never
# reported (crash/timeout), so the "every task ends in a terminal state"
# validation contract holds even with partial worker failure.
run_sharded_library() {
  _shards_dir="$JOB_TMP_DIR/shards"
  _results_dir="$_shards_dir/results"
  rm -rf "$_shards_dir"
  mkdir -p "$_results_dir"
  _result_file="$JOB_TMP_DIR/library-fetch-result.json"

  echo "FollowBrief parallel library run: up to $MAX_PARALLEL_WORKERS workers."

  node "$AGENT_DIR/builder-digest.mjs" fetch-personal \
    --days "${BUILDER_BLOG_FETCH_DAYS:-30}" \
    --limit "${BUILDER_BLOG_FETCH_LIMIT:-3}" \
    ${BUILDER_BLOG_FETCH_FORCE:-} > "$_result_file"
  cat "$_result_file"

  if grep -q '"candidate_discovery_fallback"' "$_result_file"; then
    echo "Discovery tasks present; running the discovery agent pre-pass."
    if ! ( if [ "$PINNED_RUNTIME" = "openclaw" ]; then
             OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-discovery' "$ACCOUNT_SLUG" "$JOB_NAME" "$$" | tr -c 'a-zA-Z0-9_.@+-' '_')"
             export OPENCLAW_SESSION_ID
           fi
           PROMPT_FILE="$AGENT_DIR/jobs/library-discovery.md"
           IS_CRON_JOB=1
           run_selected_runtime ); then
      echo "Discovery pre-pass failed; un-expanded discovery tasks will be reported as failed." >&2
    fi
  fi

  node "$AGENT_DIR/builder-digest.mjs" shard-tasks \
    --tasks "$_result_file" \
    --out-dir "$_shards_dir" \
    --max-workers "$MAX_PARALLEL_WORKERS"

  # Per-shard timeout: half the whole-job timeout. A hung shard is terminated
  # and its tasks surface as failed outcomes, while the other shards still
  # merge and sync — partial success instead of losing the whole run.
  _shard_timeout=$(( $(timeout_seconds_for_job "${INTERVAL_MINUTES:-60}" "$JOB_NAME") / 2 ))
  _worker_entries=""
  for _shard_file in "$_shards_dir"/shard-*.json; do
    [ -e "$_shard_file" ] || continue
    _shard_name="$(basename "$_shard_file" .json)"
    (
      BUILDER_BLOG_SHARD_FILE="$_shard_file"
      BUILDER_BLOG_SHARD_RESULT="$_results_dir/$_shard_name-result.json"
      export BUILDER_BLOG_SHARD_FILE BUILDER_BLOG_SHARD_RESULT
      if [ "$PINNED_RUNTIME" = "openclaw" ]; then
        OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-%s' "$ACCOUNT_SLUG" "$JOB_NAME" "$$" "$_shard_name" | tr -c 'a-zA-Z0-9_.@+-' '_')"
        export OPENCLAW_SESSION_ID
      fi
      PROMPT_FILE="$AGENT_DIR/jobs/library-worker.md"
      # Workers must never wait on interactive permission prompts, so they
      # always use the pinned runtime's unattended invocation — even when the
      # enclosing job is a one-time run.
      IS_CRON_JOB=1
      run_selected_runtime
    ) > "$_results_dir/$_shard_name-worker.log" 2>&1 &
    _worker_entries="$_worker_entries $!:$(date +%s):$_shard_name"
    echo "Started worker $_shard_name (pid $!)."
  done

  while :; do
    _alive=0
    _now="$(date +%s)"
    for _entry in $_worker_entries; do
      _pid="${_entry%%:*}"
      _rest="${_entry#*:}"
      _started="${_rest%%:*}"
      _name="${_rest#*:}"
      if kill -0 "$_pid" 2>/dev/null; then
        if [ $(( _now - _started )) -ge "$_shard_timeout" ]; then
          echo "Worker $_name exceeded ${_shard_timeout}s; terminating it (its tasks will be reported as failed)." >&2
          terminate_process_tree "$_pid" TERM 10 || terminate_process_tree "$_pid" KILL 3 || true
        else
          _alive=$(( _alive + 1 ))
        fi
      fi
    done
    [ "$_alive" -eq 0 ] && break
    sleep 5
  done
  for _entry in $_worker_entries; do
    wait "${_entry%%:*}" 2>/dev/null || true
  done

  for _worker_log in "$_results_dir"/*-worker.log; do
    [ -e "$_worker_log" ] || continue
    echo "--- $(basename "$_worker_log") ---"
    cat "$_worker_log"
  done

  node "$AGENT_DIR/builder-digest.mjs" merge-task-results \
    --tasks "$_result_file" \
    --results-dir "$_results_dir" \
    --out "$JOB_TMP_DIR/library-agent-sync.json"

  # validate-agent-sync exits non-zero when any task fails validation; capture
  # the exit code (instead of letting set -e abort) so the validation details
  # always land in the job log before we refuse to sync.
  _validate_file="$JOB_TMP_DIR/validate-agent-sync-result.json"
  set +e
  node "$AGENT_DIR/builder-digest.mjs" validate-agent-sync \
    --tasks "$_result_file" \
    --file "$JOB_TMP_DIR/library-agent-sync.json" > "$_validate_file" 2>&1
  _validate_code="$?"
  set -e
  cat "$_validate_file"
  if [ "$_validate_code" -ne 0 ] || ! grep -q '"status": "ok"' "$_validate_file"; then
    echo "validate-agent-sync did not return status ok (exit $_validate_code); not syncing." >&2
    return 65
  fi

  node "$AGENT_DIR/builder-digest.mjs" sync-builders \
    --file "$JOB_TMP_DIR/library-agent-sync.json" \
    --tasks "$_result_file"
}

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_SMOKE_CHECK:-0}" = "1" ]; then
  run_runtime_smoke_check
  exit "$?"
fi

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_WORKER_MODE:-0}" != "1" ] && [ "${BUILDER_BLOG_DISABLE_WEB_SYNC:-0}" != "1" ]; then
  run_cron_supervisor
fi

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; then
  run_cron_worker
elif [ "$JOB_NAME" = "library-once" ] || [ "$JOB_NAME" = "digest-once" ]; then
  run_with_job_tracking one_time
else
  run_selected_runtime
fi
