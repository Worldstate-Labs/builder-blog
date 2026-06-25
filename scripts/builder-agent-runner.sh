#!/bin/sh
set -eu

JOB_NAME="${1:-}"
APP_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PROMPT_FILE="$AGENT_DIR/jobs/$JOB_NAME.md"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
DEFAULT_JOB_TMP_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/$JOB_NAME"
# A direct worker-mode invocation (the setup initial run, or any manual
# BUILDER_BLOG_WORKER_MODE=1 run) bypasses run_cron_supervisor and its
# current.json single-instance lock. Only such direct calls carry WORKER_MODE=1
# at entry — the scheduled path enters without it and the supervisor sets it
# later in-process, after JOB_TMP_DIR is already fixed. Give the bypassing run
# an isolated temp dir so it can never race a launchd-scheduled run of the same
# job over the shared library-cron/digest-cron temp files.
if [ -n "${BUILDER_BLOG_JOB_TMP_DIR:-}" ]; then
  JOB_TMP_DIR="$BUILDER_BLOG_JOB_TMP_DIR"
elif [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; then
  JOB_TMP_DIR="$DEFAULT_JOB_TMP_DIR-direct"
else
  JOB_TMP_DIR="$DEFAULT_JOB_TMP_DIR"
fi
HEARTBEAT_INTERVAL_SECONDS=60

# launchd/cron do not inherit the user's interactive shell PATH. Include the
# common user-level install locations used by local agent CLIs so scheduled
# jobs can find runtimes installed with their default installers.
SCHEDULER_SAFE_PATH="$HOME/.local/bin:$HOME/bin:$HOME/.codex/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
PATH="$SCHEDULER_SAFE_PATH:$PATH"
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
if [ "${BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH:-0}" != "1" ] && { [ "${BUILDER_BLOG_SCHEDULER_TICK:-0}" != "1" ] || [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; }; then
  self_update_and_reexec "$@"
fi

refresh_skill_files() {
  mkdir -p "$AGENT_DIR" "$AGENT_DIR/jobs" "$AGENT_DIR/logs" "$AGENT_DIR/tmp"
  download_skill_file "$APP_URL/api/skill/files/builder-digest.mjs" "$AGENT_DIR/builder-digest.mjs"
  download_skill_file "$APP_URL/api/skill/files/sources.json" "$AGENT_DIR/sources.json"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-library-once.md" "$AGENT_DIR/jobs/library-once.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-once.md" "$AGENT_DIR/jobs/digest-once.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-library-cron-setup.md" "$AGENT_DIR/jobs/library-cron-setup.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-cron-setup.md" "$AGENT_DIR/jobs/digest-cron-setup.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-cron.md" "$AGENT_DIR/jobs/digest-cron.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-library-worker.md" "$AGENT_DIR/jobs/library-worker.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-library-discovery.md" "$AGENT_DIR/jobs/library-discovery.md"
  download_skill_file "$APP_URL/api/skill/files/local-agent-timeouts.json" "$AGENT_DIR/local-agent-timeouts.json"
  chmod +x "$AGENT_DIR/builder-digest.mjs"
}

download_skill_file() {
  _url="$1"
  _dest="$2"
  mkdir -p "$(dirname "$_dest")"
  _tmp="$(dirname "$_dest")/.$(basename "$_dest").$ACCOUNT_SLUG.$JOB_NAME.$$.tmp"
  if ! curl -fsSL "$_url" -o "$_tmp"; then
    rm -f "$_tmp" 2>/dev/null || true
    return 1
  fi
  mv "$_tmp" "$_dest"
}

# Always pull latest CLI to avoid version drift between cached prompt/CLI and the server.
# A macOS scheduler tick runs every minute and may not be due; keep that path
# short. The worker it launches refreshes files before doing real work.
if [ "${BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH:-0}" != "1" ] && { [ "${BUILDER_BLOG_SCHEDULER_TICK:-0}" != "1" ] || [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; }; then
  refresh_skill_files
fi

if [ -n "${BUILDER_BLOG_PROMPT_URL:-}" ]; then
  mkdir -p "$AGENT_DIR/jobs"
  download_skill_file "$BUILDER_BLOG_PROMPT_URL" "$PROMPT_FILE"
fi

if [ ! -f "$PROMPT_FILE" ] && { [ "${BUILDER_BLOG_SCHEDULER_TICK:-0}" != "1" ] || [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; }; then
  echo "Missing FollowBrief job prompt: $PROMPT_FILE" >&2
  echo "Run: /bin/sh -c \"\$(curl -fsSL $APP_URL/api/skill/bootstrap)\"" >&2
  exit 66
fi

run_with_override() {
  BUILDER_BLOG_JOB="$JOB_NAME" BUILDER_BLOG_PROMPT_FILE="$PROMPT_FILE" sh -c "$BUILDER_BLOG_AGENT_COMMAND"
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

openclaw_prompt_dir() {
  _ocp_dir="$JOB_TMP_DIR/openclaw-prompts"
  mkdir -p "$_ocp_dir"
  printf '%s\n' "$_ocp_dir"
}

openclaw_worker_prompt_file() {
  _ocp_shard_name="$1"
  _ocp_shard_file="$2"
  _ocp_result_file="$3"
  _ocp_checkpoint_dir="$4"
  _ocp_out="$(openclaw_prompt_dir)/$_ocp_shard_name-worker.md"
  cat > "$_ocp_out" <<EOF
OpenClaw Gateway runner context:

This job runs through OpenClaw Gateway. Gateway tool calls may not inherit the
parent runner shell environment. Treat the concrete paths below as
authoritative, and do not search for the shard assignment or result path.

- Shard file: $_ocp_shard_file
- Shard result file: $_ocp_result_file
- Shard checkpoint directory: $_ocp_checkpoint_dir
- Agent directory: $AGENT_DIR
- Account: ${BUILDER_BLOG_ACCOUNT:-default}

If the original instructions reference \$BUILDER_BLOG_SHARD_FILE, use:
$_ocp_shard_file

If they reference \$BUILDER_BLOG_SHARD_RESULT, use:
$_ocp_result_file

If they reference \$BUILDER_BLOG_SHARD_CHECKPOINT_DIR, use:
$_ocp_checkpoint_dir

If you use shell commands, include these exports at the top of the same shell
block that reads or writes FollowBrief files:

\`\`\`bash
export BUILDER_BLOG_AGENT_DIR=$(shell_quote "$AGENT_DIR")
export BUILDER_BLOG_ACCOUNT=$(shell_quote "${BUILDER_BLOG_ACCOUNT:-default}")
export BUILDER_BLOG_SHARD_FILE=$(shell_quote "$_ocp_shard_file")
export BUILDER_BLOG_SHARD_RESULT=$(shell_quote "$_ocp_result_file")
export BUILDER_BLOG_SHARD_CHECKPOINT_DIR=$(shell_quote "$_ocp_checkpoint_dir")
\`\`\`

Original task instructions:

EOF
  cat "$AGENT_DIR/jobs/library-worker.md" >> "$_ocp_out"
  printf '%s\n' "$_ocp_out"
}

openclaw_discovery_prompt_file() {
  _ocp_fetch_result="$1"
  _ocp_discovery_result="$2"
  _ocp_out="$(openclaw_prompt_dir)/library-discovery.md"
  cat > "$_ocp_out" <<EOF
OpenClaw Gateway runner context:

This job runs through OpenClaw Gateway. Gateway tool calls may not inherit the
parent runner shell environment. Treat the concrete paths below as
authoritative, and do not search for the fetch result or output path.

- Job temp directory: $JOB_TMP_DIR
- Fetch result file: $_ocp_fetch_result
- Discovery result file: $_ocp_discovery_result
- Agent directory: $AGENT_DIR
- Account: ${BUILDER_BLOG_ACCOUNT:-default}

If the original instructions compute TMP_DIR from \$BUILDER_BLOG_JOB_TMP_DIR,
use this exact TMP_DIR:
$JOB_TMP_DIR

If you use shell commands, include these exports at the top of the same shell
block that reads or writes FollowBrief files:

\`\`\`bash
export BUILDER_BLOG_AGENT_DIR=$(shell_quote "$AGENT_DIR")
export BUILDER_BLOG_ACCOUNT=$(shell_quote "${BUILDER_BLOG_ACCOUNT:-default}")
export BUILDER_BLOG_JOB_TMP_DIR=$(shell_quote "$JOB_TMP_DIR")
\`\`\`

Original task instructions:

EOF
  cat "$AGENT_DIR/jobs/library-discovery.md" >> "$_ocp_out"
  printf '%s\n' "$_ocp_out"
}

digest_agent_prompt_file() {
  _dap_base_prompt="$1"
  _dap_context_file="$2"
  _dap_agent_output_file="$3"
  _dap_item_count="${4:-}"
  _dap_out="$JOB_TMP_DIR/digest-agent.md"
  cat > "$_dap_out" <<EOF
FollowBrief runner-verified digest context:

The runner already prepared and validated the candidate set before this agent
turn. Use the concrete paths and count below as authoritative.

- Digest context file: $_dap_context_file
- Digest agent output file: $_dap_agent_output_file
- Candidate item count verified by the runner before this agent turn: $_dap_item_count

Before writing the digest JSON, deterministically read the concrete Digest
context file above and confirm the number of \`items\`. If the file contains one
or more items, you must write the Digest agent output JSON. Do not stop with a
"no candidate items" report when the runner-verified count above is non-zero.

Original task instructions:

EOF
  cat "$_dap_base_prompt" >> "$_dap_out"
  printf '%s\n' "$_dap_out"
}

openclaw_digest_prompt_file() {
  _ocp_base_prompt="$1"
  _ocp_context_file="$2"
  _ocp_agent_output_file="$3"
  _ocp_out="$(openclaw_prompt_dir)/digest-agent.md"
  cat > "$_ocp_out" <<EOF
OpenClaw Gateway runner context:

This job runs through OpenClaw Gateway. Gateway tool calls may not inherit the
parent runner shell environment. Treat the concrete paths below as
authoritative, and do not search for the digest context or output path.

- Job temp directory: $JOB_TMP_DIR
- Digest context file: $_ocp_context_file
- Digest agent output file: $_ocp_agent_output_file
- Agent directory: $AGENT_DIR
- Account: ${BUILDER_BLOG_ACCOUNT:-default}

If the original instructions compute TMP_DIR from \$BUILDER_BLOG_JOB_TMP_DIR,
use this exact TMP_DIR:
$JOB_TMP_DIR

If you use shell commands, include these exports at the top of the same shell
block that reads or writes FollowBrief files:

\`\`\`bash
export BUILDER_BLOG_AGENT_DIR=$(shell_quote "$AGENT_DIR")
export BUILDER_BLOG_ACCOUNT=$(shell_quote "${BUILDER_BLOG_ACCOUNT:-default}")
export BUILDER_BLOG_JOB_TMP_DIR=$(shell_quote "$JOB_TMP_DIR")
export BUILDER_BLOG_DIGEST_AGENT_ONLY=1
\`\`\`

Original task instructions:

EOF
  cat "$_ocp_base_prompt" >> "$_ocp_out"
  printf '%s\n' "$_ocp_out"
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

run_with_hermes() {
  hermes chat -q "$(cat "$PROMPT_FILE")"
}

agent_output_file() {
  _runtime="$1"
  mkdir -p "$JOB_TMP_DIR"
  mktemp "$JOB_TMP_DIR/$_runtime-agent-output.XXXXXX"
}

openclaw_default_session_id() {
  _suffix="${BUILDER_BLOG_JOB_RUN_ID:-$$}"
  printf 'followbrief-%s-%s-%s' "$ACCOUNT_SLUG" "$JOB_NAME" "$_suffix" | tr -c 'a-zA-Z0-9_.@+-' '_'
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
  _codex_output="$(agent_output_file codex)"
  LAST_AGENT_OUTPUT_FILE="$_codex_output"
  set +e
  codex exec --skip-git-repo-check --full-auto \
    -c sandbox_workspace_write.network_access=true \
    -C "$AGENT_DIR" - < "$PROMPT_FILE" > "$_codex_output" 2>&1
  _codex_code="$?"
  set -e
  cat "$_codex_output"
  if agent_output_has_timeout "$_codex_output"; then
    return 124
  fi
  if [ "$_codex_code" -eq 0 ] && ! digest_output_completed "$_codex_output"; then
    return 1
  fi
  return "$_codex_code"
}

run_with_claude_unattended() {
  # acceptEdits auto-approves edits; allowedTools whitelists the tool
  # surface the library-once skill actually uses (Bash for node CLI +
  # curl, WebFetch for content extraction, file IO under tmp/).
  _claude_output="$(agent_output_file claude)"
  LAST_AGENT_OUTPUT_FILE="$_claude_output"
  set +e
  claude -p "$(cat "$PROMPT_FILE")" \
    --add-dir "$AGENT_DIR" \
    --permission-mode acceptEdits \
    --allowedTools "Bash,Edit,Read,Write,Grep,Glob,WebFetch" > "$_claude_output" 2>&1
  _claude_code="$?"
  set -e
  cat "$_claude_output"
  if agent_output_has_timeout "$_claude_output"; then
    return 124
  fi
  if [ "$_claude_code" -eq 0 ] && ! digest_output_completed "$_claude_output"; then
    return 1
  fi
  return "$_claude_code"
}

run_with_openclaw_unattended() {
  # OpenClaw's DEFAULT exec policy is already security=full / ask=off (verified
  # via `openclaw exec-policy show` with no approvals file present), so a
  # non-interactive Gateway `agent` turn auto-approves exec on its own. Do not
  # use `--local` here: local embedded runs take a separate provider-auth path
  # and can fail Codex OAuth refresh even while the main OpenClaw Gateway can
  # chat normally. The old global-yolo preset command was both unnecessary AND
  # harmful: it wrote the GLOBAL ~/.openclaw/exec-approvals.json, disarming
  # approval for EVERY OpenClaw session on the host (and `--profile` does not
  # relocate that file, so it can't be scoped that way). So we don't touch
  # global policy at all. `agent` requires a session selector on 2026.5.20
  # (the bare `--message` form errors "Pass --to/--session-id/--agent");
  # scheduled jobs use an isolated deterministic Gateway session by default
  # instead of appending to the huge interactive `main` session; parallel
  # workers can still set OPENCLAW_SESSION_ID when they need shard-specific
  # sessions.
  _openclaw_timeout="${_timeout:-$(job_timeout_seconds)}"
  sync_openclaw_timeout_config "$_openclaw_timeout"
  _openclaw_output="$(agent_output_file openclaw)"
  LAST_AGENT_OUTPUT_FILE="$_openclaw_output"
  _openclaw_session_id="${OPENCLAW_SESSION_ID:-$(openclaw_default_session_id)}"
  _openclaw_attempts="$(openclaw_capacity_attempts)"
  _openclaw_delay="$(openclaw_capacity_retry_delay_seconds)"
  _openclaw_models="$(openclaw_model_candidates)"
  if [ -z "$_openclaw_models" ]; then
    _openclaw_models="__followbrief_default_model__"
  fi

  _openclaw_attempt=1
  _openclaw_code=1
  while [ "$_openclaw_attempt" -le "$_openclaw_attempts" ]; do
    for _openclaw_model in $_openclaw_models; do
      if [ "$_openclaw_model" = "__followbrief_default_model__" ]; then
        echo "Running OpenClaw Gateway attempt $_openclaw_attempt/$_openclaw_attempts with the configured default model."
        set +e
        openclaw agent --session-id "$_openclaw_session_id" --timeout "$_openclaw_timeout" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
        _openclaw_code="$?"
        set -e
      else
        echo "Running OpenClaw Gateway attempt $_openclaw_attempt/$_openclaw_attempts with model $_openclaw_model."
        set +e
        openclaw agent --session-id "$_openclaw_session_id" --timeout "$_openclaw_timeout" --model "$_openclaw_model" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
        _openclaw_code="$?"
        set -e
      fi
      cat "$_openclaw_output"
      if agent_output_has_timeout "$_openclaw_output"; then
        return 124
      fi
      if [ "$_openclaw_code" -eq 0 ] && digest_output_completed "$_openclaw_output"; then
        return 0
      fi
      if ! agent_output_has_openclaw_capacity_failure "$_openclaw_output"; then
        if [ "$_openclaw_code" -eq 0 ]; then
          return 1
        fi
        return "$_openclaw_code"
      fi
    done
    if [ "$_openclaw_attempt" -lt "$_openclaw_attempts" ]; then
      echo "OpenClaw selected model was at capacity; retrying in ${_openclaw_delay}s." >&2
      sleep "$_openclaw_delay"
    fi
    _openclaw_attempt="$(( _openclaw_attempt + 1 ))"
  done
  return "$_openclaw_code"
}

agent_output_has_openclaw_auth_failure() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  grep -E -i -q \
    "OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth" \
    "$_file"
}

openclaw_auth_failure_summary() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 0
  grep -E -i -m 1 \
    "OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth|FailoverError:" \
    "$_file" | sed 's/^[[:space:]]*//' | cut -c 1-500 || true
}

agent_output_has_openclaw_preflight_marker() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  grep -q '"followbriefRuntimePreflight"[[:space:]]*:[[:space:]]*"ok"' "$_file" && \
    grep -q '"runtimeReady"[[:space:]]*:[[:space:]]*true' "$_file"
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

agent_output_has_timeout() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  grep -E -i -q \
    "Request timed out before a response was generated|codex app-server turn idle timed out|codex app-server client retired after timed-out turn|embedded run failover decision:.*reason=timeout|LLM timed out|Profile .* timed out|DEADLINE_EXCEEDED|deadline exceeded" \
    "$_file"
}

agent_output_has_openclaw_capacity_failure() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  grep -E -i -q \
    "Selected model is at capacity|model is at capacity|provider overloaded|overloaded|rate.?limit|too many requests|FailoverError:.*capacity|FailoverError:.*overload|FailoverError:.*rate" \
    "$_file"
}

agent_runtime_failure_summary() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 0
  grep -E -i -m 1 \
    "GatewayClientRequestError:|FailoverError:|Provider authentication failed|OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth|Request timed out before a response was generated|DEADLINE_EXCEEDED|deadline exceeded|No candidate items were present|did not write a digest JSON|did not write digest JSON|Digest agent did not produce builder-blog-digest-agent-output\\.json" \
    "$_file" | sed 's/^[[:space:]]*//' | cut -c 1-500 || true
}

openclaw_capacity_attempts() {
  _value="${BUILDER_BLOG_OPENCLAW_CAPACITY_ATTEMPTS:-3}"
  case "$_value" in
    ''|*[!0-9]*) printf '%s\n' 3 ;;
    0) printf '%s\n' 1 ;;
    *) printf '%s\n' "$_value" ;;
  esac
}

openclaw_capacity_retry_delay_seconds() {
  _value="${BUILDER_BLOG_OPENCLAW_CAPACITY_RETRY_DELAY_SECONDS:-20}"
  case "$_value" in
    ''|*[!0-9]*) printf '%s\n' 20 ;;
    *) printf '%s\n' "$_value" ;;
  esac
}

openclaw_model_candidates() {
  if [ -n "${BUILDER_BLOG_OPENCLAW_MODELS:-}" ]; then
    printf '%s\n' "$BUILDER_BLOG_OPENCLAW_MODELS" | tr ', ' '\n\n' | awk 'NF && !seen[$0]++'
    return 0
  fi

  node <<'NODE'
const { execFileSync } = require("node:child_process");

function configGet(path) {
  try {
    return execFileSync("openclaw", ["config", "get", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const raw = configGet("agents.defaults.model");
const models = ["__followbrief_default_model__"];
try {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed?.fallbacks)) models.push(...parsed.fallbacks.filter((model) => typeof model === "string"));
} catch {
  // Scalar/default model config is already covered by the no --model first
  // attempt, which lets OpenClaw own its normal routing behavior.
}

const seen = new Set();
for (const model of models.map((value) => value.trim()).filter(Boolean)) {
  if (seen.has(model)) continue;
  seen.add(model);
  console.log(model);
}
NODE
}

digest_output_completed() {
  case "$JOB_NAME" in
    digest-once|digest-cron) ;;
    *) return 0 ;;
  esac

  _output_file="${1:-}"
  if [ "${BUILDER_BLOG_DIGEST_AGENT_ONLY:-}" = "1" ]; then
    if [ -s "$JOB_TMP_DIR/builder-blog-digest-agent-output.json" ]; then
      return 0
    fi
    _digest_missing_message="Digest agent did not produce builder-blog-digest-agent-output.json."
    echo "$_digest_missing_message" >&2
    if [ -n "$_output_file" ] && [ -w "$_output_file" ]; then
      printf '%s\n' "$_digest_missing_message" >> "$_output_file"
    fi
    return 1
  fi

  _missing=""
  for _artifact in \
    "$JOB_TMP_DIR/builder-blog-context.json" \
    "$JOB_TMP_DIR/builder-blog-digest-agent-output.json" \
    "$JOB_TMP_DIR/builder-blog-digest.json" \
    "$JOB_TMP_DIR/builder-blog-digest-headlines.txt"
  do
    if [ ! -s "$_artifact" ]; then
      _missing="${_missing}${_missing:+, }$_artifact"
    fi
  done

  if [ -n "$_missing" ]; then
    echo "Digest job did not produce required artifact(s): $_missing" >&2
    return 1
  fi

  _sync_result="$JOB_TMP_DIR/builder-blog-digest-sync-result.json"
  if [ -s "$_sync_result" ]; then
    node - "$_sync_result" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
let result;
try {
  result = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (error) {
  console.error(`Digest sync result is not valid JSON: ${error.message}`);
  process.exit(1);
}
if (result?.status === "ok" && result?.digest?.status === "SYNCED" && result?.digest?.id) {
  process.exit(0);
}
console.error("Digest sync result did not confirm a synced web digest.");
process.exit(1);
NODE
    return "$?"
  fi

  if [ -n "$_output_file" ] && [ -r "$_output_file" ]; then
    if grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' "$_output_file" && \
       grep -q '"status"[[:space:]]*:[[:space:]]*"SYNCED"' "$_output_file"; then
      return 0
    fi
    echo "Digest job produced local artifacts, but no sync result file confirmed web sync." >&2
    return 1
  fi

  echo "Digest job produced local artifacts, but no sync result file was available to confirm web sync." >&2
  return 1
}

run_with_hermes_unattended() {
  _hermes_output="$(agent_output_file hermes)"
  LAST_AGENT_OUTPUT_FILE="$_hermes_output"
  set +e
  hermes chat -Q --yolo --accept-hooks --source tool -q "$(cat "$PROMPT_FILE")" > "$_hermes_output" 2>&1
  _hermes_code="$?"
  set -e
  cat "$_hermes_output"
  if agent_output_has_timeout "$_hermes_output"; then
    return 124
  fi
  if [ "$_hermes_code" -eq 0 ] && ! digest_output_completed "$_hermes_output"; then
    return 1
  fi
  return "$_hermes_code"
}

run_shell_library_fallback() {
  echo "No local agent runtime found; running non-AI library fetch fallback." >&2
  echo "Sources requiring AI, cookies, transcription, summaries, or custom tools will need BUILDER_BLOG_AGENT_COMMAND, codex, claude, openclaw, or hermes." >&2
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
  console.error("Install/configure Codex, Claude Code, OpenClaw, Hermes, or set BUILDER_BLOG_AGENT_COMMAND.");
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
  _timeout="$(job_timeout_seconds)"
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
# One-time jobs additionally fall back to their recurring job's non-runtime
# pins: the user expectation for library-once / digest-once is "run the same
# fetch window/mode right now". Runtime is intentionally independent: copied
# one-time prompts pass BUILDER_BLOG_AGENT_RUNTIME for that run, and old copied
# prompts should use the once/global runtime pins or the discovery chain rather
# than silently inheriting a cron job's runtime.
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

read_runtime_pin() {
  # Runtime pins do not use the once→cron fallback. A one-time run's Local Agent
  # must come from this run's env, a one-time/global pin, or normal discovery.
  if [ -r "$AGENT_DIR/runtime-$JOB_NAME-$ACCOUNT_SLUG" ]; then
    tr -d ' \t\r\n' < "$AGENT_DIR/runtime-$JOB_NAME-$ACCOUNT_SLUG"
    return 0
  fi
  if [ -r "$AGENT_DIR/runtime-$JOB_NAME" ]; then
    tr -d ' \t\r\n' < "$AGENT_DIR/runtime-$JOB_NAME"
    return 0
  fi
  if [ -r "$AGENT_DIR/runtime" ]; then
    tr -d ' \t\r\n' < "$AGENT_DIR/runtime"
  fi
}

normalize_runtime() {
  case "${1:-}" in
    claude|codex|hermes|openclaw) printf '%s\n' "$1" ;;
    *) printf '%s\n' "" ;;
  esac
}

INCOMING_RUNTIME_SET=0
INCOMING_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME:-}"
if [ "${BUILDER_BLOG_AGENT_RUNTIME+x}" = "x" ]; then
  INCOMING_RUNTIME_SET=1
fi

INCOMING_FETCH_FORCE_SET=0
INCOMING_FETCH_FORCE="${BUILDER_BLOG_FETCH_FORCE:-}"
if [ "${BUILDER_BLOG_FETCH_FORCE+x}" = "x" ]; then
  INCOMING_FETCH_FORCE_SET=1
fi
INCOMING_FETCH_DAYS_SET=0
INCOMING_FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS:-}"
if [ "${BUILDER_BLOG_FETCH_DAYS+x}" = "x" ]; then
  INCOMING_FETCH_DAYS_SET=1
fi
INCOMING_PARALLEL_WORKERS_SET=0
INCOMING_PARALLEL_WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS:-}"
if [ "${BUILDER_BLOG_PARALLEL_WORKERS+x}" = "x" ]; then
  INCOMING_PARALLEL_WORKERS_SET=1
fi
INCOMING_DIGEST_REGENERATE_SET=0
INCOMING_DIGEST_REGENERATE="${BUILDER_BLOG_DIGEST_REGENERATE:-}"
if [ "${BUILDER_BLOG_DIGEST_REGENERATE+x}" = "x" ]; then
  INCOMING_DIGEST_REGENERATE_SET=1
fi
INCOMING_INTERVAL_MINUTES="${BUILDER_BLOG_INTERVAL_MINUTES:-${INTERVAL_MINUTES:-}}"
case "$INCOMING_INTERVAL_MINUTES" in
  ''|*[!0-9]*) RESOLVED_INTERVAL_MINUTES="60" ;;
  0) RESOLVED_INTERVAL_MINUTES="60" ;;
  *) RESOLVED_INTERVAL_MINUTES="$INCOMING_INTERVAL_MINUTES" ;;
esac
export INTERVAL_MINUTES="$RESOLVED_INTERVAL_MINUTES"

# The resolved runtime is a single word: claude | codex | hermes | openclaw.
# One-time prompts pass BUILDER_BLOG_AGENT_RUNTIME as a per-run override.
# Otherwise read a runtime pin for this exact job (or the legacy global pin).
# Do not fall back from one-time jobs to cron runtime pins.
if [ "$INCOMING_RUNTIME_SET" = "1" ]; then
  PINNED_RUNTIME="$(normalize_runtime "$INCOMING_RUNTIME")"
else
  PINNED_RUNTIME="$(normalize_runtime "$(read_runtime_pin)")"
fi

# Surface the resolved runtime to the CLI so the fetch-run record (and the web
# fetch log) can label which agent ran it. The CLI also auto-detects
# codex/claude from their own env, but the pin is authoritative and is the only
# signal for hermes/openclaw. Empty for un-pinned interactive runs → the CLI
# falls back to env detection.
export BUILDER_BLOG_RUNTIME="$PINNED_RUNTIME"

# Forced re-fetch: cron-setup writes 1 to the fetch-force pin when the user
# picked "override already-fetched posts". We expose it as
# BUILDER_BLOG_FETCH_FORCE, which the runner passes to fetch-personal
# (`${BUILDER_BLOG_FETCH_FORCE:-}` → --force). "1" → --force (re-pull posts
# already in the library, ignoring the fetchedAt cutoff + externalId dedup);
# anything else → no flag.
BUILDER_BLOG_FETCH_FORCE=""
if [ "$INCOMING_FETCH_FORCE_SET" = "1" ]; then
  BUILDER_BLOG_FETCH_FORCE="$INCOMING_FETCH_FORCE"
elif [ "$(read_pin fetch-force)" = "1" ]; then
  BUILDER_BLOG_FETCH_FORCE="--force"
fi
export BUILDER_BLOG_FETCH_FORCE

# Fetch lookback window: cron-setup writes a bounded 1-90 day value. Default to
# 30 for older schedules that have no pin yet.
if [ "$INCOMING_FETCH_DAYS_SET" = "1" ]; then
  BUILDER_BLOG_FETCH_DAYS="$INCOMING_FETCH_DAYS"
else
  BUILDER_BLOG_FETCH_DAYS="$(read_pin fetch-days)"
fi
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
# BUILDER_BLOG_DIGEST_REGENERATE, which the deterministic digest runner passes
# to the prepare/sync commands (`${BUILDER_BLOG_DIGEST_REGENERATE:-}` → --regenerate).
# "1" → re-cover the full window and replace the existing same-day digest;
# anything else → no flag (normal incremental digest).
BUILDER_BLOG_DIGEST_REGENERATE=""
if [ "$INCOMING_DIGEST_REGENERATE_SET" = "1" ]; then
  BUILDER_BLOG_DIGEST_REGENERATE="$INCOMING_DIGEST_REGENERATE"
elif [ "$(read_pin regenerate)" = "1" ]; then
  BUILDER_BLOG_DIGEST_REGENERATE="--regenerate"
fi
export BUILDER_BLOG_DIGEST_REGENERATE

# Library fetch fan-out: the runner orchestrates the library job itself —
# fetch-personal, discovery expansion, shard-tasks, merge-task-results,
# validate-agent-sync, and sync-builders are deterministic CLI steps. Runtime
# workers only complete assigned fetchTasks. The pin is per-account and per-job
# with the usual once→cron fallback, so a one-time run uses the same worker
# count as the recurring job. Absent/0/1 → one worker.
if [ "$INCOMING_PARALLEL_WORKERS_SET" = "1" ]; then
  MAX_PARALLEL_WORKERS="$INCOMING_PARALLEL_WORKERS"
else
  MAX_PARALLEL_WORKERS="$(read_pin parallel)"
fi
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

schedule_anchor_file() {
  printf '%s\n' "$AGENT_DIR/schedule-anchor-$JOB_NAME-$ACCOUNT_SLUG"
}

scheduler_last_fired_file() {
  printf '%s\n' "$JOB_TMP_DIR/last-fired-expected-at"
}

timeout_seconds_for_job() {
  _interval="${1:-60}"
  _job="${2:-$JOB_NAME}"
  case "$_interval" in
    ''|*[!0-9]*|0) _interval="60" ;;
  esac
  _policy_file="$AGENT_DIR/local-agent-timeouts.json"
  if [ -r "$_policy_file" ] && command -v node >/dev/null 2>&1; then
    _computed="$(
      node - "$_policy_file" "$_interval" "$_job" <<'NODE' 2>/dev/null
const fs = require("fs");
const [policyPath, intervalArg, job] = process.argv.slice(2);
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const interval = Number(intervalArg);
const safeInterval = Number.isFinite(interval) && interval > 0
  ? interval
  : Number(policy.defaultIntervalMinutes || 60);
const multiplier = Number(policy.baseMultiplierSecondsPerMinute || 48);
const min = Number(policy.minSeconds || 1200);
const defaultMax = Number(policy.defaultMaxSeconds || 2700);
const jobMax = policy.jobMaxSeconds && Number(policy.jobMaxSeconds[job]);
const max = Number.isFinite(jobMax) && jobMax > 0 ? jobMax : defaultMax;
console.log(String(Math.min(max, Math.max(min, safeInterval * multiplier))));
NODE
    )"
    case "$_computed" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$_computed"; return 0 ;;
    esac
  fi
  # Compatibility fallback for older installs if the downloaded policy file is
  # missing or unreadable. Normal runs use local-agent-timeouts.json above.
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

job_timeout_seconds() {
  _override="${BUILDER_BLOG_AGENT_TIMEOUT_SECONDS:-}"
  case "$_override" in
    ''|*[!0-9]*|0)
      _timeout_interval="$RESOLVED_INTERVAL_MINUTES"
      _timeout_job="$JOB_NAME"
      case "$JOB_NAME" in
        library-once)
          _timeout_interval="720"
          _timeout_job="library-cron"
          ;;
        digest-once)
          _timeout_interval="720"
          _timeout_job="digest-cron"
          ;;
      esac
      timeout_seconds_for_job "$_timeout_interval" "$_timeout_job"
      ;;
    *) printf '%s\n' "$_override" ;;
  esac
}

shard_timeout_seconds() {
  _whole="${1:-$(job_timeout_seconds)}"
  case "$_whole" in
    ''|*[!0-9]*|0) _whole="$(job_timeout_seconds)" ;;
  esac
  _policy_file="$AGENT_DIR/local-agent-timeouts.json"
  if [ -r "$_policy_file" ] && command -v node >/dev/null 2>&1; then
    _computed="$(
      node - "$_policy_file" "$_whole" <<'NODE' 2>/dev/null
const fs = require("fs");
const [policyPath, wholeArg] = process.argv.slice(2);
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const whole = Number(wholeArg);
const fraction = policy.shardFraction || {};
const numerator = Number(fraction.numerator || 3);
const denominator = Number(fraction.denominator || 4);
console.log(String(Math.floor((whole * numerator) / denominator)));
NODE
    )"
    case "$_computed" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$_computed"; return 0 ;;
    esac
  fi
  printf '%s\n' "$(( _whole * 3 / 4 ))"
}

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

job_run_update() {
  if [ "${BUILDER_BLOG_DISABLE_WEB_SYNC:-}" = "1" ]; then return 0; fi
  _status="$1"
  _summary="${2:-}"
  _reason="${3:-}"
  shift 3 2>/dev/null || true
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
    --reason "$_reason" \
    "$@" >/dev/null 2>&1 || true
}

verify_followbrief_pid() {
  _pid="${1:-}"
  [ -n "$_pid" ] || return 1
  kill -0 "$_pid" 2>/dev/null || return 1
  _args="$(ps -p "$_pid" -o command= 2>/dev/null || true)"
  printf '%s' "$_args" | grep -q "BUILDER_BLOG_WORKER_MODE=1\|builder-agent-runner.sh\|codex exec\|claude -p\|hermes chat\|openclaw" || return 1
}

process_tree_pids() {
  ptp_root="${1:-}"
  [ -n "$ptp_root" ] || return 0
  ptp_queue="$ptp_root"
  ptp_seen=""
  while [ -n "$ptp_queue" ]; do
    ptp_next=""
    for ptp_pid in $ptp_queue; do
      case " $ptp_seen " in
        *" $ptp_pid "*) continue ;;
      esac
      ptp_seen="$ptp_seen $ptp_pid"
      printf '%s\n' "$ptp_pid"
      ptp_children="$(pgrep -P "$ptp_pid" 2>/dev/null || true)"
      [ -z "$ptp_children" ] || ptp_next="$ptp_next $ptp_children"
    done
    ptp_queue="$ptp_next"
  done
}

terminate_process_tree() {
  tpt_root="${1:-}"
  tpt_signal="${2:-TERM}"
  tpt_wait_seconds="${3:-30}"
  [ -n "$tpt_root" ] || return 0
  kill -0 "$tpt_root" 2>/dev/null || return 0

  # Shell variables are global in /bin/sh. Avoid recursive state here: a
  # recursive terminator can clobber the parent pid and leave the wrapper shell
  # alive, which keeps launchd from starting the next scheduled run.
  tpt_targets="$(process_tree_pids "$tpt_root" | awk 'NF { lines[++n]=$1 } END { for (i=n; i>=1; i--) print lines[i] }')"
  for tpt_pid in $tpt_targets; do
    kill -s "$tpt_signal" "$tpt_pid" 2>/dev/null || true
  done

  tpt_left="$tpt_wait_seconds"
  while [ "$tpt_left" -gt 0 ]; do
    tpt_alive=0
    for tpt_pid in $tpt_targets; do
      if kill -0 "$tpt_pid" 2>/dev/null; then
        tpt_alive=1
        break
      fi
    done
    [ "$tpt_alive" -eq 0 ] && return 0
    sleep 1
    tpt_left=$(( tpt_left - 1 ))
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

reconcile_current_file() {
  _file="$1"
  [ -r "$_file" ] || return 0
  _old_pid="$(json_get_number workerPid "$_file")"
  _old_instance="$(json_get_string instanceId "$_file")"
  _old_started="$(json_get_string startedAt "$_file")"
  _old_expected="$(json_get_string expectedAt "$_file")"
  if [ -n "$_old_pid" ] && verify_followbrief_pid "$_old_pid"; then
    return 0
  fi
  if [ -n "$_old_instance" ]; then
    job_run_update_for_instance "$_old_instance" "$_old_started" "$_old_expected" \
      stale "Recorded worker exited before reporting a terminal state." "stale_pid_after_scheduler_tick"
    clear_current_file "$_file" "$_old_instance"
  fi
}

due_expected_at() {
  _anchor_file="$(schedule_anchor_file)"
  _interval_seconds=$(( RESOLVED_INTERVAL_MINUTES * 60 ))
  if [ "$_interval_seconds" -le 0 ]; then _interval_seconds=3600; fi

  if [ ! -s "$_anchor_file" ]; then
    iso_now > "$_anchor_file"
    return 1
  fi

  node - "$_anchor_file" "$_interval_seconds" <<'NODE'
const fs = require("fs");
const [anchorFile, intervalArg] = process.argv.slice(2);
const intervalSeconds = Number(intervalArg);
const anchorText = fs.readFileSync(anchorFile, "utf8").trim();
const anchorMs = Date.parse(anchorText);
const nowMs = Date.now();
if (!Number.isFinite(anchorMs) || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) process.exit(1);
const intervalMs = intervalSeconds * 1000;
// launchd/crontab cannot schedule seconds, but the anchor is precise to a
// second. Allow the generated minute-level schedule to fire slightly before the
// exact anchor+N*interval timestamp while preserving that exact expectedAt.
const toleranceMs = Math.min(5 * 60 * 1000, Math.max(0, intervalMs / 4));
const elapsed = nowMs - anchorMs;
if (elapsed + toleranceMs < intervalMs) process.exit(1);
const slotIndex = Math.floor((elapsed + toleranceMs) / intervalMs);
console.log(new Date(anchorMs + slotIndex * intervalMs).toISOString().replace(/\.\d{3}Z$/, "Z"));
NODE
}

job_run_update_for_instance() {
  _target_instance="$1"
  _target_started="$2"
  _target_expected="$3"
  shift 3

  _saved_instance="${BUILDER_BLOG_JOB_RUN_ID:-}"
  _saved_started="${BUILDER_BLOG_JOB_STARTED_AT:-}"
  _saved_expected="${BUILDER_BLOG_EXPECTED_AT:-}"

  BUILDER_BLOG_JOB_RUN_ID="$_target_instance"
  if [ -n "$_target_started" ]; then
    BUILDER_BLOG_JOB_STARTED_AT="$_target_started"
  fi
  if [ -n "$_target_expected" ]; then
    BUILDER_BLOG_EXPECTED_AT="$_target_expected"
  elif [ -n "$_target_started" ]; then
    BUILDER_BLOG_EXPECTED_AT="$_target_started"
  fi
  export BUILDER_BLOG_JOB_RUN_ID BUILDER_BLOG_JOB_STARTED_AT BUILDER_BLOG_EXPECTED_AT

  job_run_update "$@"

  BUILDER_BLOG_JOB_RUN_ID="$_saved_instance"
  BUILDER_BLOG_JOB_STARTED_AT="$_saved_started"
  BUILDER_BLOG_EXPECTED_AT="$_saved_expected"
  export BUILDER_BLOG_JOB_RUN_ID BUILDER_BLOG_JOB_STARTED_AT BUILDER_BLOG_EXPECTED_AT
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
    OLD_STARTED="$(json_get_string startedAt "$CURRENT_FILE")"
    OLD_EXPECTED="$(json_get_string expectedAt "$CURRENT_FILE")"
    if [ -n "$OLD_PID" ] && verify_followbrief_pid "$OLD_PID"; then
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        replaced "Replaced by a newer scheduled run." "status replaced next_schedule_arrived"
      if ! terminate_process_tree "$OLD_PID" TERM 30; then
        terminate_process_tree "$OLD_PID" KILL 3 || true
        job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
          killed "Previous run was force-killed before the new schedule." "status killed next_schedule_arrived"
      fi
    elif [ -n "$OLD_INSTANCE" ]; then
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        stale "Previous run pid was no longer alive." "stale_pid"
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

run_cron_scheduler_tick() {
  CURRENT_FILE="$JOB_TMP_DIR/current.json"
  EXPECTED_AT="$(due_expected_at || true)"
  if [ -z "$EXPECTED_AT" ]; then
    return 0
  fi

  LAST_FIRED_FILE="$(scheduler_last_fired_file)"
  if [ -r "$LAST_FIRED_FILE" ] && [ "$(cat "$LAST_FIRED_FILE" 2>/dev/null || true)" = "$EXPECTED_AT" ]; then
    reconcile_current_file "$CURRENT_FILE"
    return 0
  fi

  INSTANCE_STAMP="$(printf '%s' "$EXPECTED_AT" | tr -d ':-' | sed 's/Z$//')"
  INSTANCE_ID="${INSTANCE_STAMP}-$$"
  STARTED_AT="$(iso_now)"
  export BUILDER_BLOG_JOB_RUN_ID="$INSTANCE_ID"
  export BUILDER_BLOG_JOB_TRIGGER="scheduled"
  export BUILDER_BLOG_SCHEDULE_JOB="$JOB_NAME"
  export BUILDER_BLOG_EXPECTED_AT="$EXPECTED_AT"
  export BUILDER_BLOG_JOB_STARTED_AT="$STARTED_AT"
  export BUILDER_BLOG_RUNNER_PID="$$"

  if [ -r "$CURRENT_FILE" ]; then
    OLD_PID="$(json_get_number workerPid "$CURRENT_FILE")"
    OLD_INSTANCE="$(json_get_string instanceId "$CURRENT_FILE")"
    OLD_STARTED="$(json_get_string startedAt "$CURRENT_FILE")"
    OLD_EXPECTED="$(json_get_string expectedAt "$CURRENT_FILE")"
    if [ -n "$OLD_PID" ] && verify_followbrief_pid "$OLD_PID"; then
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        replaced "Replaced by a newer scheduled run." "status replaced next_schedule_arrived"
      if ! terminate_process_tree "$OLD_PID" TERM 30; then
        terminate_process_tree "$OLD_PID" KILL 3 || true
        job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
          killed "Previous run was force-killed before the new schedule." "status killed next_schedule_arrived"
      fi
    elif [ -n "$OLD_INSTANCE" ]; then
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        stale "Previous scheduled worker exited before reporting a terminal state." "stale_pid_next_schedule_arrived"
      clear_current_file "$CURRENT_FILE" "$OLD_INSTANCE"
    fi
  fi

  self_update_and_reexec "$JOB_NAME"
  job_run_update starting "Scheduled window accepted by local scheduler tick." "scheduler_tick_due"
  if ! ( set -e; refresh_skill_files ); then
    printf '%s\n' "$EXPECTED_AT" > "$LAST_FIRED_FILE"
    job_run_update failed "Scheduled worker bootstrap failed before fetch started." "worker_bootstrap_failed"
    return 1
  fi
  if [ ! -f "$PROMPT_FILE" ]; then
    printf '%s\n' "$EXPECTED_AT" > "$LAST_FIRED_FILE"
    job_run_update failed "Scheduled worker prompt was missing after bootstrap refresh." "worker_prompt_missing"
    return 66
  fi

  WORKER_PID="$$"
  write_current_file "$CURRENT_FILE" "$INSTANCE_ID" "$WORKER_PID" "$STARTED_AT" "$EXPECTED_AT"
  printf '%s\n' "$EXPECTED_AT" > "$LAST_FIRED_FILE"
  job_run_update running "Scheduled worker running in launchd foreground." "worker_started"
  echo "Running scheduled window $EXPECTED_AT as pid $WORKER_PID."

  BUILDER_BLOG_SCHEDULER_TICK=0
  BUILDER_BLOG_WORKER_MODE=1
  BUILDER_BLOG_JOB_TRIGGER=scheduled
  BUILDER_BLOG_SCHEDULE_JOB="$JOB_NAME"
  BUILDER_BLOG_JOB_RUN_ID="$INSTANCE_ID"
  BUILDER_BLOG_EXPECTED_AT="$EXPECTED_AT"
  BUILDER_BLOG_JOB_STARTED_AT="$STARTED_AT"
  BUILDER_BLOG_CURRENT_FILE="$CURRENT_FILE"
  BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1
  BUILDER_BLOG_RUNNER_UPDATED=1
  unset BUILDER_BLOG_RUNNER_PID
  export BUILDER_BLOG_SCHEDULER_TICK BUILDER_BLOG_WORKER_MODE BUILDER_BLOG_JOB_TRIGGER
  export BUILDER_BLOG_SCHEDULE_JOB BUILDER_BLOG_JOB_RUN_ID BUILDER_BLOG_EXPECTED_AT
  export BUILDER_BLOG_JOB_STARTED_AT BUILDER_BLOG_CURRENT_FILE
  export BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH BUILDER_BLOG_RUNNER_UPDATED
  exec "$0" "$JOB_NAME"
}

run_cron_worker() {
  run_with_job_tracking "${BUILDER_BLOG_JOB_TRIGGER:-scheduled}"
}

run_one_time_with_lock() {
  INSTANCE_ID="${BUILDER_BLOG_JOB_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
  STARTED_AT="${BUILDER_BLOG_JOB_STARTED_AT:-$(iso_now)}"
  EXPECTED_AT="${BUILDER_BLOG_EXPECTED_AT:-$STARTED_AT}"
  CURRENT_FILE="$JOB_TMP_DIR/current.json"

  if [ -r "$CURRENT_FILE" ]; then
    OLD_PID="$(json_get_number workerPid "$CURRENT_FILE")"
    OLD_INSTANCE="$(json_get_string instanceId "$CURRENT_FILE")"
    OLD_STARTED="$(json_get_string startedAt "$CURRENT_FILE")"
    OLD_EXPECTED="$(json_get_string expectedAt "$CURRENT_FILE")"
    if [ -n "$OLD_PID" ] && verify_followbrief_pid "$OLD_PID"; then
      if [ "${BUILDER_BLOG_REPLACE_ACTIVE_ONETIME:-0}" != "1" ]; then
        echo "A one-time FollowBrief $JOB_NAME run is already active for ${BUILDER_BLOG_ACCOUNT:-default}." >&2
        echo "Active pid: $OLD_PID${OLD_INSTANCE:+ · instance: $OLD_INSTANCE}" >&2
        echo "Wait for it to finish, or re-run this one-time command with BUILDER_BLOG_REPLACE_ACTIVE_ONETIME=1 to replace it." >&2
        return 75
      fi

      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        replaced "Replaced by a newer one-time run." "status replaced one_time_replace_requested"
      if ! terminate_process_tree "$OLD_PID" TERM 30; then
        terminate_process_tree "$OLD_PID" KILL 3 || true
        if verify_followbrief_pid "$OLD_PID"; then
          job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
            killed "Previous one-time run could not be stopped before replacement." "status killed one_time_replace_failed"
          echo "Previous one-time FollowBrief $JOB_NAME run is still active after forced termination; not starting a second run." >&2
          return 75
        fi
        job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
          killed "Previous one-time run was force-killed before replacement." "status killed one_time_replace_requested"
      fi
      clear_current_file "$CURRENT_FILE" "$OLD_INSTANCE"
    elif [ -n "$OLD_INSTANCE" ]; then
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        stale "Previous one-time run pid was no longer alive." "stale_pid_one_time"
      clear_current_file "$CURRENT_FILE" "$OLD_INSTANCE"
    fi
  fi

  export BUILDER_BLOG_JOB_RUN_ID="$INSTANCE_ID"
  export BUILDER_BLOG_JOB_STARTED_AT="$STARTED_AT"
  export BUILDER_BLOG_EXPECTED_AT="$EXPECTED_AT"
  export BUILDER_BLOG_CURRENT_FILE="$CURRENT_FILE"
  export BUILDER_BLOG_WORKER_PID="$$"
  export BUILDER_BLOG_RUNNER_PID="${BUILDER_BLOG_RUNNER_PID:-$$}"
  write_current_file "$CURRENT_FILE" "$INSTANCE_ID" "$BUILDER_BLOG_WORKER_PID" "$STARTED_AT" "$EXPECTED_AT"

  set +e
  run_with_job_tracking one_time
  _code="$?"
  set -e
  clear_current_file "$CURRENT_FILE" "$INSTANCE_ID"
  return "$_code"
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

  job_run_update starting "Runtime job accepted by local runner." "runtime_job_started"
  _timeout="$(job_timeout_seconds)"
  job_run_update running "Runtime agent started." "runtime_agent_started"
  run_job_payload &
  RUNTIME_PID="$!"
  _elapsed=0
  _status="succeeded"
  while kill -0 "$RUNTIME_PID" 2>/dev/null; do
    if [ "$_elapsed" -ge "$_timeout" ]; then
      _status="timed_out"
      job_run_update timed_out "Runtime exceeded timeout and will be terminated." "timeout_seconds_for_job" \
        --timeout-seconds "$_timeout" \
        --timeout-stage "runtime" \
        --timed-out-worker-pid "$RUNTIME_PID" \
        --termination "terminating"
      if terminate_process_tree "$RUNTIME_PID" TERM 30 || terminate_process_tree "$RUNTIME_PID" KILL 3; then
        _termination="terminated"
        wait "$RUNTIME_PID" 2>/dev/null || true
      else
        _termination="still_alive_after_kill"
        echo "Runtime pid $RUNTIME_PID was still alive after forced termination; continuing without waiting." >&2
      fi
      job_run_update timed_out "Runtime timed out." "timeout_seconds_for_job" \
        --timeout-seconds "$_timeout" \
        --timeout-stage "runtime" \
        --timed-out-worker-pid "$RUNTIME_PID" \
        --termination "$_termination"
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
    if [ "$JOB_NAME" = "digest-once" ] || [ "$JOB_NAME" = "digest-cron" ]; then
      _digest_final_context="$JOB_TMP_DIR/builder-blog-context.json"
      _digest_final_count=""
      if [ -s "$_digest_final_context" ]; then
        _digest_final_count="$(digest_context_item_count "$_digest_final_context" 2>/dev/null || true)"
      fi
      if [ "$_digest_final_count" = "0" ]; then
        job_run_update succeeded "No update. Prepared 0 candidates." "no_update" \
          --stage "no_update"
      else
        job_run_update succeeded "Runtime completed successfully." "runtime_finished"
      fi
    else
      job_run_update succeeded "Runtime completed successfully." "runtime_finished"
    fi
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
    # One-time run with an explicit per-run or one-time/global pinned runtime.
    # Interactive permission gates are kept (the user is at a TTY). A missing
    # binary falls back to the discovery chain rather than failing the run.
    case "$PINNED_RUNTIME" in
      claude|codex|hermes|openclaw)
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
      hermes)
        command -v hermes >/dev/null 2>&1 || { echo "Pinned runtime 'hermes' not on PATH for cron." >&2; exit 78; }
        run_with_hermes_unattended
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
    elif command -v hermes >/dev/null 2>&1; then
      run_with_hermes
    elif { [ "$JOB_NAME" = "library-cron" ] || [ "$JOB_NAME" = "library-once" ]; } && [ -z "${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-}" ]; then
      run_shell_library_fallback
    elif [ "$JOB_NAME" = "library-cron" ] || [ "$JOB_NAME" = "library-once" ]; then
      echo "No local agent runtime found for FollowBrief library ${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-agent} work." >&2
      echo "Install/configure Codex, Claude Code, OpenClaw, Hermes, or set BUILDER_BLOG_AGENT_COMMAND." >&2
      exit 78
    else
      echo "No local agent runtime found for FollowBrief digest generation." >&2
      echo "Install/configure Codex, Claude Code, OpenClaw, Hermes, or set BUILDER_BLOG_AGENT_COMMAND." >&2
      echo "Digest cron requires an agent because it must summarize returned items with AI before sync." >&2
      exit 78
    fi
  fi
}

# The job payload run inside the supervised/tracked worker. Digest and library
# jobs are runner-owned: deterministic CLI steps stay here, while local agents
# only handle the model/browser work. The runtime smoke check never goes
# through here — it calls run_selected_runtime directly.
run_job_payload() {
  case "$JOB_NAME" in
    digest-once|digest-cron)
      run_digest_job
      return "$?"
      ;;
    library-once|library-cron)
      run_library_job
      return "$?"
      ;;
  esac
  run_selected_runtime
}

payload_prompt_file() {
  case "$JOB_NAME" in
    digest-once) printf '%s\n' "$AGENT_DIR/jobs/digest-cron.md" ;;
    *) printf '%s\n' "$AGENT_DIR/jobs/$JOB_NAME.md" ;;
  esac
}

digest_context_item_count() {
  _dcic_file="$1"
  node - "$_dcic_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const context = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(Array.isArray(context.items) ? context.items.length : 0);
NODE
}

library_fetch_task_count() {
  _lftc_file="$1"
  node - "$_lftc_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const result = JSON.parse(fs.readFileSync(file, "utf8"));
const tasks = Array.isArray(result.fetchTasks) ? result.fetchTasks : [];
console.log(tasks.filter((task) => task?.agentWorkType !== "candidate_discovery_fallback").length);
NODE
}

library_has_discovery_tasks() {
  _lhdt_file="$1"
  node - "$_lhdt_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const result = JSON.parse(fs.readFileSync(file, "utf8"));
const tasks = Array.isArray(result.fetchTasks) ? result.fetchTasks : [];
process.exit(tasks.some((task) => task && task.agentWorkType === "candidate_discovery_fallback") ? 0 : 1);
NODE
}

run_openclaw_library_preflight() {
  [ "$PINNED_RUNTIME" = "openclaw" ] || return 0

  _olp_prompt="$JOB_TMP_DIR/library-openclaw-preflight.md"
  cat > "$_olp_prompt" <<EOF
You are validating the FollowBrief OpenClaw runtime before source fetch workers start.

Do not run FollowBrief fetch, digest, sync, cron-status, setup, or web browsing commands.
Return exactly one JSON object and stop:

{"followbriefRuntimePreflight":"ok","runtimeReady":true}
EOF

  _olp_previous_prompt="$PROMPT_FILE"
  _olp_previous_stage="${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-}"
  _olp_previous_is_cron="$IS_CRON_JOB"
  _olp_previous_session="${OPENCLAW_SESSION_ID:-}"
  _olp_previous_timeout="${_timeout:-}"

  PROMPT_FILE="$_olp_prompt"
  BUILDER_BLOG_LIBRARY_AGENT_STAGE=runtime_preflight
  IS_CRON_JOB=1
  OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-preflight' "$ACCOUNT_SLUG" "$JOB_NAME" "${BUILDER_BLOG_JOB_RUN_ID:-$$}" | tr -c 'a-zA-Z0-9_.@+-' '_')"
  _timeout="${BUILDER_BLOG_OPENCLAW_PREFLIGHT_TIMEOUT_SECONDS:-120}"
  export BUILDER_BLOG_LIBRARY_AGENT_STAGE OPENCLAW_SESSION_ID

  echo "Running OpenClaw runtime preflight before FollowBrief fetch workers."
  LAST_AGENT_OUTPUT_FILE=""
  set +e
  run_selected_runtime
  _olp_code="$?"
  set -e

  PROMPT_FILE="$_olp_previous_prompt"
  IS_CRON_JOB="$_olp_previous_is_cron"
  if [ -n "$_olp_previous_stage" ]; then
    BUILDER_BLOG_LIBRARY_AGENT_STAGE="$_olp_previous_stage"
    export BUILDER_BLOG_LIBRARY_AGENT_STAGE
  else
    unset BUILDER_BLOG_LIBRARY_AGENT_STAGE
  fi
  if [ -n "$_olp_previous_session" ]; then
    OPENCLAW_SESSION_ID="$_olp_previous_session"
    export OPENCLAW_SESSION_ID
  else
    unset OPENCLAW_SESSION_ID
  fi
  if [ -n "$_olp_previous_timeout" ]; then
    _timeout="$_olp_previous_timeout"
  else
    unset _timeout
  fi

  if [ "$_olp_code" -eq 0 ] && agent_output_has_openclaw_preflight_marker "${LAST_AGENT_OUTPUT_FILE:-}"; then
    return 0
  fi

  if [ "$_olp_code" -eq 124 ]; then
    job_run_update timed_out "OpenClaw preflight timed out before fetch workers started." "runtime_preflight_timeout" \
      --stage "runtime_preflight" \
      --timeout-seconds "${BUILDER_BLOG_OPENCLAW_PREFLIGHT_TIMEOUT_SECONDS:-120}" \
      --timeout-stage "runtime_preflight"
    return 124
  fi

  if agent_output_has_openclaw_auth_failure "${LAST_AGENT_OUTPUT_FILE:-}"; then
    _openclaw_provider_error="$(openclaw_auth_failure_summary "${LAST_AGENT_OUTPUT_FILE:-}")"
    echo "OpenClaw auth failed before fetch workers started." >&2
    job_run_update failed "OpenClaw auth failed before fetch workers started." "runtime_auth_failed" \
      --stage "runtime_preflight" \
      --exit-code "$_olp_code" \
      --provider-error "$_openclaw_provider_error"
    return 78
  fi

  echo "OpenClaw preflight failed before fetch workers started." >&2
  job_run_update failed "OpenClaw preflight failed before fetch workers started." "runtime_preflight_failed" \
    --stage "runtime_preflight" \
    --exit-code "$_olp_code"
  return 78
}

run_digest_job() {
  PROMPT_FILE="$(payload_prompt_file)"
  _context_file="$JOB_TMP_DIR/builder-blog-context.json"
  _agent_output_file="$JOB_TMP_DIR/builder-blog-digest-agent-output.json"
  _digest_file="$JOB_TMP_DIR/builder-blog-digest.json"
  _headlines_file="$JOB_TMP_DIR/builder-blog-digest-headlines.txt"
  _sync_result_file="$JOB_TMP_DIR/builder-blog-digest-sync-result.json"
  rm -f \
    "$_context_file" \
    "$_agent_output_file" \
    "$_digest_file" \
    "$_headlines_file" \
    "$_sync_result_file"

  job_run_update running "Preparing digest candidates." "prepare_started" --stage "prepare_candidates"
  _prepare_stderr="$JOB_TMP_DIR/digest-prepare.err"
  set +e
  BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
  node "$AGENT_DIR/builder-digest.mjs" prepare ${BUILDER_BLOG_DIGEST_REGENERATE:-} \
    > "$_context_file" 2> "$_prepare_stderr"
  _prepare_code="$?"
  set -e
  [ ! -s "$_prepare_stderr" ] || cat "$_prepare_stderr" >&2
  if [ "$_prepare_code" -ne 0 ]; then
    job_run_update failed "Prepare candidates failed." "prepare_failed" \
      --stage "prepare_candidates" \
      --exit-code "$_prepare_code"
    return "$_prepare_code"
  fi

  _item_count="$(digest_context_item_count "$_context_file")" || {
    _count_code="$?"
    job_run_update failed "Prepared digest context could not be read." "prepare_context_invalid" \
      --stage "prepare_candidates" \
      --exit-code "$_count_code"
    return "$_count_code"
  }

  if [ "$_item_count" -eq 0 ]; then
    echo "No AI Digest issues to sync. Prepared 0 candidates."
    job_run_update succeeded "No update. Prepared 0 candidates." "no_update" \
      --stage "no_update"
    return 0
  fi

  job_run_update running "Generating digest summary JSON for $_item_count candidates." "agent_started" \
    --stage "run_local_agent"
  export BUILDER_BLOG_DIGEST_AGENT_ONLY=1
  _digest_original_prompt="$PROMPT_FILE"
  _digest_base_prompt="$(digest_agent_prompt_file "$_digest_original_prompt" "$_context_file" "$_agent_output_file" "$_item_count")"
  PROMPT_FILE="$_digest_base_prompt"
  if [ "$PINNED_RUNTIME" = "openclaw" ]; then
    PROMPT_FILE="$(openclaw_digest_prompt_file "$_digest_base_prompt" "$_context_file" "$_agent_output_file")"
  fi
  run_selected_runtime
  _agent_code="$?"
  PROMPT_FILE="$_digest_original_prompt"
  unset BUILDER_BLOG_DIGEST_AGENT_ONLY
  if [ "$_agent_code" -ne 0 ]; then
    _agent_provider_error="$(agent_runtime_failure_summary "${LAST_AGENT_OUTPUT_FILE:-}")"
    job_run_update failed "Local agent failed to write digest summary JSON." "agent_failed" \
      --stage "run_local_agent" \
      --exit-code "$_agent_code" \
      --provider-error "$_agent_provider_error"
    return "$_agent_code"
  fi

  job_run_update running "Rendering digest JSON." "render_started" --stage "render_digest_json"
  _render_stderr="$JOB_TMP_DIR/digest-render.err"
  set +e
  node "$AGENT_DIR/builder-digest.mjs" render-digest \
    --context "$_context_file" \
    --agent-output "$_agent_output_file" \
    --out "$_digest_file" \
    --summary-out "$_headlines_file" > "$JOB_TMP_DIR/digest-render.out" 2> "$_render_stderr"
  _render_code="$?"
  set -e
  [ ! -s "$JOB_TMP_DIR/digest-render.out" ] || cat "$JOB_TMP_DIR/digest-render.out"
  [ ! -s "$_render_stderr" ] || cat "$_render_stderr" >&2
  if [ "$_render_code" -ne 0 ]; then
    job_run_update failed "Render digest JSON failed." "render_failed" \
      --stage "render_digest_json" \
      --exit-code "$_render_code"
    return "$_render_code"
  fi

  job_run_update running "Saving digest to FollowBrief." "sync_started" --stage "save_to_followbrief"
  _sync_stderr="$JOB_TMP_DIR/digest-sync.err"
  set +e
  BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
  node "$AGENT_DIR/builder-digest.mjs" sync \
    --file "$_digest_file" \
    --summary-file "$_headlines_file" \
    --context "$_context_file" \
    --title "AI Builder Digest" ${BUILDER_BLOG_DIGEST_REGENERATE:-} \
    > "$_sync_result_file" 2> "$_sync_stderr"
  _sync_code="$?"
  set -e
  [ ! -s "$_sync_result_file" ] || cat "$_sync_result_file"
  [ ! -s "$_sync_stderr" ] || cat "$_sync_stderr" >&2
  if [ "$_sync_code" -ne 0 ]; then
    job_run_update failed "Save to FollowBrief failed." "sync_failed" \
      --stage "save_to_followbrief" \
      --exit-code "$_sync_code"
    return "$_sync_code"
  fi

  digest_output_completed "$_sync_result_file"
}

# Library run: the runner owns every deterministic step (fetch, discovery
# expansion, shard, merge, validate, sync) and runtime agents only do the
# genuinely agentic work — a discovery pre-pass when the fetch result contains
# candidate-discovery tasks, then one worker per shard completing that shard's
# fetchTasks. Workers write per-shard result files; merge-task-results assembles
# the single sync payload and backfills a failed taskOutcome for any task a
# worker never reported (crash/timeout), so the "every task ends in a terminal
# state" validation contract holds even with partial worker failure.
sync_payload_slices() {
  _sps_tasks_file="$1"
  _sps_payload_file="$2"
  _sps_slices_dir="$3"
  _sps_label="${4:-library result}"
  _sps_sync_args="${5:-}"

  node "$AGENT_DIR/builder-digest.mjs" split-sync-slices \
    --tasks "$_sps_tasks_file" \
    --file "$_sps_payload_file" \
    --out-dir "$_sps_slices_dir"

  _sps_failures=0
  for _slice_payload in "$_sps_slices_dir"/slice-*-payload.json; do
    [ -e "$_slice_payload" ] || continue
    _slice_tasks="${_slice_payload%-payload.json}-tasks.json"
    _slice_name="$(basename "$_slice_payload" .json)"
    _slice_stdout="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-sync.out"
    _slice_stderr="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-sync.err"
    echo "Syncing $_sps_label slice $_slice_name."
    set +e
    node "$AGENT_DIR/builder-digest.mjs" sync-builders \
      --file "$_slice_payload" \
      --tasks "$_slice_tasks" \
      $_sps_sync_args > "$_slice_stdout" 2> "$_slice_stderr"
    _slice_code="$?"
    set -e
    [ ! -s "$_slice_stdout" ] || cat "$_slice_stdout"
    [ ! -s "$_slice_stderr" ] || cat "$_slice_stderr" >&2
    if [ "$_slice_code" -eq 0 ]; then
      continue
    fi

    _sps_failures=$(( _sps_failures + 1 ))
    echo "sync-builders failed for $_sps_label $_slice_name (exit $_slice_code); marking only this slice failed." >&2
    _failed_payload="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-failed-payload.json"
    node "$AGENT_DIR/builder-digest.mjs" fail-sync-slice \
      --tasks "$_slice_tasks" \
      --out "$_failed_payload" \
      --reason "slice_sync_failed" \
      --message "sync-builders failed for $_sps_label $_slice_name with exit $_slice_code"

    _failed_stdout="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-failed-sync.out"
    _failed_stderr="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-failed-sync.err"
    set +e
    node "$AGENT_DIR/builder-digest.mjs" sync-builders \
      --file "$_failed_payload" \
      --tasks "$_slice_tasks" \
      $_sps_sync_args > "$_failed_stdout" 2> "$_failed_stderr"
    _failed_code="$?"
    set -e
    [ ! -s "$_failed_stdout" ] || cat "$_failed_stdout"
    [ ! -s "$_failed_stderr" ] || cat "$_failed_stderr" >&2
    if [ "$_failed_code" -ne 0 ]; then
      echo "Failed to patch failed outcomes for $_sps_label $_slice_name (exit $_failed_code)." >&2
    fi
  done

  [ "$_sps_failures" -eq 0 ]
}

sync_completed_checkpoints() {
  _scc_result_file="$1"
  _scc_results_dir="$2"
  _scc_synced_ids_file="$3"
  _scc_work_dir="$JOB_TMP_DIR/completed-checkpoint-sync"
  rm -rf "$_scc_work_dir"
  mkdir -p "$_scc_work_dir"

  _scc_payload="$_scc_work_dir/library-agent-sync.json"
  _scc_tasks="$_scc_work_dir/library-fetch-result.json"
  _scc_ids="$_scc_work_dir/task-ids.txt"
  _scc_merge="$_scc_work_dir/merge-task-results.json"
  node "$AGENT_DIR/builder-digest.mjs" merge-task-results \
    --completed-only \
    --tasks "$_scc_result_file" \
    --results-dir "$_scc_results_dir" \
    --exclude-task-ids-file "$_scc_synced_ids_file" \
    --tasks-out "$_scc_tasks" \
    --ids-out "$_scc_ids" \
    --out "$_scc_payload" > "$_scc_merge"

  _scc_count="$(wc -l < "$_scc_ids" | tr -d ' ')"
  if [ "${_scc_count:-0}" -eq 0 ]; then
    return 0
  fi

  echo "Best-effort syncing $_scc_count completed library task(s) before the full run finishes."
  cat "$_scc_merge"

  _scc_validate="$_scc_work_dir/validate-agent-sync-result.json"
  set +e
  node "$AGENT_DIR/builder-digest.mjs" validate-agent-sync \
    --tasks "$_scc_tasks" \
    --file "$_scc_payload" > "$_scc_validate" 2>&1
  _scc_validate_code="$?"
  set -e
  cat "$_scc_validate"
  if [ "$_scc_validate_code" -ne 0 ] || ! grep -q '"status": "ok"' "$_scc_validate"; then
    echo "Completed checkpoint partial payload did not validate; leaving it for final merge." >&2
    return 0
  fi

  if sync_payload_slices "$_scc_tasks" "$_scc_payload" "$_scc_work_dir/sync-slices" "completed-checkpoint" "--partial-outcomes"; then
    cat "$_scc_ids" >> "$_scc_synced_ids_file"
    sort -u "$_scc_synced_ids_file" > "$_scc_synced_ids_file.tmp"
    mv "$_scc_synced_ids_file.tmp" "$_scc_synced_ids_file"
    return 0
  fi

  echo "Completed checkpoint partial sync failed; leaving it for final merge." >&2
  return 0
}

run_library_job() {
  _shards_dir="$JOB_TMP_DIR/shards"
  _results_dir="$_shards_dir/results"
  rm -rf "$_shards_dir"
  mkdir -p "$_results_dir"
  _result_file="$JOB_TMP_DIR/library-fetch-result.json"

  echo "FollowBrief library run: $MAX_PARALLEL_WORKERS worker(s)."

  run_openclaw_library_preflight || return "$?"

  job_run_update running "Fetching source candidates." "fetch_started" --stage "fetch_sources"
  _fetch_stderr="$JOB_TMP_DIR/library-fetch.err"
  _discovery_failed=0
  set +e
  node "$AGENT_DIR/builder-digest.mjs" fetch-personal \
    --days "${BUILDER_BLOG_FETCH_DAYS:-30}" \
    --limit "${BUILDER_BLOG_FETCH_LIMIT:-3}" \
    ${BUILDER_BLOG_FETCH_FORCE:-} > "$_result_file" 2> "$_fetch_stderr"
  _fetch_code="$?"
  set -e
  [ ! -s "$_fetch_stderr" ] || cat "$_fetch_stderr" >&2
  if [ "$_fetch_code" -ne 0 ]; then
    job_run_update failed "Fetch sources failed." "fetch_failed" \
      --stage "fetch_sources" \
      --exit-code "$_fetch_code"
    return "$_fetch_code"
  fi
  cat "$_result_file"

  if library_has_discovery_tasks "$_result_file"; then
    echo "Discovery entries present; running the discovery agent pre-pass."
    job_run_update running "Expanding source candidate discovery." "discovery_started" --stage "expand_discovery"
    if ! ( if [ "$PINNED_RUNTIME" = "openclaw" ]; then
             OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-discovery' "$ACCOUNT_SLUG" "$JOB_NAME" "$$" | tr -c 'a-zA-Z0-9_.@+-' '_')"
             export OPENCLAW_SESSION_ID
           fi
           PROMPT_FILE="$AGENT_DIR/jobs/library-discovery.md"
           if [ "$PINNED_RUNTIME" = "openclaw" ]; then
             PROMPT_FILE="$(openclaw_discovery_prompt_file "$_result_file" "$JOB_TMP_DIR/library-discovery-result.json")"
           fi
           BUILDER_BLOG_LIBRARY_AGENT_STAGE=discovery
           export BUILDER_BLOG_LIBRARY_AGENT_STAGE
           IS_CRON_JOB=1
           run_selected_runtime ); then
      echo "Discovery pre-pass failed; un-expanded discovery entries will be left out of post-task sync." >&2
      _discovery_failed=1
      job_run_update running "Discovery pre-pass failed; continuing with expanded post tasks available so far." "discovery_agent_failed" \
        --stage "expand_discovery"
    else
      _discovery_result_file="$JOB_TMP_DIR/library-discovery-result.json"
      _expanded_result_file="$JOB_TMP_DIR/library-fetch-expanded.json"
      _expand_stderr="$JOB_TMP_DIR/library-expand-discovery.err"
      set +e
      BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
      node "$AGENT_DIR/builder-digest.mjs" expand-discovery \
        --tasks "$_result_file" \
        --file "$_discovery_result_file" \
        --out "$_expanded_result_file" > "$JOB_TMP_DIR/library-expand-discovery.out" 2> "$_expand_stderr"
      _expand_code="$?"
      set -e
      [ ! -s "$JOB_TMP_DIR/library-expand-discovery.out" ] || cat "$JOB_TMP_DIR/library-expand-discovery.out"
      [ ! -s "$_expand_stderr" ] || cat "$_expand_stderr" >&2
      if [ "$_expand_code" -eq 0 ]; then
        mv "$_expanded_result_file" "$_result_file"
        cat "$_result_file"
      else
        echo "Discovery expansion failed; un-expanded discovery entries will be left out of post-task sync." >&2
        _discovery_failed=1
        job_run_update running "Discovery expansion failed; continuing with original fetch result." "discovery_expand_failed" \
          --stage "expand_discovery" \
          --exit-code "$_expand_code"
      fi
    fi
  fi

  _task_count="$(library_fetch_task_count "$_result_file")" || {
    _count_code="$?"
    job_run_update failed "Fetch result could not be read." "fetch_result_invalid" \
      --stage "fetch_sources" \
      --exit-code "$_count_code"
    return "$_count_code"
  }

  if [ "$_task_count" -eq 0 ]; then
    if [ "$_discovery_failed" -ne 0 ]; then
      echo "Discovery failed before any post tasks could be planned." >&2
      job_run_update failed "Discovery failed before any post tasks could be planned." "discovery_failed" \
        --stage "expand_discovery"
      return 65
    fi
    echo "No source updates to sync. Planned 0 post tasks."
    node "$AGENT_DIR/builder-digest.mjs" patch-fetch-run-plan \
      --tasks "$_result_file" \
      --results-dir "$_results_dir" || true
    job_run_update succeeded "No update. Planned 0 post tasks." "no_update" \
      --stage "no_update"
    return 0
  fi

  job_run_update running "Sharding $_task_count fetch task(s)." "shard_started" --stage "shard_fetch_tasks"
  node "$AGENT_DIR/builder-digest.mjs" shard-tasks \
    --tasks "$_result_file" \
    --out-dir "$_shards_dir" \
    --max-workers "$MAX_PARALLEL_WORKERS"

  node "$AGENT_DIR/builder-digest.mjs" patch-fetch-run-plan \
    --tasks "$_result_file" \
    --results-dir "$_results_dir" || true

  # Per-shard timeout: 3/4 of the whole-job timeout. A hung shard is
  # terminated early enough for merge, failure reporting, and final sync to
  # finish before the outer runner timeout kills the whole run.
  _whole_timeout="$(job_timeout_seconds)"
  _shard_timeout="$(shard_timeout_seconds "$_whole_timeout")"
  _worker_entries=""
  _skip_wait_pids=""
  _timed_out_worker_pids=""
  _checkpoint_synced_ids_file="$JOB_TMP_DIR/completed-checkpoint-synced-task-ids.txt"
  : > "$_checkpoint_synced_ids_file"
  job_run_update running "Running source fetch workers." "workers_started" --stage "run_fetch_workers"
  for _shard_file in "$_shards_dir"/shard-*.json; do
    [ -e "$_shard_file" ] || continue
    _shard_name="$(basename "$_shard_file" .json)"
    _shard_checkpoint_dir="$_results_dir/$_shard_name-checkpoints"
    mkdir -p "$_shard_checkpoint_dir"
    (
      BUILDER_BLOG_SHARD_FILE="$_shard_file"
      BUILDER_BLOG_SHARD_RESULT="$_results_dir/$_shard_name-result.json"
      BUILDER_BLOG_SHARD_CHECKPOINT_DIR="$_shard_checkpoint_dir"
      export BUILDER_BLOG_SHARD_FILE BUILDER_BLOG_SHARD_RESULT BUILDER_BLOG_SHARD_CHECKPOINT_DIR
      if [ "$PINNED_RUNTIME" = "openclaw" ]; then
        OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-%s' "$ACCOUNT_SLUG" "$JOB_NAME" "$$" "$_shard_name" | tr -c 'a-zA-Z0-9_.@+-' '_')"
        export OPENCLAW_SESSION_ID
      fi
      PROMPT_FILE="$AGENT_DIR/jobs/library-worker.md"
      if [ "$PINNED_RUNTIME" = "openclaw" ]; then
        PROMPT_FILE="$(openclaw_worker_prompt_file "$_shard_name" "$BUILDER_BLOG_SHARD_FILE" "$BUILDER_BLOG_SHARD_RESULT" "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR")"
      fi
      BUILDER_BLOG_LIBRARY_AGENT_STAGE=worker
      export BUILDER_BLOG_LIBRARY_AGENT_STAGE
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
        case " $_timed_out_worker_pids " in
          *" $_pid "*) continue ;;
        esac
        if [ $(( _now - _started )) -ge "$_shard_timeout" ]; then
          echo "Worker $_name exceeded ${_shard_timeout}s; terminating it (its tasks will be reported as failed)." >&2
          job_run_update running "Worker $_name exceeded timeout and will be terminated." "worker_shard_timeout" \
            --timeout-seconds "$_shard_timeout" \
            --timeout-stage "worker_shard" \
            --timed-out-worker "$_name" \
            --timed-out-worker-pid "$_pid" \
            --termination "terminating"
          if terminate_process_tree "$_pid" TERM 10 || terminate_process_tree "$_pid" KILL 3; then
            job_run_update running "Worker $_name timed out and was terminated." "worker_shard_timeout" \
              --timeout-seconds "$_shard_timeout" \
              --timeout-stage "worker_shard" \
              --timed-out-worker "$_name" \
              --timed-out-worker-pid "$_pid" \
              --termination "terminated"
          else
            echo "Worker $_name pid $_pid was still alive after forced termination; continuing without waiting." >&2
            _skip_wait_pids="$_skip_wait_pids $_pid"
            job_run_update running "Worker $_name timed out and did not exit after forced termination." "worker_shard_timeout" \
              --timeout-seconds "$_shard_timeout" \
              --timeout-stage "worker_shard" \
              --timed-out-worker "$_name" \
              --timed-out-worker-pid "$_pid" \
              --termination "still_alive_after_kill" \
              --skipped-wait-pids "$_skip_wait_pids"
          fi
          _timed_out_worker_pids="$_timed_out_worker_pids $_pid"
        else
          _alive=$(( _alive + 1 ))
        fi
      fi
    done
    [ "$_alive" -eq 0 ] && break
    node "$AGENT_DIR/builder-digest.mjs" checkpoint-progress \
      --tasks "$_result_file" \
      --results-dir "$_results_dir" \
      --stage "workers_running" >/dev/null 2>&1 || true
    sync_completed_checkpoints "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" || true
    sleep 5
  done
  sync_completed_checkpoints "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" || true
  for _entry in $_worker_entries; do
    _pid="${_entry%%:*}"
    case " $_skip_wait_pids " in
      *" $_pid "*) continue ;;
    esac
    wait "$_pid" 2>/dev/null || true
  done

  for _worker_log in "$_results_dir"/*-worker.log; do
    [ -e "$_worker_log" ] || continue
    echo "--- $(basename "$_worker_log") ---"
    cat "$_worker_log"
  done

  _merge_result_file="$JOB_TMP_DIR/merge-task-results.json"
  job_run_update running "Merging source fetch worker results." "merge_started" --stage "merge_results"
  node "$AGENT_DIR/builder-digest.mjs" merge-task-results \
    --tasks "$_result_file" \
    --results-dir "$_results_dir" \
    --shard-timeout-seconds "$_shard_timeout" \
    --out "$JOB_TMP_DIR/library-agent-sync.json" | tee "$_merge_result_file"
  _merge_issue_count="$(node - "$_merge_result_file" <<'NODE'
const fs = require("fs");
try {
  const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const backfilled = Number(result.backfilledOutcomes || 0);
  const missing = Array.isArray(result.shards)
    ? result.shards.filter((shard) => shard && shard.status !== "ok").length
    : 0;
  console.log(backfilled + missing);
} catch {
  console.log(0);
}
NODE
)"

  # Validate-and-repair loop. The runner validates the merged payload because
  # workers can time out, crash, miss a task, or leave invalid JSON despite the
  # prompt contract. On failure, the runner hands the exact error list to one
  # repair agent that fixes ONLY the failing items in the merged payload, then
  # re-validates. Bounded at 2 rounds so a hopeless payload still fails fast
  # instead of looping.
  # validate-agent-sync exits non-zero when any task fails validation; capture
  # the exit code (instead of letting set -e abort) so the validation details
  # always land in the job log before we refuse to sync.
  _validate_file="$JOB_TMP_DIR/validate-agent-sync-result.json"
  _sync_payload="$JOB_TMP_DIR/library-agent-sync.json"
  _repair_round=0
  job_run_update running "Validating source fetch results." "validate_started" --stage "validate_results"
  while :; do
    set +e
    node "$AGENT_DIR/builder-digest.mjs" validate-agent-sync \
      --tasks "$_result_file" \
      --file "$_sync_payload" > "$_validate_file" 2>&1
    _validate_code="$?"
    set -e
    cat "$_validate_file"
    if [ "$_validate_code" -eq 0 ] && grep -q '"status": "ok"' "$_validate_file"; then
      break
    fi
    if [ "$_repair_round" -ge 2 ]; then
      echo "validate-agent-sync still failing after $_repair_round repair round(s) (exit $_validate_code); not syncing." >&2
      _failed_payload="$JOB_TMP_DIR/validation-failed-payload.json"
      _failed_tasks="$JOB_TMP_DIR/validation-failed-tasks.json"
      node "$AGENT_DIR/builder-digest.mjs" fail-sync-slice \
        --tasks "$_result_file" \
        --tasks-out "$_failed_tasks" \
        --out "$_failed_payload" \
        --exclude-task-ids-file "$_checkpoint_synced_ids_file" \
        --reason "content_validation_failed" \
        --message "validate-agent-sync still failing after $_repair_round repair round(s); marking unfinished tasks failed"
      _failed_stdout="$JOB_TMP_DIR/validation-failed-sync.out"
      _failed_stderr="$JOB_TMP_DIR/validation-failed-sync.err"
      set +e
      node "$AGENT_DIR/builder-digest.mjs" sync-builders \
        --file "$_failed_payload" \
        --tasks "$_failed_tasks" > "$_failed_stdout" 2> "$_failed_stderr"
      _failed_code="$?"
      set -e
      [ ! -s "$_failed_stdout" ] || cat "$_failed_stdout"
      [ ! -s "$_failed_stderr" ] || cat "$_failed_stderr" >&2
      if [ "$_failed_code" -ne 0 ]; then
        echo "Failed to patch validation-failed outcomes (exit $_failed_code)." >&2
      fi
      return 65
    fi
    _repair_round=$(( _repair_round + 1 ))
    echo "validate-agent-sync failed (exit $_validate_code); running repair agent, round $_repair_round of 2."
    REPAIR_PROMPT_FILE="$JOB_TMP_DIR/library-repair-prompt.md"
    cat > "$REPAIR_PROMPT_FILE" <<EOF
Use the FollowBrief skill to repair a merged library sync payload that failed
validation. This is an unattended repair pass. Do not ask the user questions.

Files:
- Validation errors (read first): $_validate_file
- Merged sync payload — fix it IN PLACE at this exact path: $_sync_payload
- Planned fetch tasks with authoritative per-task instructions: $_result_file

Fix ONLY the tasks listed in the validation errors. Do not touch items that
validated, do not add or remove any other items, and keep the payload shape
exactly: builders (each with items) plus taskOutcomes.

Per error type:
- summary_too_long: rewrite that one item's summary to under 1200 characters,
  still following that task's summaryInstructions.prompt.
- content-quality errors (for example description_or_title_is_not_primary_content):
  re-extract real primary content for that task per its fetchInstructions.prompt
  and minimumContentQuality, replace the item body, and re-summarize it. If real
  primary content genuinely cannot be obtained, remove that item and add one
  taskOutcomes entry with fetchTaskId, status (skipped or failed), reason, and
  per-task evidence.
- source retention policy is applied later by sync-builders. During repair,
  keep item.body as the real primary content needed for validation and
  summarization, but do not place raw HTML, raw transcripts, raw API objects, or
  copied source content inside rawJson.
- any other error: resolve it per that task's instructions in the fetch tasks
  file; every planned task must keep exactly one terminal state.

Hard rules: do NOT run validate-agent-sync, sync-builders, fetch-personal, or
expand-discovery; do NOT fetch tasks that are not listed in the errors. Write
the corrected JSON back to the payload path, print one line {"repairDone": true},
and stop.
EOF
    if ! ( PROMPT_FILE="$REPAIR_PROMPT_FILE"
           BUILDER_BLOG_LIBRARY_AGENT_STAGE=repair
           export BUILDER_BLOG_LIBRARY_AGENT_STAGE
           IS_CRON_JOB=1
           run_selected_runtime ); then
      echo "Repair agent round $_repair_round exited non-zero; re-validating anyway." >&2
    fi
  done

  _sync_slices_dir="$JOB_TMP_DIR/sync-slices"
  job_run_update running "Saving fetched posts to FollowBrief." "sync_started" --stage "sync_to_followbrief"
  node "$AGENT_DIR/builder-digest.mjs" split-sync-slices \
    --tasks "$_result_file" \
    --file "$JOB_TMP_DIR/library-agent-sync.json" \
    --out-dir "$_sync_slices_dir"

  _sync_failures=0
  for _slice_payload in "$_sync_slices_dir"/slice-*-payload.json; do
    [ -e "$_slice_payload" ] || continue
    _slice_tasks="${_slice_payload%-payload.json}-tasks.json"
    _slice_name="$(basename "$_slice_payload" .json)"
    _slice_stdout="$JOB_TMP_DIR/${_slice_name}-sync.out"
    _slice_stderr="$JOB_TMP_DIR/${_slice_name}-sync.err"
    echo "Syncing library result slice $_slice_name."
    set +e
    node "$AGENT_DIR/builder-digest.mjs" sync-builders \
      --file "$_slice_payload" \
      --tasks "$_slice_tasks" > "$_slice_stdout" 2> "$_slice_stderr"
    _slice_code="$?"
    set -e
    [ ! -s "$_slice_stdout" ] || cat "$_slice_stdout"
    [ ! -s "$_slice_stderr" ] || cat "$_slice_stderr" >&2
    if [ "$_slice_code" -eq 0 ]; then
      continue
    fi

    _sync_failures=$(( _sync_failures + 1 ))
    echo "sync-builders failed for $_slice_name (exit $_slice_code); marking only this slice failed." >&2
    _failed_payload="$JOB_TMP_DIR/${_slice_name}-failed-payload.json"
    node "$AGENT_DIR/builder-digest.mjs" fail-sync-slice \
      --tasks "$_slice_tasks" \
      --out "$_failed_payload" \
      --reason "slice_sync_failed" \
      --message "sync-builders failed for $_slice_name with exit $_slice_code"

    _failed_stdout="$JOB_TMP_DIR/${_slice_name}-failed-sync.out"
    _failed_stderr="$JOB_TMP_DIR/${_slice_name}-failed-sync.err"
    set +e
    node "$AGENT_DIR/builder-digest.mjs" sync-builders \
      --file "$_failed_payload" \
      --tasks "$_slice_tasks" > "$_failed_stdout" 2> "$_failed_stderr"
    _failed_code="$?"
    set -e
    [ ! -s "$_failed_stdout" ] || cat "$_failed_stdout"
    [ ! -s "$_failed_stderr" ] || cat "$_failed_stderr" >&2
    if [ "$_failed_code" -ne 0 ]; then
      echo "Failed to patch failed outcomes for $_slice_name (exit $_failed_code)." >&2
    fi
  done

  if [ "$_sync_failures" -gt 0 ]; then
    echo "$_sync_failures library result slice(s) failed to sync." >&2
    return 65
  fi
  if [ "${_merge_issue_count:-0}" -gt 0 ]; then
    echo "Parallel library run completed with $_merge_issue_count worker/result issue(s); synced terminal outcomes, but marking the runtime failed." >&2
    return 65
  fi
  if [ "$_discovery_failed" -ne 0 ]; then
    echo "Library run completed normal post-task sync, but discovery failed for at least one source." >&2
    return 65
  fi
}

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_SMOKE_CHECK:-0}" = "1" ]; then
  run_runtime_smoke_check
  exit "$?"
fi

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_SCHEDULER_TICK:-0}" = "1" ] && [ "${BUILDER_BLOG_WORKER_MODE:-0}" != "1" ]; then
  run_cron_scheduler_tick
  exit "$?"
fi

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_WORKER_MODE:-0}" != "1" ] && [ "${BUILDER_BLOG_DISABLE_WEB_SYNC:-0}" != "1" ]; then
  run_cron_supervisor
fi

if [ "$IS_CRON_JOB" = 1 ] && [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; then
  set +e
  run_cron_worker
  _code="$?"
  set -e
  if [ -n "${BUILDER_BLOG_CURRENT_FILE:-}" ]; then
    clear_current_file "$BUILDER_BLOG_CURRENT_FILE" "${BUILDER_BLOG_JOB_RUN_ID:-}"
  fi
  exit "$_code"
elif [ "$JOB_NAME" = "library-once" ] || [ "$JOB_NAME" = "digest-once" ]; then
  run_one_time_with_lock
else
  run_selected_runtime
fi
