#!/bin/sh
set -eu

JOB_NAME="${1:-}"
APP_URL="${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PROMPT_FILE="$AGENT_DIR/jobs/$JOB_NAME.md"
# launchd/cron do not inherit the user's interactive shell PATH. Set this
# before any helper calls `node`, because account_slug runs before the rest of
# the runner has initialized.
SCHEDULER_SAFE_PATH="$HOME/.local/bin:$HOME/bin:$HOME/.codex/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
PATH="$SCHEDULER_SAFE_PATH:$PATH"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
legacy_account_slug() {
  node - "${1:-default}" <<'NODE'
const account = String(process.argv[2] || "default");
console.log(account.replace(/[^a-zA-Z0-9]/g, "_"));
NODE
}
ACCOUNT_SLUG="$(account_slug "${BUILDER_BLOG_ACCOUNT:-default}")"
DEFAULT_JOB_STATE_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/$JOB_NAME"
DEFAULT_JOB_TMP_DIR="$DEFAULT_JOB_STATE_DIR"
# A direct worker-mode invocation (the setup initial run, or any manual
# BUILDER_BLOG_WORKER_MODE=1 run) bypasses run_cron_supervisor and its
# current.json single-instance lock. Only such direct calls carry WORKER_MODE=1
# at entry — the scheduled path enters without it and the supervisor sets it
# later in-process, after JOB_STATE_DIR is already fixed. Give the bypassing run
# an isolated state dir so it can never race a launchd-scheduled run of the same
# job over current.json or schedule bookkeeping.
if [ -n "${BUILDER_BLOG_JOB_STATE_DIR:-}" ]; then
  JOB_STATE_DIR="$BUILDER_BLOG_JOB_STATE_DIR"
elif [ -n "${BUILDER_BLOG_JOB_TMP_DIR:-}" ] && [ "${BUILDER_BLOG_JOB_TMP_IS_RUN_DIR:-0}" != "1" ]; then
  # Backward compatibility: existing setup prompts pass BUILDER_BLOG_JOB_TMP_DIR
  # before a job run id exists. Treat that path as the stable job state root; the
  # tracked run later rewrites BUILDER_BLOG_JOB_TMP_DIR to runs/<instanceId>.
  JOB_STATE_DIR="$BUILDER_BLOG_JOB_TMP_DIR"
elif [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; then
  JOB_STATE_DIR="$DEFAULT_JOB_STATE_DIR-direct"
else
  JOB_STATE_DIR="$DEFAULT_JOB_STATE_DIR"
fi
JOB_TMP_DIR="$JOB_STATE_DIR"
if [ "${BUILDER_BLOG_JOB_TMP_IS_RUN_DIR:-0}" = "1" ] && [ -n "${BUILDER_BLOG_JOB_TMP_DIR:-}" ]; then
  JOB_TMP_DIR="$BUILDER_BLOG_JOB_TMP_DIR"
fi
HEARTBEAT_INTERVAL_SECONDS=60

# Tag every fetch the CLI emits as "cron" while we're inside the cron
# runner so the per-user fetch log can distinguish scheduled jobs from
# manual terminal invocations.
BUILDER_BLOG_RUN_SOURCE=cron
export PATH BUILDER_BLOG_URL="$APP_URL" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_RUN_SOURCE
export BUILDER_BLOG_ACCOUNT_SLUG="$ACCOUNT_SLUG" BUILDER_BLOG_JOB_STATE_DIR="$JOB_STATE_DIR" BUILDER_BLOG_JOB_TMP_DIR="$JOB_TMP_DIR"

if [ -z "$JOB_NAME" ]; then
  echo "Usage: builder-agent-runner.sh <library-once|digest-once|library-cron-setup|digest-cron-setup|library-cron|digest-cron|cloud-library-cron|cloud-library-host>" >&2
  exit 64
fi

mkdir -p "$AGENT_DIR/logs" "$AGENT_DIR/tmp" "$JOB_STATE_DIR" "$JOB_TMP_DIR"

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
    if ! runner_has_safe_bootstrap "$_next"; then
      rm -f "$_next" 2>/dev/null || true
      return 0
    fi
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
runner_has_safe_bootstrap() {
  _file="$1"
  awk '
    /PATH="\$SCHEDULER_SAFE_PATH:\$PATH"/ { pathLine = NR }
    /ACCOUNT_SLUG="\$\(account_slug "\$\{BUILDER_BLOG_ACCOUNT:-default\}"\)"/ { slugLine = NR }
    END { exit !(pathLine > 0 && slugLine > 0 && pathLine < slugLine) }
  ' "$_file" 2>/dev/null
}
if [ "${BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH:-0}" != "1" ] && { [ "${BUILDER_BLOG_SCHEDULER_TICK:-0}" != "1" ] || [ "${BUILDER_BLOG_WORKER_MODE:-0}" = "1" ]; }; then
  self_update_and_reexec "$@"
fi

refresh_skill_files() {
  mkdir -p "$AGENT_DIR" "$AGENT_DIR/jobs" "$AGENT_DIR/logs" "$AGENT_DIR/tmp"
  download_skill_file "$APP_URL/api/skill/files/builder-digest.mjs" "$AGENT_DIR/builder-digest.mjs"
  download_skill_file "$APP_URL/api/skill/files/cloud-shard-budget.mjs" "$AGENT_DIR/cloud-shard-budget.mjs"
  download_skill_file "$APP_URL/api/skill/files/sources.json" "$AGENT_DIR/sources.json"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-library-once.md" "$AGENT_DIR/jobs/library-once.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-once.md" "$AGENT_DIR/jobs/digest-once.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-library-cron-setup.md" "$AGENT_DIR/jobs/library-cron-setup.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-cron-setup.md" "$AGENT_DIR/jobs/digest-cron-setup.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-cron.md" "$AGENT_DIR/jobs/digest-cron.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-cloud-library-cron.md" "$AGENT_DIR/jobs/cloud-library-cron.md"
  download_skill_file "$APP_URL/api/skill/files/builder-blog-cloud-library-host.md" "$AGENT_DIR/jobs/cloud-library-host.md"
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
  _ocp_timeout_seconds="$5"
  _ocp_out="$(openclaw_prompt_dir)/$_ocp_shard_name-worker.md"
  cat > "$_ocp_out" <<EOF
OpenClaw Gateway runner context:

This job runs through OpenClaw Gateway. Gateway tool calls may not inherit the
parent runner shell environment. Treat the concrete paths below as
authoritative, and do not search for the shard assignment or result path.

- Shard file: $_ocp_shard_file
- Shard result file: $_ocp_result_file
- Shard checkpoint directory: $_ocp_checkpoint_dir
- Shard timeout seconds: $_ocp_timeout_seconds
- Shard started-at epoch: ${BUILDER_BLOG_SHARD_STARTED_AT_EPOCH:-unknown}
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
export BUILDER_BLOG_SHARD_TIMEOUT_SECONDS=$(shell_quote "$_ocp_timeout_seconds")
export BUILDER_BLOG_SHARD_STARTED_AT_EPOCH=$(shell_quote "${BUILDER_BLOG_SHARD_STARTED_AT_EPOCH:-}")
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
  _codex_output="$(agent_output_file codex)"
  _codex_usage="$(agent_usage_file codex)"
  LAST_AGENT_OUTPUT_FILE="$_codex_output"
  LAST_AGENT_USAGE_FILE="$_codex_usage"
  _codex_model="${BUILDER_BLOG_CODEX_MODEL:-gpt-5.4-mini}"
  set +e
  if structured_usage_enabled; then
    codex exec --json --model "$_codex_model" --skip-git-repo-check -C "$AGENT_DIR" - < "$PROMPT_FILE" > "$_codex_output" 2>&1
  else
    codex exec --model "$_codex_model" --skip-git-repo-check -C "$AGENT_DIR" - < "$PROMPT_FILE" > "$_codex_output" 2>&1
  fi
  _codex_code="$?"
  set -e
  capture_runtime_usage codex "$_codex_output" "$_codex_usage" openai-codex "$_codex_model"
  cat "$_codex_output"
  return "$_codex_code"
}

run_with_claude() {
  _claude_output="$(agent_output_file claude)"
  _claude_usage="$(agent_usage_file claude)"
  LAST_AGENT_OUTPUT_FILE="$_claude_output"
  LAST_AGENT_USAGE_FILE="$_claude_usage"
  _claude_model="${BUILDER_BLOG_CLAUDE_MODEL:-sonnet}"
  set +e
  if structured_usage_enabled; then
    claude -p "$(cat "$PROMPT_FILE")" \
      --model "$_claude_model" \
      --output-format stream-json \
      --verbose \
      --add-dir "$AGENT_DIR" > "$_claude_output" 2>&1
  else
    claude -p "$(cat "$PROMPT_FILE")" --model "$_claude_model" --add-dir "$AGENT_DIR" > "$_claude_output" 2>&1
  fi
  _claude_code="$?"
  set -e
  capture_runtime_usage claude "$_claude_output" "$_claude_usage"
  cat "$_claude_output"
  return "$_claude_code"
}

run_with_openclaw() {
  # `agent` requires a session selector on 2026.5.20+ (the bare form errors
  # with "Pass --to/--session-id/--agent"); default to the `main` agent.
  _openclaw_output="$(agent_output_file openclaw)"
  _openclaw_usage="$(agent_usage_file openclaw)"
  LAST_AGENT_OUTPUT_FILE="$_openclaw_output"
  LAST_AGENT_USAGE_FILE="$_openclaw_usage"
  set +e
  if [ -n "${OPENCLAW_SESSION_ID:-}" ]; then
    if structured_usage_enabled; then
      openclaw agent --json --local --session-id "$OPENCLAW_SESSION_ID" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
    else
      openclaw agent --local --session-id "$OPENCLAW_SESSION_ID" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
    fi
  else
    if structured_usage_enabled; then
      openclaw agent --json --local --agent "${OPENCLAW_AGENT:-main}" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
    else
      openclaw agent --local --agent "${OPENCLAW_AGENT:-main}" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
    fi
  fi
  _openclaw_code="$?"
  set -e
  capture_runtime_usage openclaw "$_openclaw_output" "$_openclaw_usage"
  cat "$_openclaw_output"
  return "$_openclaw_code"
}

run_with_hermes() {
  _hermes_output="$(agent_output_file hermes)"
  _hermes_usage="$(agent_usage_file hermes)"
  LAST_AGENT_OUTPUT_FILE="$_hermes_output"
  LAST_AGENT_USAGE_FILE="$_hermes_usage"
  set +e
  # Hermes disables its no-byte TTFB watchdog for large Codex contexts by
  # default. A stalled backend stream would then outlive the worker progress
  # deadline without retrying, so keep its supported reconnect watchdog on for
  # FollowBrief jobs unless the operator explicitly overrides it.
  HERMES_CODEX_TTFB_STRICT="${HERMES_CODEX_TTFB_STRICT:-1}" hermes chat -q "$(cat "$PROMPT_FILE")" > "$_hermes_output" 2>&1
  _hermes_code="$?"
  set -e
  capture_runtime_usage hermes "$_hermes_output" "$_hermes_usage"
  cat "$_hermes_output"
  return "$_hermes_code"
}

agent_output_file() {
  _runtime="$1"
  if [ -n "${BUILDER_BLOG_AGENT_OUTPUT_FILE:-}" ]; then
    printf '%s\n' "$BUILDER_BLOG_AGENT_OUTPUT_FILE"
    return 0
  fi
  mkdir -p "$JOB_TMP_DIR"
  mktemp "$JOB_TMP_DIR/$_runtime-agent-output.XXXXXX"
}

agent_usage_file() {
  _runtime="$1"
  if [ -n "${BUILDER_BLOG_SHARD_RESULT:-}" ]; then
    case "$BUILDER_BLOG_SHARD_RESULT" in
      *-result.json) printf '%s\n' "${BUILDER_BLOG_SHARD_RESULT%-result.json}-usage.jsonl" ;;
      *) printf '%s\n' "$BUILDER_BLOG_SHARD_RESULT-usage.jsonl" ;;
    esac
    return 0
  fi
  mkdir -p "$JOB_TMP_DIR"
  mktemp "$JOB_TMP_DIR/$_runtime-agent-usage.XXXXXX"
}

capture_runtime_usage() {
  _runtime="$1"
  _output="$2"
  _usage="$3"
  _provider="${4:-}"
  _model="${5:-}"
  [ -n "$_usage" ] && [ -r "$_output" ] || return 0
  if [ -n "$_provider" ] || [ -n "$_model" ]; then
    node "$AGENT_DIR/builder-digest.mjs" parse-runtime-usage \
      --runtime "$_runtime" \
      --provider "$_provider" \
      --model "$_model" \
      --file "$_output" \
      --out "$_usage" >/dev/null 2>&1 || true
  else
    node "$AGENT_DIR/builder-digest.mjs" parse-runtime-usage \
      --runtime "$_runtime" \
      --file "$_output" \
      --out "$_usage" >/dev/null 2>&1 || true
  fi
  [ -s "$_usage" ] || rm -f "$_usage" 2>/dev/null || true
}

structured_usage_enabled() {
  [ "${BUILDER_BLOG_STRUCTURED_USAGE:-}" = "0" ] && return 1
  [ "${BUILDER_BLOG_STRUCTURED_USAGE:-1}" = "1" ] && return 0
  [ "${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-}" = "worker" ] && return 0
  return 1
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
  _codex_usage="$(agent_usage_file codex)"
  LAST_AGENT_OUTPUT_FILE="$_codex_output"
  LAST_AGENT_USAGE_FILE="$_codex_usage"
  # Default to a cheaper model to keep digest/library runs inexpensive;
  # override per run/job with BUILDER_BLOG_CODEX_MODEL.
  _codex_model="${BUILDER_BLOG_CODEX_MODEL:-gpt-5.4-mini}"
  set +e
  if structured_usage_enabled; then
    codex exec --json --model "$_codex_model" --skip-git-repo-check --full-auto \
      -c sandbox_workspace_write.network_access=true \
      -C "$AGENT_DIR" - < "$PROMPT_FILE" > "$_codex_output" 2>&1
  else
    codex exec --model "$_codex_model" --skip-git-repo-check --full-auto \
      -c sandbox_workspace_write.network_access=true \
      -C "$AGENT_DIR" - < "$PROMPT_FILE" > "$_codex_output" 2>&1
  fi
  _codex_code="$?"
  set -e
  capture_runtime_usage codex "$_codex_output" "$_codex_usage" openai-codex "$_codex_model"
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
  _claude_allowed_tools="Bash,Edit,Read,Write,Grep,Glob,WebFetch"
  _claude_disallowed_tools="Task,TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate"
  claude_unattended_command() {
    # The runner owns library shard parallelism. Block only Claude's internal
    # Task/subagent tools in shard workers: delegated agents do not write
    # FollowBrief checkpoint/result files for this worker, so their work is not
    # durable. Shard workers run in safe mode so user-level Claude hooks cannot
    # block the runner's own BUILDER_BLOG_* environment variables.
    if [ "${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-}" = "worker" ]; then
      claude "$@" --safe-mode --allowedTools "$_claude_allowed_tools" --disallowedTools "$_claude_disallowed_tools"
    else
      claude "$@" --allowedTools "$_claude_allowed_tools"
    fi
  }
  # acceptEdits auto-approves edits. Non-worker Claude jobs still pre-approve
  # the primary tool surface they use; shard workers only deny nested delegation
  # tools so a permission allowlist cannot block a useful built-in tool before
  # the first checkpoint.
  _claude_output="$(agent_output_file claude)"
  _claude_usage="$(agent_usage_file claude)"
  LAST_AGENT_OUTPUT_FILE="$_claude_output"
  LAST_AGENT_USAGE_FILE="$_claude_usage"
  # Default to the cheaper Sonnet tier to keep digest/library runs inexpensive;
  # override per run/job with BUILDER_BLOG_CLAUDE_MODEL.
  _claude_model="${BUILDER_BLOG_CLAUDE_MODEL:-sonnet}"
  set +e
  if structured_usage_enabled; then
    # `--print` (-p) with `--output-format stream-json` requires `--verbose`
    # on current Claude CLI versions; without it the CLI exits immediately
    # and the worker produces no shard result.
    claude_unattended_command -p "$(cat "$PROMPT_FILE")" \
      --model "$_claude_model" \
      --output-format stream-json \
      --verbose \
      --add-dir "$AGENT_DIR" \
      --permission-mode acceptEdits > "$_claude_output" 2>&1
  else
    claude_unattended_command -p "$(cat "$PROMPT_FILE")" \
      --model "$_claude_model" \
      --add-dir "$AGENT_DIR" \
      --permission-mode acceptEdits > "$_claude_output" 2>&1
  fi
  _claude_code="$?"
  set -e
  capture_runtime_usage claude "$_claude_output" "$_claude_usage"
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
  if [ "${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-}" = "worker" ]; then
    case "${BUILDER_BLOG_SHARD_TIMEOUT_SECONDS:-}" in
      ''|*[!0-9]*|0) ;;
      *) _openclaw_timeout="${BUILDER_BLOG_SHARD_TIMEOUT_SECONDS}" ;;
    esac
  fi
  case "$_openclaw_timeout" in
    ''|*[!0-9]*|0) _openclaw_timeout="$(job_timeout_seconds)" ;;
  esac
  sync_openclaw_timeout_config "$_openclaw_timeout"
  _openclaw_output="$(agent_output_file openclaw)"
  _openclaw_usage="$(agent_usage_file openclaw)"
  LAST_AGENT_OUTPUT_FILE="$_openclaw_output"
  LAST_AGENT_USAGE_FILE="$_openclaw_usage"
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
        if structured_usage_enabled; then
          openclaw agent --json --session-id "$_openclaw_session_id" --timeout "$_openclaw_timeout" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
        else
          openclaw agent --session-id "$_openclaw_session_id" --timeout "$_openclaw_timeout" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
        fi
        _openclaw_code="$?"
        set -e
      else
        echo "Running OpenClaw Gateway attempt $_openclaw_attempt/$_openclaw_attempts with model $_openclaw_model."
        set +e
        if structured_usage_enabled; then
          openclaw agent --json --session-id "$_openclaw_session_id" --timeout "$_openclaw_timeout" --model "$_openclaw_model" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
        else
          openclaw agent --session-id "$_openclaw_session_id" --timeout "$_openclaw_timeout" --model "$_openclaw_model" --message "$(cat "$PROMPT_FILE")" > "$_openclaw_output" 2>&1
        fi
        _openclaw_code="$?"
        set -e
      fi
      capture_runtime_usage openclaw "$_openclaw_output" "$_openclaw_usage"
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

agent_output_has_runtime_pattern() {
  _file="${1:-}"
  _pattern="${2:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  [ -n "$_pattern" ] || return 1
  node - "$_file" "$_pattern" <<'NODE'
const fs = require("fs");
const [file, pattern] = process.argv.slice(2);
const regex = new RegExp(pattern, "i");
const contentEventTypes = new Set(["agent_message", "command_execution"]);
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

for (const line of lines) {
  if (!line.trim()) continue;
  let event = null;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }

  const itemType = typeof event?.item?.type === "string" ? event.item.type : null;
  const eventType = typeof event?.type === "string" ? event.type : null;
  if (contentEventTypes.has(itemType || "") || contentEventTypes.has(eventType || "")) {
    continue;
  }
  if (regex.test(JSON.stringify(event))) process.exit(0);
}
process.exit(1);
NODE
}

agent_output_runtime_summary_for_pattern() {
  _file="${1:-}"
  _pattern="${2:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 0
  [ -n "$_pattern" ] || return 0
  node - "$_file" "$_pattern" <<'NODE'
const fs = require("fs");
const [file, pattern] = process.argv.slice(2);
const regex = new RegExp(pattern, "i");
const contentEventTypes = new Set(["agent_message", "command_execution"]);
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

for (const line of lines) {
  if (!line.trim()) continue;
  let event = null;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  const itemType = typeof event?.item?.type === "string" ? event.item.type : null;
  const eventType = typeof event?.type === "string" ? event.type : null;
  if (contentEventTypes.has(itemType || "") || contentEventTypes.has(eventType || "")) {
    continue;
  }
  const serialized = JSON.stringify(event);
  if (!regex.test(serialized)) continue;
  const message =
    event?.message ||
    event?.error?.message ||
    event?.error ||
    event?.item?.message ||
    event?.item?.error?.message ||
    event?.item?.error ||
    serialized;
  console.log(compact(message));
  process.exit(0);
}
NODE
}

agent_output_has_openclaw_auth_failure() {
  agent_output_has_runtime_pattern "${1:-}" \
    "OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth"
}

openclaw_auth_failure_summary() {
  agent_output_runtime_summary_for_pattern "${1:-}" \
    "OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth|FailoverError:" \
    || true
}

agent_output_has_openclaw_preflight_marker() {
  _file="${1:-}"
  [ -n "$_file" ] && [ -r "$_file" ] || return 1
  if grep -q '"followbriefRuntimePreflight"[[:space:]]*:[[:space:]]*"ok"' "$_file" && \
    grep -q '"runtimeReady"[[:space:]]*:[[:space:]]*true' "$_file"; then
    return 0
  fi
  node - "$_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");
const markerText = (value) =>
  typeof value === "string" &&
  /"followbriefRuntimePreflight"\s*:\s*"ok"/.test(value) &&
  /"runtimeReady"\s*:\s*true/.test(value);
const hasMarker = (value, depth = 0) => {
  if (depth > 20) return false;
  if (markerText(value)) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return false;
    try {
      return hasMarker(JSON.parse(trimmed), depth + 1);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  if (value.followbriefRuntimePreflight === "ok" && value.runtimeReady === true) return true;
  return Object.values(value).some((child) => hasMarker(child, depth + 1));
};
const documents = [text, ...text.split(/\n+/).filter(Boolean)];
for (const documentText of documents) {
  if (markerText(documentText)) process.exit(0);
  try {
    if (hasMarker(JSON.parse(documentText))) process.exit(0);
  } catch {
    // Keep scanning; OpenClaw may emit JSONL or decorated text.
  }
}
process.exit(1);
NODE
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
  agent_output_has_runtime_pattern "${1:-}" \
    "Request timed out before a response was generated|codex app-server turn idle timed out|codex app-server client retired after timed-out turn|embedded run failover decision:.*reason=timeout|LLM timed out|Profile .* timed out|DEADLINE_EXCEEDED|deadline exceeded"
}

agent_output_has_openclaw_capacity_failure() {
  agent_output_has_runtime_pattern "${1:-}" \
    "Selected model is at capacity|model is at capacity|provider overloaded|overloaded|rate.?limit|too many requests|FailoverError:.*capacity|FailoverError:.*overload|FailoverError:.*rate"
}

agent_runtime_failure_summary() {
  agent_output_runtime_summary_for_pattern "${1:-}" \
    "GatewayClientRequestError:|FailoverError:|Provider authentication failed|OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth|Request timed out before a response was generated|DEADLINE_EXCEEDED|deadline exceeded|No candidate items were present|did not write a digest JSON|did not write digest JSON|Digest agent did not produce builder-blog-digest-agent-output\\.json" \
    || true
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
  _hermes_usage="$(agent_usage_file hermes)"
  LAST_AGENT_OUTPUT_FILE="$_hermes_output"
  LAST_AGENT_USAGE_FILE="$_hermes_usage"
  set +e
  HERMES_CODEX_TTFB_STRICT="${HERMES_CODEX_TTFB_STRICT:-1}" hermes chat -Q --yolo --accept-hooks --source tool -q "$(cat "$PROMPT_FILE")" > "$_hermes_output" 2>&1
  _hermes_code="$?"
  set -e
  capture_runtime_usage hermes "$_hermes_output" "$_hermes_usage"
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
  case "$JOB_NAME" in
    cloud-library-host|cloud-library-cron)
      return 0
      ;;
  esac
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
if [ -z "${BUILDER_BLOG_AGENT_MODEL:-}" ]; then
  case "$PINNED_RUNTIME" in
    codex) BUILDER_BLOG_AGENT_MODEL="${BUILDER_BLOG_CODEX_MODEL:-gpt-5.4-mini}" ;;
    claude) BUILDER_BLOG_AGENT_MODEL="${BUILDER_BLOG_CLAUDE_MODEL:-sonnet}" ;;
  esac
fi
export BUILDER_BLOG_AGENT_MODEL

# Forced re-fetch: cron-setup writes 1 to the fetch-force pin when the user
# picked "override already-fetched posts". We expose it as
# BUILDER_BLOG_FETCH_FORCE, which the runner passes to fetch-personal
# (`${BUILDER_BLOG_FETCH_FORCE:-}` → --force). "1" → --force (re-pull posts
# already in the library, ignoring the fetchedAt cutoff + externalId dedup);
# anything else → no flag.
BUILDER_BLOG_FETCH_FORCE=""
if [ "$INCOMING_FETCH_FORCE_SET" = "1" ]; then
  case "$INCOMING_FETCH_FORCE" in
    1|--force) BUILDER_BLOG_FETCH_FORCE="--force" ;;
    *) BUILDER_BLOG_FETCH_FORCE="" ;;
  esac
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
  case "$INCOMING_DIGEST_REGENERATE" in
    1|--regenerate) BUILDER_BLOG_DIGEST_REGENERATE="--regenerate" ;;
    *) BUILDER_BLOG_DIGEST_REGENERATE="" ;;
  esac
elif [ "$(read_pin regenerate)" = "1" ]; then
  BUILDER_BLOG_DIGEST_REGENERATE="--regenerate"
fi
export BUILDER_BLOG_DIGEST_REGENERATE

# Local job fan-out: the runner orchestrates the library job itself —
# fetch-personal, discovery expansion, assign-fetch-tasks, merge-task-results,
# validate-agent-sync, and sync-builders are deterministic CLI steps. Runtime
# workers only complete assigned fetchTasks. Digest jobs carry the same setting
# in job-run telemetry and copied prompt state. The pin is per-account and per-job
# with the usual once→cron fallback, so a one-time run uses the same worker
# count as the recurring job. Absent/invalid → default worker count.
if [ "$INCOMING_PARALLEL_WORKERS_SET" = "1" ]; then
  MAX_PARALLEL_WORKERS="$INCOMING_PARALLEL_WORKERS"
else
  MAX_PARALLEL_WORKERS="$(read_pin parallel)"
fi
case "$MAX_PARALLEL_WORKERS" in
  ''|*[!0-9]*) MAX_PARALLEL_WORKERS="10" ;;
esac
if [ "$MAX_PARALLEL_WORKERS" -lt 1 ]; then MAX_PARALLEL_WORKERS="1"; fi
if [ "$MAX_PARALLEL_WORKERS" -gt 20 ]; then MAX_PARALLEL_WORKERS="20"; fi

cloud_fetch_source_limit() {
  # Backward compatibility: old copied prompts or hand-run shells may still pin
  # the source lease size explicitly.
  _cfsl_pinned="${BUILDER_BLOG_CLOUD_FETCH_LIMIT:-}"
  case "$_cfsl_pinned" in
    ''|*[!0-9]*) _cfsl_pinned="" ;;
  esac
  if [ -n "$_cfsl_pinned" ]; then
    if [ "$_cfsl_pinned" -lt 1 ]; then _cfsl_pinned="1"; fi
    if [ "$_cfsl_pinned" -gt 100 ]; then _cfsl_pinned="100"; fi
    printf '%s\n' "$_cfsl_pinned"
    return 0
  fi

  _cfsl_workers="$MAX_PARALLEL_WORKERS"
  case "$_cfsl_workers" in
    ''|*[!0-9]*) _cfsl_workers="1" ;;
  esac
  if [ "$_cfsl_workers" -lt 1 ]; then _cfsl_workers="1"; fi
  if [ "$_cfsl_workers" -gt 20 ]; then _cfsl_workers="20"; fi

  _cfsl_post_limit="5"

  # Ask for enough sources to likely produce several post tasks per worker.
  # The cloud still enforces token budget and eligibility; this is only the
  # local runner's capacity hint.
  _cfsl_target_posts=$(( _cfsl_workers * 4 ))
  _cfsl_limit=$(( ( _cfsl_target_posts + _cfsl_post_limit - 1 ) / _cfsl_post_limit ))
  if [ "$_cfsl_limit" -lt "$_cfsl_workers" ]; then _cfsl_limit="$_cfsl_workers"; fi
  if [ "$_cfsl_limit" -lt 1 ]; then _cfsl_limit="1"; fi
  if [ "$_cfsl_limit" -gt 100 ]; then _cfsl_limit="100"; fi
  printf '%s\n' "$_cfsl_limit"
}

job_type_for_name() {
  case "$JOB_NAME" in
    cloud-library-*) printf '%s\n' "cloud-library-fetch" ;;
    library-*) printf '%s\n' "library-fetch" ;;
    digest-*) printf '%s\n' "digest-build" ;;
    *) printf '%s\n' "library-fetch" ;;
  esac
}

schedule_job_for_name() {
  case "$JOB_NAME" in
    library-cron) printf '%s\n' "library-cron" ;;
    cloud-library-cron) printf '%s\n' "cloud-library-cron" ;;
    digest-cron) printf '%s\n' "digest-cron" ;;
    *) printf '%s\n' "" ;;
  esac
}

schedule_anchor_file() {
  printf '%s\n' "$AGENT_DIR/schedule-anchor-$JOB_NAME-$ACCOUNT_SLUG"
}

scheduler_last_fired_file() {
  printf '%s\n' "$JOB_STATE_DIR/last-fired-expected-at"
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
const jobDefault = policy.jobDefaultSeconds && Number(policy.jobDefaultSeconds[job]);
if (Number.isFinite(jobDefault) && jobDefault > 0) {
  console.log(String(jobDefault));
  process.exit(0);
}
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
    library-once|digest-once) printf '%s\n' "43200"; return 0 ;;
    library-cron) _max=$(( 120 * 60 )) ;;
    cloud-library-cron) _max=$(( ( 4 * 60 * 60 ) + ( 15 * 60 ) )) ;;
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
      timeout_seconds_for_job "$RESOLVED_INTERVAL_MINUTES" "$JOB_NAME"
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

shard_timeout_seconds_for_file() {
  _stsff_file="${1:-}"
  _stsff_fallback="${2:-${_shard_timeout:-$(shard_timeout_seconds "$(job_timeout_seconds)")}}"
  [ -r "$_stsff_file" ] || {
    printf '%s\n' "$_stsff_fallback"
    return 0
  }
  if command -v node >/dev/null 2>&1; then
    _stsff_computed="$(
      node - "$_stsff_file" "$_stsff_fallback" <<'NODE' 2>/dev/null
const fs = require("fs");
const [file, fallbackArg] = process.argv.slice(2);
const fallback = Number(fallbackArg);
function asInt(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}
function validCloudBudget(value) {
  const seconds = asInt(value);
  return seconds >= 3600 && seconds <= 14400 ? seconds : 0;
}
try {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const tasks = Array.isArray(payload?.fetchTasks)
    ? payload.fetchTasks
    : Array.isArray(payload?.tasks)
      ? payload.tasks
      : [];
  const firstTask = tasks.find(Boolean) || null;
  const isCloud = Boolean(
    payload?.cloudRunId ||
    payload?.cloudSourceTaskId ||
    firstTask?.cloudRunId ||
    firstTask?.cloudSourceTaskId ||
    firstTask?.builderSync?.cloudRunId ||
    firstTask?.builderSync?.cloudSourceTaskId
  );
  if (isCloud) {
    console.log(String(validCloudBudget(payload?.executionBudgetSeconds) || validCloudBudget(firstTask?.executionBudgetSeconds) || 3600));
    process.exit(0);
  }
} catch {}
console.log(String(Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 0));
NODE
    )"
    case "$_stsff_computed" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$_stsff_computed"; return 0 ;;
    esac
  fi
  printf '%s\n' "$_stsff_fallback"
}

shard_is_cloud_file() {
  _sicf_file="${1:-}"
  [ -r "$_sicf_file" ] || return 1
  node - "$_sicf_file" <<'NODE' >/dev/null 2>&1
const fs = require("fs");
try {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const tasks = Array.isArray(payload?.fetchTasks)
    ? payload.fetchTasks
    : Array.isArray(payload?.tasks)
      ? payload.tasks
      : [];
  const firstTask = tasks.find(Boolean) || null;
  const isCloud = Boolean(
    payload?.cloudRunId ||
    payload?.cloudSourceTaskId ||
    firstTask?.cloudRunId ||
    firstTask?.cloudSourceTaskId ||
    firstTask?.builderSync?.cloudRunId ||
    firstTask?.builderSync?.cloudSourceTaskId
  );
  process.exit(isCloud ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

worker_window_deadline_epoch_file() {
  printf '%s\n' "$JOB_TMP_DIR/cloud-library-worker-window-deadline-epoch"
}

job_started_epoch_seconds() {
  case "${_run_started_epoch_seconds:-}" in
    ''|*[!0-9]*) ;;
    *) printf '%s\n' "$_run_started_epoch_seconds"; return 0 ;;
  esac
  _jses_started_at="${BUILDER_BLOG_JOB_STARTED_AT:-}"
  if [ -n "$_jses_started_at" ] && command -v node >/dev/null 2>&1; then
    _jses_epoch="$(
      node - "$_jses_started_at" <<'NODE' 2>/dev/null
const startedAt = process.argv[2];
const date = new Date(startedAt);
const epoch = Math.floor(date.getTime() / 1000);
console.log(Number.isFinite(epoch) ? String(epoch) : "0");
NODE
    )"
    case "$_jses_epoch" in
      ''|*[!0-9]*) ;;
      *)
        _run_started_epoch_seconds="$_jses_epoch"
        printf '%s\n' "$_run_started_epoch_seconds"
        return 0
        ;;
    esac
  fi
  _run_started_epoch_seconds="$(date +%s)"
  printf '%s\n' "$_run_started_epoch_seconds"
}

current_outer_deadline_epoch_seconds() {
  if [ "$JOB_NAME" = "cloud-library-cron" ] && [ "${_cloud_persistent_host:-0}" -eq 0 ]; then
    _codes_file="$(worker_window_deadline_epoch_file)"
    if [ -r "$_codes_file" ]; then
      _codes_value="$(cat "$_codes_file" 2>/dev/null || true)"
      case "$_codes_value" in
        ''|*[!0-9]*) ;;
        *) printf '%s\n' "$_codes_value"; return 0 ;;
      esac
    fi
  fi
  _codes_started="$(job_started_epoch_seconds)"
  _codes_timeout="$(job_timeout_seconds)"
  printf '%s\n' "$(( _codes_started + _codes_timeout ))"
}

set_initial_worker_window_deadline() {
  [ "$JOB_NAME" = "cloud-library-cron" ] || return 0
  [ "${_cloud_persistent_host:-0}" -eq 0 ] || return 0
  _siwwd_file="$(worker_window_deadline_epoch_file)"
  if [ -r "$_siwwd_file" ]; then
    _siwwd_existing="$(cat "$_siwwd_file" 2>/dev/null || true)"
    case "$_siwwd_existing" in
      ''|*[!0-9]*) ;;
      *) return 0 ;;
    esac
  fi
  _siwwd_now="$(date +%s)"
  _siwwd_timeout="$(job_timeout_seconds)"
  printf '%s\n' "$(( _siwwd_now + _siwwd_timeout ))" > "$_siwwd_file"
}

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

job_file_component() {
  printf '%s' "${1:-}" | tr -c 'a-zA-Z0-9_.@+-' '_'
}

write_run_owner_file() {
  [ -n "${BUILDER_BLOG_JOB_RUN_ID:-}" ] || return 1
  mkdir -p "$JOB_TMP_DIR"
  node - "$JOB_TMP_DIR/.run-owner.json" "$ACCOUNT_SLUG" "$JOB_NAME" "$BUILDER_BLOG_JOB_RUN_ID" "$$" "${BUILDER_BLOG_JOB_STARTED_AT:-}" <<'NODE'
const fs = require("fs");
const [file, accountSlug, jobName, instanceId, pid, startedAt] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  app: "followbrief",
  accountSlug,
  jobName,
  instanceId,
  pid: Number(pid) || null,
  startedAt: startedAt || null,
  createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
}, null, 2)}\n`, { mode: 0o600 });
NODE
}

validate_run_tmp_dir() {
  [ -n "${JOB_TMP_DIR:-}" ] && [ -n "${JOB_STATE_DIR:-}" ] || return 1
  case "$JOB_TMP_DIR" in
    "$JOB_STATE_DIR"/runs/*) ;;
    *) return 1 ;;
  esac
  [ -d "$JOB_TMP_DIR" ] || return 1
  [ ! -L "$JOB_TMP_DIR" ] || return 1
  [ -f "$JOB_TMP_DIR/.run-owner.json" ] || return 1
  node - "$JOB_TMP_DIR/.run-owner.json" "$ACCOUNT_SLUG" "$JOB_NAME" "${BUILDER_BLOG_JOB_RUN_ID:-}" <<'NODE'
const fs = require("fs");
const [file, accountSlug, jobName, instanceId] = process.argv.slice(2);
let owner;
try {
  owner = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(1);
}
if (
  owner?.app !== "followbrief" ||
  owner?.accountSlug !== accountSlug ||
  owner?.jobName !== jobName ||
  owner?.instanceId !== instanceId
) {
  process.exit(1);
}
NODE
}

copy_tail_file() {
  _source="$1"
  _dest="$2"
  _bytes="${3:-200000}"
  [ -r "$_source" ] || return 0
  mkdir -p "$(dirname "$_dest")"
  tail -c "$_bytes" "$_source" > "$_dest" 2>/dev/null || cp "$_source" "$_dest" 2>/dev/null || true
}

copy_recovery_file() {
  _source="$1"
  _dest="$2"
  [ -r "$_source" ] || return 0
  mkdir -p "$(dirname "$_dest")"
  cp "$_source" "$_dest" 2>/dev/null || copy_tail_file "$_source" "$_dest" 2000000
}

write_cleanup_debug_bundle() {
  _status="$1"
  _reason="${2:-}"
  _debug_dir="$JOB_TMP_DIR/debug"
  _recovery_dir="$_debug_dir/recovery"
  mkdir -p "$_debug_dir/errors" "$_debug_dir/worker-log-tails" "$_debug_dir/agent-output-tails" "$_recovery_dir"
  node - "$_debug_dir/runner-summary.json" "$ACCOUNT_SLUG" "$JOB_NAME" "${BUILDER_BLOG_JOB_RUN_ID:-}" "$_status" "$_reason" "$JOB_TMP_DIR" "$JOB_STATE_DIR" "${BUILDER_BLOG_RUNTIME:-}" "${BUILDER_BLOG_USAGE_FILE:-}" <<'NODE'
const fs = require("fs");
const [file, accountSlug, jobName, instanceId, status, reason, runTmpDir, jobStateDir, runtime, usageFile] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  accountSlug,
  jobName,
  instanceId,
  status,
  reason,
  runTmpDir,
  jobStateDir,
  runtime: runtime || null,
  usageFile: usageFile || null,
  cleanedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
}, null, 2)}\n`, { mode: 0o600 });
NODE

  for _debug_source in \
    "$JOB_TMP_DIR"/*.err \
    "$JOB_TMP_DIR"/*.out \
    "$JOB_TMP_DIR"/runtime-usage-*.jsonl \
    "$JOB_TMP_DIR"/*-agent-usage.* \
    "$JOB_TMP_DIR"/merge-task-results*.json \
    "$JOB_TMP_DIR"/library-fetch.err \
    "$JOB_TMP_DIR"/library-expand-discovery.err \
    "$JOB_TMP_DIR"/digest-prepare.err \
    "$JOB_TMP_DIR"/digest-render.err \
    "$JOB_TMP_DIR"/digest-sync.err
  do
    [ -e "$_debug_source" ] || continue
    copy_tail_file "$_debug_source" "$_debug_dir/errors/$(basename "$_debug_source")"
  done

  for _recovery_source in \
    "$JOB_TMP_DIR"/library-fetch-result.json \
    "$JOB_TMP_DIR"/library-fetch-expanded.json \
    "$JOB_TMP_DIR"/library-discovery-result.json \
    "$JOB_TMP_DIR"/completed-checkpoint-synced-task-ids.txt \
    "$JOB_TMP_DIR"/assigned-fetch-task-ids.txt \
    "$JOB_TMP_DIR"/active-fetch-group-keys.txt \
    "$JOB_TMP_DIR"/shards/shard-*.json \
    "$JOB_TMP_DIR"/shards/results/shard-*-agent-output.log \
    "$JOB_TMP_DIR"/shards/results/shard-*-result.json \
    "$JOB_TMP_DIR"/shards/results/shard-*-worker.log \
    "$JOB_TMP_DIR"/shards/results/shard-*-usage.jsonl \
    "$JOB_TMP_DIR"/shards/results/shard-*-checkpoints/*.json \
    "$JOB_TMP_DIR"/shards/results/shard-*-checkpoints/progress/*.json
  do
    [ -e "$_recovery_source" ] || continue
    _recovery_relative="${_recovery_source#$JOB_TMP_DIR/}"
    copy_recovery_file "$_recovery_source" "$_recovery_dir/$_recovery_relative"
  done

  for _worker_log in "$JOB_TMP_DIR"/shards/results/*-worker.log; do
    [ -e "$_worker_log" ] || continue
    copy_tail_file "$_worker_log" "$_debug_dir/worker-log-tails/$(basename "$_worker_log")"
  done

  for _agent_output_log in "$JOB_TMP_DIR"/shards/results/*-agent-output.log; do
    [ -e "$_agent_output_log" ] || continue
    copy_tail_file "$_agent_output_log" "$_debug_dir/agent-output-tails/$(basename "$_agent_output_log")"
  done

  {
    find "$JOB_TMP_DIR" -type f \( \
      -name '*.mp3' -o -name '*.m4a' -o -name '*.aac' -o -name '*.wav' -o -name '*.webm' -o -name '*.opus' -o -name '*.ogg' -o -name '*.flac' \
      -o -name '*.mp4' -o -name '*.mkv' -o -name '*.mov' -o -name '*.part' -o -name '*.ytdl' -o -name '*.frag' \
      -o -name '*.vtt' -o -name '*.srt' -o -name '*.json3' -o -name '*.ttml' \
    \) ! -path "$_debug_dir/*" -print 2>/dev/null || true
  } | while IFS= read -r _artifact; do
    [ -n "$_artifact" ] || continue
    _bytes="$(wc -c < "$_artifact" 2>/dev/null | tr -d ' ' || true)"
    printf '%s\t%s\n' "${_bytes:-0}" "$_artifact"
  done > "$_debug_dir/media-cleanup-manifest.tsv"

  for _path_log in "$JOB_TMP_DIR"/*-agent-output.* "$JOB_TMP_DIR"/shards/results/*-agent-output.log "$JOB_TMP_DIR"/shards/results/*-worker.log; do
    [ -r "$_path_log" ] || continue
    grep -Eo '(/tmp|/var/folders|/Users/[^[:space:]]+/(Downloads|\.cache))[^[:space:]`"'"'"'<>]+' "$_path_log" 2>/dev/null || true
  done | sort -u > "$_debug_dir/external-artifact-warnings.txt"
}

cleanup_job_tmp_dir() {
  _status="$1"
  _reason="${2:-}"
  [ -d "${JOB_TMP_DIR:-}" ] || return 0
  if ! validate_run_tmp_dir; then
    echo "Skipping FollowBrief run cleanup: run temp dir ownership check failed for ${JOB_TMP_DIR:-unset}." >&2
    return 0
  fi
  terminate_job_tmp_processes TERM 3 || true
  case "$_status" in
    succeeded)
      rm -rf "$JOB_TMP_DIR"
      ;;
    *)
      write_cleanup_debug_bundle "$_status" "$_reason"
      find "$JOB_TMP_DIR" -mindepth 1 -maxdepth 1 ! -name debug ! -name .run-owner.json -exec rm -rf {} + 2>/dev/null || true
      ;;
  esac
}

cleanup_old_job_runs() {
  node - "$JOB_STATE_DIR" "$ACCOUNT_SLUG" "$JOB_NAME" <<'NODE' >/dev/null 2>&1 || true
const fs = require("fs");
const path = require("path");
const [stateDir, accountSlug, jobName] = process.argv.slice(2);
const runsDir = path.join(stateDir, "runs");
let currentId = null;
try {
  currentId = JSON.parse(fs.readFileSync(path.join(stateDir, "current.json"), "utf8"))?.instanceId || null;
} catch {}
let entries = [];
try {
  entries = fs.readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
} catch {
  process.exit(0);
}
const now = Date.now();
const oneDay = 24 * 60 * 60 * 1000;
const retainedFailures = [];
for (const entry of entries) {
  const dir = path.join(runsDir, entry.name);
  const ownerFile = path.join(dir, ".run-owner.json");
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
  } catch {
    continue;
  }
  if (owner?.app !== "followbrief" || owner?.accountSlug !== accountSlug || owner?.jobName !== jobName) continue;
  if (owner?.instanceId && owner.instanceId === currentId) continue;
  let summary = {};
  try {
    summary = JSON.parse(fs.readFileSync(path.join(dir, "debug", "runner-summary.json"), "utf8"));
  } catch {}
  const status = String(summary.status || "");
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    continue;
  }
  const ageMs = now - stat.mtimeMs;
  const sevenDays = 7 * oneDay;
  const threshold =
    status === "failed" || status === "timed_out" ? sevenDays :
    status === "killed" || status === "replaced" || status === "stale" ? oneDay :
    oneDay;
  if (status === "failed" || status === "timed_out") {
    retainedFailures.push({ dir, mtimeMs: stat.mtimeMs, ageMs });
    if (ageMs <= threshold) continue;
  } else if (ageMs <= threshold) {
    continue;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
retainedFailures
  .sort((a, b) => b.mtimeMs - a.mtimeMs)
  .slice(5)
  .forEach((entry) => {
    if (entry.ageMs > oneDay) fs.rmSync(entry.dir, { recursive: true, force: true });
  });
NODE
}

prepare_run_tmp_dir() {
  [ -n "${BUILDER_BLOG_JOB_RUN_ID:-}" ] || return 1
  RUNS_DIR="$JOB_STATE_DIR/runs"
  _run_component="$(job_file_component "$BUILDER_BLOG_JOB_RUN_ID")"
  [ -n "$_run_component" ] || _run_component="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  JOB_TMP_DIR="$RUNS_DIR/$_run_component"
  mkdir -p "$JOB_TMP_DIR"
  export BUILDER_BLOG_JOB_STATE_DIR="$JOB_STATE_DIR"
  export BUILDER_BLOG_JOB_TMP_DIR="$JOB_TMP_DIR"
  export BUILDER_BLOG_JOB_TMP_IS_RUN_DIR=1
  write_run_owner_file
  cleanup_old_job_runs
}

TRACKED_JOB_FINALIZED=0
tracked_job_signal_cleanup() {
  _signal="${1:-TERM}"
  [ "$TRACKED_JOB_FINALIZED" = "0" ] || exit 130
  TRACKED_JOB_FINALIZED=1
  trap '' TERM INT
  if [ -n "${RUNTIME_PID:-}" ]; then
    terminate_process_tree "$RUNTIME_PID" TERM 10 || true
    wait "$RUNTIME_PID" 2>/dev/null || true
  fi
  terminate_job_tmp_processes TERM 3 || true
  aggregate_runtime_usage_files || true
  _cleanup_reason="runner_interrupted"
  if [ -n "${BUILDER_BLOG_CURRENT_FILE:-}" ]; then
    clear_current_file "$BUILDER_BLOG_CURRENT_FILE" "${BUILDER_BLOG_JOB_RUN_ID:-}" || true
  fi
  job_run_update killed "Runtime interrupted before normal cleanup completed." "runner_interrupted" \
    --stage "interrupted" \
    --signal "$_signal" || true
  case "$JOB_NAME" in
    library-once|library-cron)
      if flush_library_interrupted_results "runtime-interrupted" "runtime_interrupted"; then
        _cleanup_reason="runner_interrupted_flush_finished"
        job_run_update killed "Runtime interruption cleanup synced terminal library worker results." "runner_interrupted_flush_finished" \
          --stage "sync_to_followbrief" \
          --signal "$_signal" || true
      else
        _flush_code="$?"
        if [ "$_flush_code" -ne 2 ]; then
          _cleanup_reason="runner_interrupted_flush_failed"
          job_run_update killed "Runtime interruption cleanup could not sync every terminal library worker result." "runner_interrupted_flush_failed" \
            --stage "merge_results" \
            --signal "$_signal" || true
        fi
      fi
      ;;
  esac
  cleanup_job_tmp_dir killed "$_cleanup_reason" || true
  exit 130
}

aggregate_runtime_usage_files() {
  [ -n "${BUILDER_BLOG_USAGE_FILE:-}" ] || return 0
  _usage_inputs=""
  for _usage_input in \
    "$JOB_TMP_DIR"/*-agent-usage.* \
    "$JOB_TMP_DIR"/shards/results/shard-*-usage.jsonl
  do
    [ -r "$_usage_input" ] || continue
    _usage_inputs="$_usage_inputs $(shell_quote "$_usage_input")"
  done
  if [ -n "$_usage_inputs" ]; then
    eval "node \"\$AGENT_DIR/builder-digest.mjs\" aggregate-runtime-usage --out \"\$BUILDER_BLOG_USAGE_FILE\" $_usage_inputs >/dev/null 2>&1" || true
    return 0
  fi
  for _usage_input in \
    "$JOB_TMP_DIR"/codex-agent-output.* \
    "$JOB_TMP_DIR"/claude-agent-output.* \
    "$JOB_TMP_DIR"/openclaw-agent-output.* \
    "$JOB_TMP_DIR"/hermes-agent-output.*
  do
    [ -r "$_usage_input" ] || continue
    _usage_inputs="$_usage_inputs $(shell_quote "$_usage_input")"
  done
  [ -n "$_usage_inputs" ] || return 0
  eval "node \"\$AGENT_DIR/builder-digest.mjs\" aggregate-runtime-usage --out \"\$BUILDER_BLOG_USAGE_FILE\" $_usage_inputs >/dev/null 2>&1" || true
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
  aggregate_runtime_usage_files
  _usage_file=""
  if [ -n "${BUILDER_BLOG_USAGE_FILE:-}" ] && [ -r "${BUILDER_BLOG_USAGE_FILE:-}" ]; then
    _usage_file="$BUILDER_BLOG_USAGE_FILE"
  elif [ -n "${LAST_AGENT_USAGE_FILE:-}" ] && [ -r "${LAST_AGENT_USAGE_FILE:-}" ]; then
    _usage_file="$LAST_AGENT_USAGE_FILE"
  elif [ -n "${LAST_AGENT_OUTPUT_FILE:-}" ] && [ -r "${LAST_AGENT_OUTPUT_FILE:-}" ]; then
    _usage_file="$LAST_AGENT_OUTPUT_FILE"
  fi
  _usage_args=""
  if [ -n "$_usage_file" ]; then
    _usage_args="--usage-file"
  fi
  if node "$AGENT_DIR/builder-digest.mjs" job-run-update \
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
    --local-workers "${MAX_PARALLEL_WORKERS:-}" \
    --finished-at "$_finished" \
    --summary "$_summary" \
    --reason "$_reason" \
    ${_usage_args:+"$_usage_args"} ${_usage_file:+"$_usage_file"} \
    "$@" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$_status" = "starting" ]; then
    echo "FollowBrief rejected the runtime job lease; refusing to start stale work." >&2
    return 1
  fi
  return 0
}

verify_followbrief_pid() {
  _pid="${1:-}"
  [ -n "$_pid" ] || return 1
  kill -0 "$_pid" 2>/dev/null || return 1
  _args="$(ps -p "$_pid" -o command= 2>/dev/null || true)"
  # The workerPid recorded in current.json is always the runner shell ($$),
  # whose argv contains this script name (re-execs preserve it, and worker mode
  # only sets BUILDER_BLOG_WORKER_MODE=1 as an env var, which never appears in
  # `ps -o command=`). Matching the generic runtime commands (claude -p,
  # openclaw, codex exec, hermes chat) here only produced false positives: a
  # recycled PID belonging to the user's own interactive runtime got accepted
  # and then killed/blocked. Anchor identity to this runner script alone.
  printf '%s' "$_args" | grep -qF "builder-agent-runner.sh" || return 1
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

  # If the root is one of this shell's background workers, reap it before the
  # next command gives /bin/sh a chance to print a job-status diagnostic.
  # `wait` fails harmlessly for non-child pids handled by other callers.
  wait "$tpt_root" >/dev/null 2>&1 || true

  tpt_left="$tpt_wait_seconds"
  while [ "$tpt_left" -gt 0 ]; do
    tpt_alive=0
    for tpt_pid in $tpt_targets; do
      if kill -0 "$tpt_pid" 2>/dev/null; then
        tpt_alive=1
        break
      fi
    done
    if [ "$tpt_alive" -eq 0 ]; then
      # Reap an owned background worker before returning. On macOS /bin/sh,
      # leaving the dead child pending until the caller's next command prints
      # a noisy `Terminated: 15 ( ... )` job diagnostic into an otherwise
      # successful fetch log.
      wait "$tpt_root" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
    tpt_left=$(( tpt_left - 1 ))
  done
  return 1
}

job_tmp_process_pids() {
  [ -n "${JOB_TMP_DIR:-}" ] || return 0
  # Match only the current owned run directory. This catches orphaned fetch
  # tools whose command line still references output files under this run.
  ps -axo pid=,command= 2>/dev/null | awk -v dir="$JOB_TMP_DIR" -v self="$$" '
    index($0, "awk -v dir=") { next }
    index($0, dir) {
      pid = $1
      if (pid ~ /^[0-9]+$/ && pid != self) print pid
    }
  ' | sort -u
}

terminate_job_tmp_processes() {
  _tjtp_signal="${1:-TERM}"
  _tjtp_wait_seconds="${2:-3}"
  validate_run_tmp_dir || return 0
  _tjtp_pids="$(job_tmp_process_pids)"
  [ -n "$_tjtp_pids" ] || return 0

  for _tjtp_pid in $_tjtp_pids; do
    kill -s "$_tjtp_signal" "$_tjtp_pid" 2>/dev/null || true
  done

  _tjtp_left="$_tjtp_wait_seconds"
  while [ "$_tjtp_left" -gt 0 ]; do
    _tjtp_alive=0
    for _tjtp_pid in $_tjtp_pids; do
      if kill -0 "$_tjtp_pid" 2>/dev/null; then
        _tjtp_alive=1
        break
      fi
    done
    [ "$_tjtp_alive" -eq 0 ] && return 0
    sleep 1
    _tjtp_left=$(( _tjtp_left - 1 ))
  done

  for _tjtp_pid in $_tjtp_pids; do
    kill -KILL "$_tjtp_pid" 2>/dev/null || true
  done
  return 0
}

cleanup_transient_job_artifacts() {
  validate_run_tmp_dir || return 0
  terminate_job_tmp_processes TERM 3 || true
  find "$JOB_TMP_DIR" -mindepth 1 -maxdepth 1 \( -name 'fetch-*' -o -name 'youtube-asr' \) -exec rm -rf {} + 2>/dev/null || true
}

write_worker_control_event() {
  _wwce_path="${1:-}"
  _wwce_reason="${2:-}"
  _wwce_worker="${3:-}"
  _wwce_shard="${4:-}"
  _wwce_message="${5:-}"
  [ -n "$_wwce_path" ] || return 0
  [ -n "$_wwce_reason" ] || return 0
  node - "$_wwce_path" "$_wwce_reason" "$_wwce_worker" "$_wwce_shard" "$_wwce_message" <<'NODE' 2>/dev/null || true
const fs = require("fs");
const [file, reason, worker, shard, message] = process.argv.slice(2);
fs.appendFileSync(file, `${JSON.stringify({
  type: "followbrief_worker_event",
  reason,
  worker,
  shard,
  message,
  at: new Date().toISOString(),
})}\n`);
NODE
}

worker_log_has_failed_turn() {
  _wlhft_log="${1:-}"
  [ -r "$_wlhft_log" ] || return 1
  node - "$_wlhft_log" <<'NODE'
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/);
for (const line of lines) {
  try {
    const event = JSON.parse(line);
    if (event?.type === "turn.failed") process.exit(0);
  } catch {}
}
process.exit(1);
NODE
}

worker_log_has_runtime_auth_failure() {
  _wlhrf_log="${1:-}"
  [ -r "$_wlhrf_log" ] || return 1
  if grep -Eq 'Codex auth is missing access_token|hermes auth.*re-authenticate|hermes model.*re-authenticate' "$_wlhrf_log"; then
    return 0
  fi
  grep -Eq 'auth error code: token_expired|Provided authentication token is expired|"code"[[:space:]]*:[[:space:]]*"token_expired"' "$_wlhrf_log" || return 1
  worker_log_has_failed_turn "$_wlhrf_log"
}

record_worker_runtime_auth_failure() {
  _wrraf_name="${1:-}"
  _wrraf_lane="${2:-}"
  _wrraf_worker_log="$_results_dir/$_wrraf_name-worker.log"
  _wrraf_agent_log="$_results_dir/$_wrraf_name-agent-output.log"
  grep -q '"reason":"runtime_auth_failed"' "$_wrraf_worker_log" 2>/dev/null && return 0
  if worker_log_has_runtime_auth_failure "$_wrraf_worker_log" || worker_log_has_runtime_auth_failure "$_wrraf_agent_log"; then
    write_worker_control_event \
      "$_wrraf_worker_log" \
      "runtime_auth_failed" \
      "$_wrraf_lane" \
      "$_wrraf_name" \
      "The selected agent runtime could not refresh its authentication token."
  fi
}

worker_log_has_backgrounded_tool() {
  _wlbt_log="${1:-}"
  [ -n "$_wlbt_log" ] || return 1
  [ -r "$_wlbt_log" ] || return 1
  node - "$_wlbt_log" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
for (const line of lines) {
  if (!line.trim()) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (
    event &&
    event.type === "system" &&
    event.subtype === "task_updated" &&
    event.is_backgrounded === true
  ) {
    process.exit(0);
  }
}
process.exit(1);
NODE
}

worker_no_progress_timeout_seconds() {
  _wnpts_shard_timeout="${1:-0}"
  _wnpts_timeout="${BUILDER_BLOG_WORKER_NO_PROGRESS_SECONDS:-600}"
  case "$_wnpts_timeout" in
    ''|*[!0-9]*) _wnpts_timeout=600 ;;
  esac
  if [ "$_wnpts_timeout" -lt 60 ]; then
    _wnpts_timeout=60
  fi
  case "$_wnpts_shard_timeout" in
    ''|*[!0-9]*) _wnpts_shard_timeout=0 ;;
  esac
  if [ "$_wnpts_shard_timeout" -gt 0 ] && [ "$_wnpts_timeout" -ge "$_wnpts_shard_timeout" ]; then
    _wnpts_timeout=$(( _wnpts_shard_timeout / 3 ))
    if [ "$_wnpts_timeout" -lt 60 ]; then
      _wnpts_timeout=60
    fi
  fi
  printf '%s\n' "$_wnpts_timeout"
}

worker_stall_timeout_seconds() {
  _wsts_shard_timeout="${1:-0}"
  _wsts_timeout="${BUILDER_BLOG_WORKER_STALL_SECONDS:-600}"
  case "$_wsts_timeout" in
    ''|*[!0-9]*) _wsts_timeout=600 ;;
  esac
  if [ "$_wsts_timeout" -lt 120 ]; then
    _wsts_timeout=120
  fi
  case "$_wsts_shard_timeout" in
    ''|*[!0-9]*) _wsts_shard_timeout=0 ;;
  esac
  if [ "$_wsts_shard_timeout" -gt 0 ] && [ "$_wsts_timeout" -ge "$_wsts_shard_timeout" ]; then
    _wsts_timeout=$(( _wsts_shard_timeout / 2 ))
    if [ "$_wsts_timeout" -lt 120 ]; then
      _wsts_timeout=120
    fi
  fi
  printf '%s\n' "$_wsts_timeout"
}

worker_progress_mtime_seconds() {
  _wpms_result_path="${1:-}"
  _wpms_checkpoint_dir="${2:-}"
  node - "$_wpms_result_path" "$_wpms_checkpoint_dir" <<'NODE' 2>/dev/null || printf '0\n'
const fs = require("fs");
const path = require("path");
const [resultPath, checkpointDir] = process.argv.slice(2);
let latest = 0;
function resultFileHasTerminalProgress(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const builders = Array.isArray(payload?.builders) ? payload.builders : [];
    if (builders.some((builder) => Array.isArray(builder?.items) && builder.items.length > 0)) return true;
    if (Array.isArray(payload?.taskOutcomes) && payload.taskOutcomes.length > 0) return true;
  } catch {}
  return false;
}
function addFile(file, options = {}) {
  if (!file) return;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) return;
    if (options.requireTerminalProgress && !resultFileHasTerminalProgress(file)) return;
    latest = Math.max(latest, stat.mtimeMs);
  } catch {}
}
function walk(dir) {
  if (!dir) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) addFile(full);
  }
}
addFile(resultPath, { requireTerminalProgress: true });
walk(checkpointDir);
console.log(String(Math.floor(latest / 1000)));
NODE
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
// The installed daily/weekly schedule fires at a fixed LOCAL wall-clock time,
// while the anchor+N*interval expectation is measured in fixed UTC intervals.
// Across a DST transition the local schedule drifts up to an hour relative to
// UTC, so for day-or-longer intervals allow just over an hour of tolerance to
// absorb the spring-forward shift (otherwise slotIndex resolves to the prior,
// already-fired slot and the day is silently skipped). Sub-day intervals keep
// the minute-level slack.
const maxToleranceMs = intervalMs >= 24 * 60 * 60 * 1000 ? 65 * 60 * 1000 : 5 * 60 * 1000;
const toleranceMs = Math.min(maxToleranceMs, Math.max(0, intervalMs / 4));
const elapsed = nowMs - anchorMs;
if (elapsed + toleranceMs < intervalMs) process.exit(1);
const slotIndex = Math.floor((elapsed + toleranceMs) / intervalMs);
console.log(new Date(anchorMs + slotIndex * intervalMs).toISOString().replace(/\.\d{3}Z$/, "Z"));
NODE
}

cron_owner_id_file() {
  printf '%s\n' "$AGENT_DIR/cron-owner-$JOB_NAME-$ACCOUNT_SLUG"
}

ensure_cron_owner_id() {
  _coi_file="$(cron_owner_id_file)"
  if [ -s "$_coi_file" ]; then
    sed -n '1p' "$_coi_file"
    return 0
  fi
  _coi_id="$(
    node - "$JOB_NAME" "$ACCOUNT_SLUG" <<'NODE'
const { randomUUID } = require("node:crypto");
const os = require("node:os");
const [job, accountSlug] = process.argv.slice(2);
const host = (os.hostname() || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
console.log(`local:${host}:${accountSlug}:${job}:${randomUUID()}`);
NODE
  )"
  printf '%s\n' "$_coi_id" > "$_coi_file"
  chmod 600 "$_coi_file" 2>/dev/null || true
  printf '%s\n' "$_coi_id"
}

remove_local_cron_schedule() {
  _rlcs_reason="${1:-server_guard_stop}"
  case "$JOB_NAME" in
    library-cron)
      _rlcs_kind="library"
      _rlcs_marker="FollowBrief library cron"
      ;;
    digest-cron)
      _rlcs_kind="digest"
      _rlcs_marker="FollowBrief digest cron"
      ;;
    *) return 0 ;;
  esac

  _rlcs_acct="${BUILDER_BLOG_ACCOUNT:-}"
  _rlcs_label="com.followbrief.$_rlcs_kind.$(account_slug "${_rlcs_acct:-default}")"
  _rlcs_legacy_label="com.followbrief.$_rlcs_kind.$(legacy_account_slug "${_rlcs_acct:-default}")"

  if [ "$(uname 2>/dev/null || printf unknown)" = "Darwin" ]; then
    _rlcs_labels="$_rlcs_label"
    [ "$_rlcs_legacy_label" = "$_rlcs_label" ] || _rlcs_labels="$_rlcs_labels $_rlcs_legacy_label"
    for _rlcs_current_label in $_rlcs_labels; do
      _rlcs_plist="$HOME/Library/LaunchAgents/$_rlcs_current_label.plist"
      if launchctl print "gui/$(id -u)/$_rlcs_current_label" >/dev/null 2>&1; then
        _rlcs_loaded=1
      else
        _rlcs_loaded=0
      fi
      if [ -f "$_rlcs_plist" ]; then
        _rlcs_plist_exists=1
      else
        _rlcs_plist_exists=0
      fi
      if [ "$_rlcs_loaded" = "1" ] || [ "$_rlcs_plist_exists" = "1" ]; then
        node "$AGENT_DIR/builder-digest.mjs" cron-audit --job "$JOB_NAME" --event launchd_self_uninstall_start --label "$_rlcs_current_label" --plist-exists "$_rlcs_plist_exists" --launchctl-loaded "$_rlcs_loaded" --reason "$_rlcs_reason" || true
        launchctl bootout "gui/$(id -u)/$_rlcs_current_label" 2>/dev/null || true
        rm -f "$_rlcs_plist" 2>/dev/null || true
        node "$AGENT_DIR/builder-digest.mjs" cron-audit --job "$JOB_NAME" --event launchd_self_uninstall_finished --label "$_rlcs_current_label" --plist-exists "$([ -f "$_rlcs_plist" ] && echo 1 || echo 0)" --launchctl-loaded 0 --reason "$_rlcs_reason" || true
      fi
    done
  else
    if [ -n "$_rlcs_acct" ]; then
      crontab -l 2>/dev/null | grep -v "# $_rlcs_marker · $_rlcs_acct" | grep -v "BUILDER_BLOG_ACCOUNT=\"$_rlcs_acct\".*builder-agent-runner.sh $JOB_NAME" | crontab - 2>/dev/null || true
    else
      crontab -l 2>/dev/null | grep -v "# $_rlcs_marker" | grep -v "builder-agent-runner.sh $JOB_NAME" | crontab - 2>/dev/null || true
    fi
    node "$AGENT_DIR/builder-digest.mjs" cron-audit --job "$JOB_NAME" --event crontab_self_uninstall_succeeded --label "$_rlcs_label" --reason "$_rlcs_reason" || true
  fi

  rm -f \
    "$(cron_owner_id_file)" \
    "$AGENT_DIR/runtime-$JOB_NAME-$ACCOUNT_SLUG" \
    "$AGENT_DIR/schedule-anchor-$JOB_NAME-$ACCOUNT_SLUG" \
    "$AGENT_DIR/fetch-force-$JOB_NAME-$ACCOUNT_SLUG" \
    "$AGENT_DIR/fetch-days-$JOB_NAME-$ACCOUNT_SLUG" \
    "$AGENT_DIR/parallel-$JOB_NAME-$ACCOUNT_SLUG" \
    "$AGENT_DIR/regenerate-$JOB_NAME-$ACCOUNT_SLUG" \
    2>/dev/null || true
}

cron_server_guard() {
  case "$JOB_NAME" in
    library-cron|digest-cron) ;;
    *) return 0 ;;
  esac
  if [ "${BUILDER_BLOG_DISABLE_WEB_SYNC:-0}" = "1" ]; then return 0; fi
  _csg_owner_id="$(ensure_cron_owner_id)"
  _csg_out="$JOB_STATE_DIR/cron-guard.json"
  _csg_err="$JOB_STATE_DIR/cron-guard.err"
  if node "$AGENT_DIR/builder-digest.mjs" cron-guard --job "$JOB_NAME" --owner-id "$_csg_owner_id" > "$_csg_out" 2> "$_csg_err"; then
    return 0
  fi
  _csg_decision="$(json_get_string decision "$_csg_out")"
  if [ "$_csg_decision" != "stop" ]; then
    printf 'FollowBrief server guard could not verify %s; keeping local schedule for this run.\n' "$JOB_NAME" >&2
    cat "$_csg_err" >&2 2>/dev/null || true
    return 0
  fi
  _csg_reason="$(json_get_string reason "$_csg_out")"
  [ -n "$_csg_reason" ] || _csg_reason="cron_guard_rejected"
  printf 'FollowBrief server no longer authorizes this %s schedule (%s). Removing local scheduler state.\n' "$JOB_NAME" "$_csg_reason" >&2
  remove_local_cron_schedule "$_csg_reason"
  return 75
}

job_run_update_for_instance() {
  _target_instance="$1"
  _target_started="$2"
  _target_expected="$3"
  shift 3

  _saved_instance="${BUILDER_BLOG_JOB_RUN_ID:-}"
  _saved_started="${BUILDER_BLOG_JOB_STARTED_AT:-}"
  _saved_expected="${BUILDER_BLOG_EXPECTED_AT:-}"
  _saved_usage_file="${BUILDER_BLOG_USAGE_FILE:-}"
  _saved_last_agent_output="${LAST_AGENT_OUTPUT_FILE:-}"
  _saved_last_agent_usage="${LAST_AGENT_USAGE_FILE:-}"

  BUILDER_BLOG_JOB_RUN_ID="$_target_instance"
  if [ -n "$_target_started" ]; then
    BUILDER_BLOG_JOB_STARTED_AT="$_target_started"
  fi
  if [ -n "$_target_expected" ]; then
    BUILDER_BLOG_EXPECTED_AT="$_target_expected"
  elif [ -n "$_target_started" ]; then
    BUILDER_BLOG_EXPECTED_AT="$_target_started"
  fi
  unset BUILDER_BLOG_USAGE_FILE
  unset LAST_AGENT_OUTPUT_FILE
  unset LAST_AGENT_USAGE_FILE
  export BUILDER_BLOG_JOB_RUN_ID BUILDER_BLOG_JOB_STARTED_AT BUILDER_BLOG_EXPECTED_AT

  job_run_update "$@"

  BUILDER_BLOG_JOB_RUN_ID="$_saved_instance"
  BUILDER_BLOG_JOB_STARTED_AT="$_saved_started"
  BUILDER_BLOG_EXPECTED_AT="$_saved_expected"
  if [ -n "$_saved_usage_file" ]; then
    BUILDER_BLOG_USAGE_FILE="$_saved_usage_file"
    export BUILDER_BLOG_USAGE_FILE
  else
    unset BUILDER_BLOG_USAGE_FILE
  fi
  if [ -n "$_saved_last_agent_output" ]; then
    LAST_AGENT_OUTPUT_FILE="$_saved_last_agent_output"
    export LAST_AGENT_OUTPUT_FILE
  else
    unset LAST_AGENT_OUTPUT_FILE
  fi
  if [ -n "$_saved_last_agent_usage" ]; then
    LAST_AGENT_USAGE_FILE="$_saved_last_agent_usage"
    export LAST_AGENT_USAGE_FILE
  else
    unset LAST_AGENT_USAGE_FILE
  fi
  export BUILDER_BLOG_JOB_RUN_ID BUILDER_BLOG_JOB_STARTED_AT BUILDER_BLOG_EXPECTED_AT
}

run_cron_supervisor() {
  INSTANCE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  STARTED_AT="$(iso_now)"
  EXPECTED_AT="$STARTED_AT"
  CURRENT_FILE="$JOB_STATE_DIR/current.json"
  export BUILDER_BLOG_JOB_RUN_ID="$INSTANCE_ID"
  export BUILDER_BLOG_JOB_TRIGGER="${BUILDER_BLOG_JOB_TRIGGER:-scheduled}"
  export BUILDER_BLOG_SCHEDULE_JOB="$JOB_NAME"
  export BUILDER_BLOG_EXPECTED_AT="$EXPECTED_AT"
  export BUILDER_BLOG_JOB_STARTED_AT="$STARTED_AT"
  export BUILDER_BLOG_RUNNER_PID="$$"

  if ! cron_server_guard; then
    exit 0
  fi

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
  CURRENT_FILE="$JOB_STATE_DIR/current.json"
  EXPECTED_AT="$(due_expected_at || true)"
  if [ -z "$EXPECTED_AT" ]; then
    return 0
  fi

  LAST_FIRED_FILE="$(scheduler_last_fired_file)"
  if [ -r "$LAST_FIRED_FILE" ] && [ "$(cat "$LAST_FIRED_FILE" 2>/dev/null || true)" = "$EXPECTED_AT" ]; then
    reconcile_current_file "$CURRENT_FILE"
    return 0
  fi

  self_update_and_reexec "$JOB_NAME"
  if ! cron_server_guard; then
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
  BUILDER_BLOG_JOB_STATE_DIR="$JOB_STATE_DIR"
  BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH=1
  BUILDER_BLOG_RUNNER_UPDATED=1
  unset BUILDER_BLOG_JOB_TMP_DIR
  unset BUILDER_BLOG_JOB_TMP_IS_RUN_DIR
  unset BUILDER_BLOG_RUNNER_PID
  export BUILDER_BLOG_SCHEDULER_TICK BUILDER_BLOG_WORKER_MODE BUILDER_BLOG_JOB_TRIGGER
  export BUILDER_BLOG_SCHEDULE_JOB BUILDER_BLOG_JOB_RUN_ID BUILDER_BLOG_EXPECTED_AT
  export BUILDER_BLOG_JOB_STARTED_AT BUILDER_BLOG_CURRENT_FILE BUILDER_BLOG_JOB_STATE_DIR
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
  CURRENT_FILE="$JOB_STATE_DIR/current.json"

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
  export BUILDER_BLOG_JOB_STATE_DIR="$JOB_STATE_DIR"
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

cloud_host_idle_seconds() {
  _value="${BUILDER_BLOG_CLOUD_IDLE_SECONDS:-300}"
  case "$_value" in
    ''|*[!0-9]*) _value=300 ;;
  esac
  if [ "$_value" -lt 30 ]; then _value=30; fi
  if [ "$_value" -gt 3600 ]; then _value=3600; fi
  printf '%s\n' "$_value"
}

cloud_host_signal_cleanup() {
  _signal="${1:-TERM}"
  terminate_job_tmp_processes TERM 3 || true
  aggregate_runtime_usage_files || true
  job_run_update killed "Worker host interrupted before normal shutdown." "worker_host_interrupted" \
    --stage "interrupted" \
    --signal "$_signal" || true
  cleanup_job_tmp_dir killed "worker_host_interrupted" || true
  cleanup_old_job_runs
  if [ -n "${CLOUD_HOST_CURRENT_FILE:-}" ]; then
    clear_current_file "$CLOUD_HOST_CURRENT_FILE" "${BUILDER_BLOG_JOB_RUN_ID:-}" || true
  fi
  exit 130
}

cloud_host_sleep_with_heartbeat() {
  _remaining="${1:-$(cloud_host_idle_seconds)}"
  case "$_remaining" in
    ''|*[!0-9]*) _remaining="$(cloud_host_idle_seconds)" ;;
  esac
  while [ "$_remaining" -gt 0 ]; do
    _chunk="$HEARTBEAT_INTERVAL_SECONDS"
    if [ "$_chunk" -gt "$_remaining" ]; then _chunk="$_remaining"; fi
    sleep "$_chunk"
    _remaining=$(( _remaining - _chunk ))
    job_run_update running "Worker host idle; waiting before asking cloud for more sources." "worker_host_idle" \
      --stage "waiting_for_cloud_sources"
  done
}

run_cloud_worker_host() {
  INSTANCE_ID="${BUILDER_BLOG_JOB_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-host-$$}"
  STARTED_AT="${BUILDER_BLOG_JOB_STARTED_AT:-$(iso_now)}"
  EXPECTED_AT="${BUILDER_BLOG_EXPECTED_AT:-$STARTED_AT}"
  CURRENT_FILE="$JOB_STATE_DIR/current.json"
  CLOUD_HOST_CURRENT_FILE="$CURRENT_FILE"
  export BUILDER_BLOG_JOB_RUN_ID="$INSTANCE_ID"
  export BUILDER_BLOG_JOB_TRIGGER="manual_cli"
  export BUILDER_BLOG_SCHEDULE_JOB=""
  export BUILDER_BLOG_EXPECTED_AT="$EXPECTED_AT"
  export BUILDER_BLOG_JOB_STARTED_AT="$STARTED_AT"
  export BUILDER_BLOG_RUNNER_PID="${BUILDER_BLOG_RUNNER_PID:-$$}"
  export BUILDER_BLOG_WORKER_PID="$$"
  BUILDER_BLOG_RUN_SOURCE=cloud
  export BUILDER_BLOG_RUN_SOURCE

  if [ -r "$CURRENT_FILE" ]; then
    OLD_PID="$(json_get_number workerPid "$CURRENT_FILE")"
    OLD_INSTANCE="$(json_get_string instanceId "$CURRENT_FILE")"
    OLD_STARTED="$(json_get_string startedAt "$CURRENT_FILE")"
    OLD_EXPECTED="$(json_get_string expectedAt "$CURRENT_FILE")"
    if [ -n "$OLD_PID" ] && [ "$OLD_PID" != "$$" ] && verify_followbrief_pid "$OLD_PID"; then
      if [ "${BUILDER_BLOG_REPLACE_ACTIVE_CLOUD_HOST:-0}" != "1" ]; then
        echo "A FollowBrief cloud worker host is already active for ${BUILDER_BLOG_ACCOUNT:-default}." >&2
        echo "Active pid: $OLD_PID${OLD_INSTANCE:+ · instance: $OLD_INSTANCE}" >&2
        echo "Stop it first, or re-run with BUILDER_BLOG_REPLACE_ACTIVE_CLOUD_HOST=1 after explicit admin confirmation." >&2
        return 75
      fi
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        replaced "Replaced by a newer worker host." "status replaced worker_host_replace_requested"
      terminate_process_tree "$OLD_PID" TERM 30 || terminate_process_tree "$OLD_PID" KILL 3 || true
      if verify_followbrief_pid "$OLD_PID"; then
        job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
          killed "Previous worker host could not be stopped before replacement." "status killed worker_host_replace_failed"
        echo "Previous FollowBrief cloud worker host is still active after forced termination; not starting a second host." >&2
        return 75
      fi
      clear_current_file "$CURRENT_FILE" "$OLD_INSTANCE"
    elif [ -n "$OLD_INSTANCE" ]; then
      job_run_update_for_instance "$OLD_INSTANCE" "$OLD_STARTED" "$OLD_EXPECTED" \
        stale "Previous worker host pid was no longer alive." "stale_pid_worker_host"
      clear_current_file "$CURRENT_FILE" "$OLD_INSTANCE"
    fi
  fi

  write_current_file "$CURRENT_FILE" "$INSTANCE_ID" "$BUILDER_BLOG_WORKER_PID" "$STARTED_AT" "$EXPECTED_AT"
  prepare_run_tmp_dir
  _usage_key="$(job_file_component "$BUILDER_BLOG_JOB_RUN_ID")"
  export BUILDER_BLOG_USAGE_FILE="$JOB_TMP_DIR/runtime-usage-$_usage_key.jsonl"
  trap 'cloud_host_signal_cleanup TERM' TERM
  trap 'cloud_host_signal_cleanup INT' INT
  if ! job_run_update starting "Worker host accepted by local runner." "worker_host_started" \
    --stage "worker_host_starting"; then
    clear_current_file "$CURRENT_FILE" "$INSTANCE_ID"
    cleanup_job_tmp_dir killed "worker_host_lease_rejected"
    return 1
  fi

  BUILDER_BLOG_CLOUD_PERSISTENT_HOST=1
  export BUILDER_BLOG_CLOUD_PERSISTENT_HOST
  set +e
  run_library_job fetch-cloud-library sync-cloud-builders cloud-fetch-result.json "cloud library host"
  _code="$?"
  set -e
  clear_current_file "$CURRENT_FILE" "$INSTANCE_ID"
  if [ "$_code" -eq 0 ]; then
    job_run_update succeeded "Worker host stopped." "worker_host_stopped" --stage "stopped"
    _cleanup_status="succeeded"
    _cleanup_reason="worker_host_stopped"
  else
    job_run_update failed "Worker host exited with code $_code." "worker_host_failed" \
      --stage "failed" \
      --exit-code "$_code"
    _cleanup_status="failed"
    _cleanup_reason="worker_host_failed"
  fi
  cleanup_job_tmp_dir "$_cleanup_status" "$_cleanup_reason"
  cleanup_old_job_runs
  return "$_code"
}

flush_library_interrupted_results() {
  _flir_label="$1"
  _flir_missing_reason="$2"
  _flir_result_file="$JOB_TMP_DIR/library-fetch-result.json"
  _flir_results_dir="$JOB_TMP_DIR/shards/results"
  _flir_checkpoint_synced_ids_file="$JOB_TMP_DIR/completed-checkpoint-synced-task-ids.txt"
  _flir_recovery_dir="$JOB_TMP_DIR/debug/recovery"
  if [ ! -s "$_flir_result_file" ] && [ -s "$_flir_recovery_dir/library-fetch-result.json" ]; then
    _flir_result_file="$_flir_recovery_dir/library-fetch-result.json"
    _flir_results_dir="$_flir_recovery_dir/shards/results"
    _flir_checkpoint_synced_ids_file="$_flir_recovery_dir/completed-checkpoint-synced-task-ids.txt"
  fi
  if [ ! -s "$_flir_result_file" ]; then
    return 2
  fi
  mkdir -p "$_flir_results_dir"
  [ -s "$_flir_checkpoint_synced_ids_file" ] || : > "$_flir_checkpoint_synced_ids_file"
  _flir_shard_timeout="$(shard_timeout_seconds "$(job_timeout_seconds)")"
  sync_completed_checkpoints "$_flir_result_file" "$_flir_results_dir" "$_flir_checkpoint_synced_ids_file" || true
  flush_remaining_library_results "$_flir_result_file" "$_flir_results_dir" "$_flir_checkpoint_synced_ids_file" "$_flir_shard_timeout" "$_flir_label" "$_flir_missing_reason"
}

finalize_library_timeout_results() {
  case "$JOB_NAME" in
    library-once|library-cron) ;;
    *) return 0 ;;
  esac
  job_run_update running "Runtime timed out; syncing terminal library results." "runtime_timeout_flush_started" \
    --stage "merge_results" \
    --timeout-stage "runtime" || true
  if flush_library_interrupted_results "runtime-timeout" "runtime_timeout"; then
    :
  else
    _fltr_code="$?"
    if [ "$_fltr_code" -eq 2 ]; then
      job_run_update timed_out "Runtime timed out before source fetch planning completed." "runtime_timeout_no_fetch_result" \
        --stage "fetch_sources" \
        --timeout-stage "runtime" || true
      return 0
    fi
    job_run_update timed_out "Runtime timed out and remaining library worker results could not be fully synced." "runtime_timeout_flush_failed" \
      --stage "merge_results" \
      --timeout-stage "runtime" || true
    return 1
  fi
  job_run_update timed_out "Runtime timed out after syncing completed library worker results." "runtime_timeout_flush_finished" \
    --stage "sync_to_followbrief" \
    --timeout-stage "runtime" || true
}

run_with_job_tracking() {
  _trigger="$1"
  TRACKED_JOB_FINALIZED=0
  export BUILDER_BLOG_JOB_TRIGGER="$_trigger"
  export BUILDER_BLOG_SCHEDULE_JOB="$(schedule_job_for_name)"
  export BUILDER_BLOG_JOB_RUN_ID="${BUILDER_BLOG_JOB_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
  export BUILDER_BLOG_JOB_STARTED_AT="${BUILDER_BLOG_JOB_STARTED_AT:-$(iso_now)}"
  export BUILDER_BLOG_EXPECTED_AT="${BUILDER_BLOG_EXPECTED_AT:-$BUILDER_BLOG_JOB_STARTED_AT}"
  prepare_run_tmp_dir
  trap 'tracked_job_signal_cleanup TERM' TERM
  trap 'tracked_job_signal_cleanup INT' INT
  _usage_key="$(job_file_component "$BUILDER_BLOG_JOB_RUN_ID")"
  export BUILDER_BLOG_USAGE_FILE="$JOB_TMP_DIR/runtime-usage-$_usage_key.jsonl"
  rm -f "$BUILDER_BLOG_USAGE_FILE" \
    "$JOB_TMP_DIR"/*-agent-usage.* \
    "$JOB_TMP_DIR"/shards/results/shard-*-usage.jsonl \
    "$JOB_TMP_DIR"/codex-agent-output.* \
    "$JOB_TMP_DIR"/claude-agent-output.* \
    "$JOB_TMP_DIR"/openclaw-agent-output.* \
    "$JOB_TMP_DIR"/hermes-agent-output.* 2>/dev/null || true
  export BUILDER_BLOG_WORKER_PID="$$"
  export BUILDER_BLOG_RUNNER_PID="${BUILDER_BLOG_RUNNER_PID:-$$}"
  _run_started_epoch_seconds="$(job_started_epoch_seconds)"
  if [ "$_trigger" = "scheduled" ]; then
    BUILDER_BLOG_RUN_SOURCE=cron
  else
    BUILDER_BLOG_RUN_SOURCE=manual
  fi
  export BUILDER_BLOG_RUN_SOURCE

  if ! job_run_update starting "Runtime job accepted by local runner." "runtime_job_started"; then
    return 1
  fi
  job_run_update running "Runtime agent started." "runtime_agent_started"
  run_job_payload &
  RUNTIME_PID="$!"
  _elapsed=0
  _status="succeeded"
  while kill -0 "$RUNTIME_PID" 2>/dev/null; do
    _deadline_epoch="$(current_outer_deadline_epoch_seconds)"
    _timeout="$(( _deadline_epoch - _run_started_epoch_seconds ))"
    if [ "$_timeout" -lt 0 ]; then _timeout=0; fi
    _now_epoch="$(date +%s)"
    if [ "$_now_epoch" -ge "$_deadline_epoch" ]; then
      _status="timed_out"
      job_run_update running "Runtime exceeded timeout and will be terminated." "timeout_seconds_for_job" \
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
      job_run_update running "Runtime timed out; cleanup started." "timeout_seconds_for_job" \
        --timeout-seconds "$_timeout" \
        --timeout-stage "runtime" \
        --timed-out-worker-pid "$RUNTIME_PID" \
        --termination "$_termination"
      finalize_library_timeout_results || true
      case "$JOB_NAME" in
        library-once|library-cron) ;;
        *)
          job_run_update timed_out "Runtime timed out." "timeout_seconds_for_job" \
            --timeout-seconds "$_timeout" \
            --timeout-stage "runtime" \
            --timed-out-worker-pid "$RUNTIME_PID" \
            --termination "$_termination"
          ;;
      esac
      TRACKED_JOB_FINALIZED=1
      cleanup_job_tmp_dir timed_out "timeout_seconds_for_job"
      cleanup_old_job_runs
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
  _cleanup_status="succeeded"
  _cleanup_reason="runtime_finished"
  if [ "$_code" -eq 0 ]; then
    if [ "$JOB_NAME" = "digest-once" ] || [ "$JOB_NAME" = "digest-cron" ]; then
      _digest_final_context="$JOB_TMP_DIR/builder-blog-context.json"
      _digest_final_count=""
      if [ -s "$_digest_final_context" ]; then
        _digest_final_count="$(digest_context_item_count "$_digest_final_context" 2>/dev/null || true)"
      fi
      if [ "$_digest_final_count" = "0" ]; then
        job_run_update succeeded "No update. Prepared 0 candidates." "no_update" \
          --stage "no_update" \
          --exit-code "$_code"
        _cleanup_reason="no_update"
      else
        job_run_update succeeded "Runtime completed successfully." "runtime_finished" \
          --stage "completed" \
          --exit-code "$_code"
      fi
    else
      job_run_update succeeded "Runtime completed successfully." "runtime_finished" \
        --stage "completed" \
        --exit-code "$_code"
    fi
  elif [ "$_code" -eq 124 ]; then
    _cleanup_status="timed_out"
    _cleanup_reason="runtime_reported_timeout"
    job_run_update timed_out "Runtime reported a timeout." "runtime_reported_timeout" \
      --exit-code "$_code"
  else
    _cleanup_status="failed"
    _cleanup_reason="runtime_finished"
    job_run_update failed "Runtime exited with code $_code." "runtime_finished" \
      --exit-code "$_code"
  fi
  TRACKED_JOB_FINALIZED=1
  cleanup_job_tmp_dir "$_cleanup_status" "$_cleanup_reason"
  cleanup_old_job_runs
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
        if [ "$INCOMING_RUNTIME_SET" = "1" ]; then
          echo "Selected runtime '$PINNED_RUNTIME' is not on PATH for this one-time run." >&2
          exit 78
        fi
        echo "Pinned runtime '$PINNED_RUNTIME' not on PATH for this one-time run; falling back to the discovery chain." >&2
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
    elif { [ "$JOB_NAME" = "library-cron" ] || [ "$JOB_NAME" = "library-once" ] || [ "$JOB_NAME" = "cloud-library-cron" ]; } && [ -z "${BUILDER_BLOG_LIBRARY_AGENT_STAGE:-}" ]; then
      run_shell_library_fallback
    elif [ "$JOB_NAME" = "library-cron" ] || [ "$JOB_NAME" = "library-once" ] || [ "$JOB_NAME" = "cloud-library-cron" ]; then
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
    cloud-library-cron)
      BUILDER_BLOG_RUN_SOURCE=cloud
      export BUILDER_BLOG_RUN_SOURCE
      run_library_job fetch-cloud-library sync-cloud-builders cloud-fetch-result.json "cloud library"
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

sync_cloud_terminal_outcomes() {
  _scto_file="${1:-}"
  [ "$_sync_command" = "sync-cloud-builders" ] || return 0
  [ -n "$_scto_file" ] || return 0
  if node - "$_scto_file" <<'NODE' >/dev/null 2>&1
const fs = require("fs");
const file = process.argv[2];
let result;
try {
  result = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(2);
}
const hasFetchTasksArray = Array.isArray(result.fetchTasks);
const tasks = hasFetchTasksArray ? result.fetchTasks : [];
if (tasks.some((task) => task?.agentWorkType !== "candidate_discovery_fallback")) process.exit(1);
const cloudSourceTasks = Array.isArray(result.cloudSourceTasks) ? result.cloudSourceTasks : [];
const zeroPostLease = hasFetchTasksArray && tasks.length === 0 && Array.isArray(result.cloudSourceTasks) && cloudSourceTasks.some((task) => {
  const cloudSourceTaskId = String(task?.cloudSourceTaskId || "").trim();
  return Boolean(cloudSourceTaskId);
});
const outcomes = Array.isArray(result.taskOutcomes) ? result.taskOutcomes : [];
const hasSyncable = outcomes.some((outcome) => {
  const task = outcome?.plannedTask;
  if (!task || typeof task !== "object") return false;
  const outcomeTaskId = String(outcome?.fetchTaskId || "").trim();
  const taskId = String(task?.id || "").trim();
  const cloudSourceTaskId = String(task?.cloudSourceTaskId || task?.builderSync?.cloudSourceTaskId || "").trim();
  return Boolean(taskId && taskId === outcomeTaskId && cloudSourceTaskId);
});
process.exit(hasSyncable || zeroPostLease ? 0 : 1);
NODE
  then
    :
  else
    _scto_check_code="$?"
    case "$_scto_check_code" in
      1) return 0 ;;
      *) return "$_scto_check_code" ;;
    esac
  fi
  _scto_cloud_run_id="${2:-}"
  if [ -z "$_scto_cloud_run_id" ]; then
    _scto_cloud_run_id="$(cloud_run_id_from_result "$_scto_file")"
  fi
  if [ -z "$_scto_cloud_run_id" ]; then
    echo "Cloud source planning produced syncable terminal outcomes without a cloudRunId." >&2
    return 65
  fi
  echo "Cloud source planning produced terminal outcomes without fetch tasks; syncing them now."
  append_cloud_run_id "$_scto_cloud_run_id"
  cloud_fetch_heartbeat "$_scto_cloud_run_id"
  node "$AGENT_DIR/builder-digest.mjs" sync-cloud-builders \
    --file "$_scto_file" \
    --tasks "$_scto_file" \
    --cloud-run-id "$_scto_cloud_run_id"
}

print_compact_json_artifact_summary() {
  _pcjas_phase="$1"
  _pcjas_file="$2"
  node - "$_pcjas_phase" "$_pcjas_file" <<'NODE'
const fs = require("fs");
const phase = String(process.argv[2] || "unknown").trim() || "unknown";
const file = String(process.argv[3] || "");
const MAX_BYTES = 1900;
function clampLine(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(text, "utf8") <= MAX_BYTES) return text;
  let out = "";
  for (const char of text) {
    if (Buffer.byteLength(`${out}${char}...`, "utf8") > MAX_BYTES) break;
    out += char;
  }
  return `${out}...`;
};
function summaryLine(status, counts) {
  const parts = [`phase=${phase}`, `status=${status}`];
  for (const [key, value] of counts) parts.push(`${key}=${value}`);
  parts.push(`artifact=${file || "-"}`);
  return clampLine(parts.join(" "));
};
try {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const tasks = Array.isArray(payload.fetchTasks) ? payload.fetchTasks : [];
  let postTasks = 0;
  let discoveryTasks = 0;
  for (const task of tasks) {
    if (task?.agentWorkType === "candidate_discovery_fallback") discoveryTasks += 1;
    else postTasks += 1;
  }
  const cloudSourceTasks = Array.isArray(payload.cloudSourceTasks) ? payload.cloudSourceTasks.length : 0;
  const taskOutcomes = Array.isArray(payload.taskOutcomes) ? payload.taskOutcomes.length : 0;
  const status = typeof payload?.status === "string" && payload.status.trim() ? payload.status.trim() : "ok";
  process.stdout.write(`${summaryLine(status, [["postTasks", postTasks], ["discoveryTasks", discoveryTasks], ["cloudSourceTasks", cloudSourceTasks], ["taskOutcomes", taskOutcomes]])}\n`);
} catch (error) {
  const status = error && typeof error === "object" && error.code === "ENOENT" ? "missing" : "invalid_json";
  process.stdout.write(`${summaryLine(status, [])}\n`);
}
NODE
}

cloud_run_id_from_result() {
  _crifr_file="$1"
  node - "$_crifr_file" <<'NODE'
const fs = require("fs");
try {
  const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  console.log(result.cloudRunId || "");
} catch {
  console.log("");
}
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
  _olp_effective_timeout="${BUILDER_BLOG_OPENCLAW_PREFLIGHT_TIMEOUT_SECONDS:-120}"

  PROMPT_FILE="$_olp_prompt"
  BUILDER_BLOG_LIBRARY_AGENT_STAGE=runtime_preflight
  IS_CRON_JOB=1
  OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-preflight' "$ACCOUNT_SLUG" "$JOB_NAME" "${BUILDER_BLOG_JOB_RUN_ID:-$$}" | tr -c 'a-zA-Z0-9_.@+-' '_')"
  case "$_olp_effective_timeout" in
    ''|*[!0-9]*|0) _olp_effective_timeout=120 ;;
  esac
  _timeout="$_olp_effective_timeout"
  export BUILDER_BLOG_LIBRARY_AGENT_STAGE OPENCLAW_SESSION_ID

  echo "Running OpenClaw runtime preflight before FollowBrief fetch workers."
  LAST_AGENT_OUTPUT_FILE=""
  LAST_AGENT_USAGE_FILE=""
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

  if agent_output_has_openclaw_preflight_marker "${LAST_AGENT_OUTPUT_FILE:-}"; then
    return 0
  fi

  if [ "$_olp_code" -eq 124 ]; then
    job_run_update timed_out "OpenClaw preflight timed out before fetch workers started." "runtime_preflight_timeout" \
      --stage "runtime_preflight" \
      --timeout-seconds "$_olp_effective_timeout" \
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
  BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT:-}" \
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

  job_run_update running "Syncing digest to FollowBrief." "sync_started" --stage "save_to_followbrief"
  _sync_stderr="$JOB_TMP_DIR/digest-sync.err"
  set +e
  BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT:-}" \
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
    job_run_update failed "Sync to FollowBrief failed." "sync_failed" \
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
  _sps_granularity="${SYNC_PAYLOAD_SLICE_GRANULARITY:-task}"
  _sps_synced_ids_file="${SYNC_PAYLOAD_SYNCED_IDS_FILE:-}"
  _sps_sync_command="${SYNC_BUILDERS_COMMAND:-sync-builders}"
  _sps_extra_args="${SYNC_BUILDERS_EXTRA_ARGS:-}"
  _sps_failure_mode="${SYNC_PAYLOAD_FAILURE_MODE:-patch}"
  shift 4 || true

  node "$AGENT_DIR/builder-digest.mjs" split-sync-slices \
    --tasks "$_sps_tasks_file" \
    --file "$_sps_payload_file" \
    --out-dir "$_sps_slices_dir" \
    --granularity "$_sps_granularity"

  _sps_failures=0
  for _slice_payload in "$_sps_slices_dir"/slice-*-payload.json; do
    [ -e "$_slice_payload" ] || continue
    _slice_tasks="${_slice_payload%-payload.json}-tasks.json"
    _slice_name="$(basename "$_slice_payload" .json)"
    _slice_stdout="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-sync.out"
    _slice_stderr="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-sync.err"
    _slice_validate="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-validate.out"
    _slice_extra_args=""
    if [ "$_sps_sync_command" = "sync-cloud-builders" ]; then
      _slice_cloud_run_id="$(node - "$_slice_payload" "$_slice_tasks" <<'NODE'
const fs = require("fs");
function firstRunIdFromTasks(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const tasks = Array.isArray(payload?.fetchTasks) ? payload.fetchTasks : [];
    for (const task of tasks) {
      const runId = String(task?.cloudRunId || task?.builderSync?.cloudRunId || "").trim();
      if (runId) return runId;
    }
  } catch {}
  return "";
}
try {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const runId = String(payload?.cloudRunId || "").trim() || firstRunIdFromTasks(process.argv[3]);
  console.log(runId);
} catch {
  console.log(firstRunIdFromTasks(process.argv[3]));
}
NODE
)"
      if [ -n "$_slice_cloud_run_id" ]; then
        _slice_extra_args="--cloud-run-id $_slice_cloud_run_id"
      fi
    fi
    set +e
    node "$AGENT_DIR/builder-digest.mjs" validate-agent-sync \
      --tasks "$_slice_tasks" \
      --file "$_slice_payload" > "$_slice_validate" 2>&1
    _slice_validate_code="$?"
    set -e
    cat "$_slice_validate"
    if [ "$_slice_validate_code" -ne 0 ] || ! grep -q '"status": "ok"' "$_slice_validate"; then
      _sps_failures=$(( _sps_failures + 1 ))
      if [ "$_sps_failure_mode" = "skip" ]; then
        echo "Skipping non-destructive sync for $_sps_label $_slice_name after validate-agent-sync failed (exit $_slice_validate_code)." >&2
        continue
      fi
      echo "validate-agent-sync failed for $_sps_label $_slice_name (exit $_slice_validate_code); marking only this slice failed." >&2
      _failed_payload="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-validation-failed-payload.json"
      node "$AGENT_DIR/builder-digest.mjs" fail-sync-slice \
        --tasks "$_slice_tasks" \
        --payload "$_slice_payload" \
        --diagnostic-file "$_slice_validate" \
        --out "$_failed_payload" \
        --reason "task_validation_failed" \
        --message "validate-agent-sync failed for $_sps_label $_slice_name with exit $_slice_validate_code" \
        --validation-file "$_slice_validate"

      _failed_stdout="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-validation-failed-sync.out"
      _failed_stderr="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-validation-failed-sync.err"
      set +e
      node "$AGENT_DIR/builder-digest.mjs" "$_sps_sync_command" \
        --file "$_failed_payload" \
        --tasks "$_slice_tasks" \
        "$@" $_sps_extra_args $_slice_extra_args > "$_failed_stdout" 2> "$_failed_stderr"
      _failed_code="$?"
      set -e
      [ ! -s "$_failed_stdout" ] || cat "$_failed_stdout"
      [ ! -s "$_failed_stderr" ] || cat "$_failed_stderr" >&2
      if [ "$_failed_code" -eq 0 ]; then
        append_task_ids_from_fetch_result "$_slice_tasks" "$_sps_synced_ids_file"
      else
        echo "Failed to patch validation-failed outcomes for $_sps_label $_slice_name (exit $_failed_code)." >&2
      fi
      continue
    fi

    echo "Syncing $_sps_label slice $_slice_name."
    set +e
    node "$AGENT_DIR/builder-digest.mjs" "$_sps_sync_command" \
      --file "$_slice_payload" \
      --tasks "$_slice_tasks" \
      "$@" $_sps_extra_args $_slice_extra_args > "$_slice_stdout" 2> "$_slice_stderr"
    _slice_code="$?"
    set -e
    [ ! -s "$_slice_stdout" ] || cat "$_slice_stdout"
    [ ! -s "$_slice_stderr" ] || cat "$_slice_stderr" >&2
    if [ "$_slice_code" -eq 0 ]; then
      append_task_ids_from_fetch_result "$_slice_tasks" "$_sps_synced_ids_file"
      continue
    fi

    _sps_failures=$(( _sps_failures + 1 ))
    if [ "$_sps_failure_mode" = "skip" ]; then
      echo "Skipping non-destructive sync for $_sps_label $_slice_name after $_sps_sync_command failed (exit $_slice_code)." >&2
      continue
    fi
    echo "$_sps_sync_command failed for $_sps_label $_slice_name (exit $_slice_code); marking only this slice failed." >&2
    _failed_payload="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-failed-payload.json"
    node "$AGENT_DIR/builder-digest.mjs" fail-sync-slice \
      --tasks "$_slice_tasks" \
      --payload "$_slice_payload" \
      --diagnostic-file "$_slice_stderr" \
      --out "$_failed_payload" \
      --reason "task_sync_failed" \
      --message "$_sps_sync_command failed for $_sps_label $_slice_name with exit $_slice_code"

    _failed_stdout="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-failed-sync.out"
    _failed_stderr="$JOB_TMP_DIR/${_sps_label}-${_slice_name}-failed-sync.err"
    set +e
    node "$AGENT_DIR/builder-digest.mjs" "$_sps_sync_command" \
      --file "$_failed_payload" \
      --tasks "$_slice_tasks" \
      "$@" $_sps_extra_args $_slice_extra_args > "$_failed_stdout" 2> "$_failed_stderr"
    _failed_code="$?"
    set -e
    [ ! -s "$_failed_stdout" ] || cat "$_failed_stdout"
    [ ! -s "$_failed_stderr" ] || cat "$_failed_stderr" >&2
    if [ "$_failed_code" -ne 0 ]; then
      echo "Failed to patch failed outcomes for $_sps_label $_slice_name (exit $_failed_code)." >&2
    else
      append_task_ids_from_fetch_result "$_slice_tasks" "$_sps_synced_ids_file"
    fi
  done

  [ "$_sps_failures" -eq 0 ]
}

append_task_ids_from_fetch_result() {
  _atifr_tasks_file="$1"
  _atifr_out_file="${2:-}"
  [ -n "$_atifr_out_file" ] || return 0
  node - "$_atifr_tasks_file" >> "$_atifr_out_file" <<'NODE'
const fs = require("fs");
let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch {
  process.exit(0);
}
for (const task of Array.isArray(payload.fetchTasks) ? payload.fetchTasks : []) {
  const id = task && (task.id || task.fetchTaskId);
  if (!id) continue;
  const runId = String(task.cloudRunId || (task.builderSync && task.builderSync.cloudRunId) || "").trim();
  console.log(runId ? `${runId}\t${String(id)}` : String(id));
}
NODE
  sort -u "$_atifr_out_file" > "$_atifr_out_file.tmp"
  mv "$_atifr_out_file.tmp" "$_atifr_out_file"
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

  _scc_had_granularity=0
  _scc_previous_granularity=""
  if [ "${SYNC_PAYLOAD_SLICE_GRANULARITY+x}" = "x" ]; then
    _scc_had_granularity=1
    _scc_previous_granularity="$SYNC_PAYLOAD_SLICE_GRANULARITY"
  fi
  _scc_sync_ok=0
  _scc_had_failure_mode=0
  _scc_previous_failure_mode=""
  if [ "${SYNC_PAYLOAD_FAILURE_MODE+x}" = "x" ]; then
    _scc_had_failure_mode=1
    _scc_previous_failure_mode="$SYNC_PAYLOAD_FAILURE_MODE"
  fi
  SYNC_PAYLOAD_SYNCED_IDS_FILE="$_scc_synced_ids_file"
  SYNC_PAYLOAD_SLICE_GRANULARITY="task"
  SYNC_PAYLOAD_FAILURE_MODE=skip
  if sync_payload_slices "$_scc_tasks" "$_scc_payload" "$_scc_work_dir/sync-slices" "completed-checkpoint" --partial-outcomes --results-dir "$_scc_results_dir"; then
    _scc_sync_ok=1
  fi
  SYNC_PAYLOAD_SYNCED_IDS_FILE=""
  if [ "$_scc_had_failure_mode" -eq 1 ]; then
    SYNC_PAYLOAD_FAILURE_MODE="$_scc_previous_failure_mode"
  else
    unset SYNC_PAYLOAD_FAILURE_MODE
  fi
  if [ "$_scc_had_granularity" -eq 1 ]; then
    SYNC_PAYLOAD_SLICE_GRANULARITY="$_scc_previous_granularity"
  else
    unset SYNC_PAYLOAD_SLICE_GRANULARITY
  fi

  if [ "$_scc_sync_ok" -eq 1 ]; then
    return 0
  fi

  echo "One or more completed checkpoint task syncs failed; retrying during a later checkpoint or final sync." >&2
  return 0
}

flush_remaining_library_results() {
  _frlr_result_file="$1"
  _frlr_results_dir="$2"
  _frlr_synced_ids_file="$3"
  _frlr_shard_timeout="$4"
  _frlr_label="${5:-library-result}"
  _frlr_missing_reason="${6:-}"
  _frlr_scope="${7:-all}"
  _frlr_sync_command="${SYNC_BUILDERS_COMMAND:-}"
  _frlr_missing_reason_args=""
  _frlr_scope_args=""
  if [ -n "$_frlr_missing_reason" ]; then
    _frlr_missing_reason_args="--default-missing-reason $_frlr_missing_reason"
  fi
  case "$_frlr_scope" in
    assigned) _frlr_scope_args="--assigned-only --complete-sources-only" ;;
  esac

  aggregate_runtime_usage_files

  _frlr_merge_result_file="$JOB_TMP_DIR/merge-task-results.json"
  _frlr_merged_tasks="$JOB_TMP_DIR/library-fetch-merged.json"
  job_run_update running "Merging source fetch worker results." "merge_started" --stage "merge_results"
  node "$AGENT_DIR/builder-digest.mjs" merge-task-results \
    --tasks "$_frlr_result_file" \
    --results-dir "$_frlr_results_dir" \
    --shard-timeout-seconds "$_frlr_shard_timeout" \
    $_frlr_missing_reason_args \
    $_frlr_scope_args \
    --tasks-out "$_frlr_merged_tasks" \
    --out "$JOB_TMP_DIR/library-agent-sync.json" | tee "$_frlr_merge_result_file"
  _frlr_merge_issue_count="$(merge_result_issue_count "$_frlr_merge_result_file" "$_frlr_results_dir")"

  _frlr_remaining_payload="$JOB_TMP_DIR/library-agent-sync-remaining.json"
  _frlr_remaining_tasks="$JOB_TMP_DIR/library-fetch-remaining.json"
  _frlr_remaining_merge="$JOB_TMP_DIR/merge-task-results-remaining.json"
  if [ -n "$_frlr_synced_ids_file" ]; then
    if ! node "$AGENT_DIR/builder-digest.mjs" append-fetch-run-terminal-task-ids \
      --tasks "$_frlr_result_file" \
      --out "$_frlr_synced_ids_file"; then
      echo "Could not refresh fetch-run terminal task ids before $_frlr_label remaining sync; continuing with local checkpoint ids." >&2
    fi
  fi
  node "$AGENT_DIR/builder-digest.mjs" merge-task-results \
    --tasks "$_frlr_result_file" \
    --results-dir "$_frlr_results_dir" \
    --shard-timeout-seconds "$_frlr_shard_timeout" \
    --exclude-task-ids-file "$_frlr_synced_ids_file" \
    $_frlr_missing_reason_args \
    $_frlr_scope_args \
    --tasks-out "$_frlr_remaining_tasks" \
    --out "$_frlr_remaining_payload" | tee "$_frlr_remaining_merge"

  _frlr_sync_slices_dir="$JOB_TMP_DIR/sync-slices"
  job_run_update running "Syncing fetched posts to FollowBrief." "sync_started" --stage "sync_to_followbrief"
  _frlr_sync_failures=0
  SYNC_PAYLOAD_SYNCED_IDS_FILE="$_frlr_synced_ids_file"
  if ! sync_payload_slices "$_frlr_remaining_tasks" "$_frlr_remaining_payload" "$_frlr_sync_slices_dir" "$_frlr_label" --results-dir "$_frlr_results_dir"; then
    _frlr_sync_failures="${_sps_failures:-1}"
  fi
  SYNC_PAYLOAD_SYNCED_IDS_FILE=""

  if [ "$_frlr_sync_command" = "sync-cloud-builders" ] && [ "$_frlr_sync_failures" -eq 0 ]; then
    _frlr_usage_refresh_slices_dir="$JOB_TMP_DIR/usage-refresh-sync-slices"
    echo "Refreshing cloud worker usage after final runtime usage aggregation."
    _frlr_previous_failure_mode="${SYNC_PAYLOAD_FAILURE_MODE:-}"
    SYNC_PAYLOAD_FAILURE_MODE=skip
    if ! sync_payload_slices "$_frlr_merged_tasks" "$JOB_TMP_DIR/library-agent-sync.json" "$_frlr_usage_refresh_slices_dir" "$_frlr_label-usage-refresh" --results-dir "$_frlr_results_dir"; then
      echo "Usage refresh sync was skipped for one or more non-destructive slice failures." >&2
    fi
    if [ -n "$_frlr_previous_failure_mode" ]; then
      SYNC_PAYLOAD_FAILURE_MODE="$_frlr_previous_failure_mode"
    else
      unset SYNC_PAYLOAD_FAILURE_MODE
    fi
  fi

  if [ "$_frlr_sync_failures" -gt 0 ]; then
    echo "$_frlr_sync_failures library result slice(s) failed to sync." >&2
    return 65
  fi
  if [ "${_frlr_merge_issue_count:-0}" -gt 0 ]; then
    case "$_frlr_label" in
      cloud-host-idle*|runtime-timeout*)
        echo "Parallel library run completed with $_frlr_merge_issue_count worker/result issue(s); terminal outcomes were synced for $_frlr_label." >&2
        return 0
        ;;
    esac
    echo "Parallel library run completed with $_frlr_merge_issue_count worker/result issue(s); synced terminal outcomes, but marking the flush failed." >&2
    return 65
  fi
  return 0
}

cloud_fetch_heartbeat() {
  _cfh_run_id="${1:-}"
  [ -n "$_cfh_run_id" ] || return 0
  [ "${BUILDER_BLOG_DISABLE_WEB_SYNC:-}" = "1" ] && return 0
  node "$AGENT_DIR/builder-digest.mjs" heartbeat-cloud-fetch --cloud-run-id "$_cfh_run_id" >/dev/null 2>&1 || true
}

append_cloud_run_id() {
  _acri_run_id="${1:-}"
  [ -n "$_acri_run_id" ] || return 0
  grep -qx "$_acri_run_id" "$_cloud_run_ids_file" 2>/dev/null && return 0
  printf '%s\n' "$_acri_run_id" >> "$_cloud_run_ids_file"
}

cloud_fetch_heartbeat_all() {
  [ -s "$_cloud_run_ids_file" ] || return 0
  while IFS= read -r _cfha_run_id; do
    [ -n "$_cfha_run_id" ] || continue
    cloud_fetch_heartbeat "$_cfha_run_id"
  done < "$_cloud_run_ids_file"
}

write_active_fetch_group_keys() {
  _wafg_out="${1:-}"
  [ -n "$_wafg_out" ] || return 0
  : > "$_wafg_out"
  for _wafg_entry in ${_worker_entries:-}; do
    _wafg_pid="${_wafg_entry%%:*}"
    _wafg_rest="${_wafg_entry#*:}"
    _wafg_after_started="${_wafg_rest#*:}"
    _wafg_name="${_wafg_after_started%%:*}"
    case " ${_timed_out_worker_pids:-} " in
      *" $_wafg_pid "*) continue ;;
    esac
    kill -0 "$_wafg_pid" 2>/dev/null || continue
    node - "$_shards_dir/$_wafg_name.json" <<'NODE' >> "$_wafg_out" 2>/dev/null || true
const fs = require("fs");
try {
  const shard = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const keys = Array.isArray(shard?.groupKeys) ? shard.groupKeys : [];
  for (const key of keys) {
    if (String(key || "").trim()) console.log(String(key).trim());
  }
} catch {}
NODE
  done
}

assign_dynamic_fetch_workers() {
  _adfw_slots="${1:-0}"
  case "$_adfw_slots" in
    ''|*[!0-9]*) _adfw_slots=0 ;;
  esac
  [ "$_adfw_slots" -gt 0 ] || return 0
  _dynamic_assignment_count=$(( _dynamic_assignment_count + 1 ))
  _adfw_out="$JOB_TMP_DIR/assign-fetch-tasks-$_dynamic_assignment_count.json"
  _adfw_worker_ids_file="$JOB_TMP_DIR/available-worker-ids-$_dynamic_assignment_count.txt"
  write_available_worker_ids "$_adfw_worker_ids_file"
  write_active_fetch_group_keys "$_active_fetch_group_keys_file"
  node "$AGENT_DIR/builder-digest.mjs" assign-fetch-tasks \
    --tasks "$_result_file" \
    --out-dir "$_shards_dir" \
    --max-workers "$_adfw_slots" \
    --worker-ids-file "$_adfw_worker_ids_file" \
    --assigned-task-ids-file "$_assigned_fetch_task_ids_file" \
    --active-group-keys-file "$_active_fetch_group_keys_file" > "$_adfw_out"
  _adfw_counts="$(node - "$_adfw_out" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
try {
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  const status = typeof result?.status === "string" && result.status.trim() ? result.status.trim() : "ok";
  const assigned = Array.isArray(result.shards) ? result.shards.length : 0;
  const pending = Number(result.pendingTasks || 0) + Number(result.blockedTasks || 0);
  console.log(`${status} ${assigned} ${pending}`);
} catch (error) {
  const status = error && typeof error === "object" && error.code === "ENOENT" ? "missing" : "invalid_json";
  console.log(`${status} 0 0`);
}
NODE
)"
  set -- $_adfw_counts
  _adfw_status="${1:-invalid_json}"
  _adfw_assigned="${2:-0}"
  _adfw_pending="${3:-0}"
  case "$_adfw_assigned" in ''|*[!0-9]*) _adfw_assigned=0 ;; esac
  case "$_adfw_pending" in ''|*[!0-9]*) _adfw_pending=0 ;; esac
  printf 'phase=assign_fetch_tasks status=%s round=%s assignedWorkers=%s pendingWork=%s artifact=%s\n' \
    "$_adfw_status" "$_dynamic_assignment_count" "$_adfw_assigned" "$_adfw_pending" "$_adfw_out"
  if [ "$_adfw_pending" -eq 0 ]; then
    _dynamic_queue_drained=1
  else
    _dynamic_queue_drained=0
  fi
}

worker_entry_lane() {
  _wel_entry="${1:-}"
  _wel_rest="${_wel_entry#*:}"
  _wel_after_started="${_wel_rest#*:}"
  case "$_wel_after_started" in
    *:*) printf '%s\n' "${_wel_after_started#*:}" ;;
    *) printf '%s\n' "$_wel_after_started" ;;
  esac
}

worker_entry_shard_name() {
  _wesn_entry="${1:-}"
  _wesn_rest="${_wesn_entry#*:}"
  _wesn_after_started="${_wesn_rest#*:}"
  printf '%s\n' "${_wesn_after_started%%:*}"
}

worker_entry_reserves_lane() {
  _werl_entry="${1:-}"
  _werl_pid="${_werl_entry%%:*}"
  if kill -0 "$_werl_pid" 2>/dev/null; then
    return 0
  fi
  _werl_name="$(worker_entry_shard_name "$_werl_entry")"
  [ -n "$_werl_name" ] || return 1
  _werl_result="$_results_dir/$_werl_name-result.json"
  _werl_shard="$_shards_dir/$_werl_name.json"
  if worker_result_covers_shard_tasks "$_werl_result" "$_werl_shard"; then
    return 1
  fi
  [ -e "$_werl_shard" ] || return 1
  return 0
}

write_available_worker_ids() {
  _wawi_file="${1:-}"
  [ -n "$_wawi_file" ] || return 0
  : > "$_wawi_file"
  _wawi_index=0
  while [ "$_wawi_index" -lt "$MAX_PARALLEL_WORKERS" ]; do
    _wawi_lane="worker-$_wawi_index"
    _wawi_active=0
    for _wawi_entry in ${_worker_entries:-}; do
      _wawi_entry_lane="$(worker_entry_lane "$_wawi_entry")"
      if [ "$_wawi_entry_lane" = "$_wawi_lane" ] && worker_entry_reserves_lane "$_wawi_entry"; then
        _wawi_active=1
        break
      fi
    done
    if [ "$_wawi_active" -eq 0 ]; then
      printf '%s\n' "$_wawi_lane" >> "$_wawi_file"
    fi
    _wawi_index=$(( _wawi_index + 1 ))
  done
}

cloud_refill_limit() {
  # Safety cap for one active host refill cycle. Normal stopping conditions are an
  # empty cloud lease response or the runner's timeout buffer.
  _crl_value="${BUILDER_BLOG_CLOUD_REFILL_LIMIT:-100}"
  case "$_crl_value" in
    ''|*[!0-9]*) _crl_value=100 ;;
  esac
  if [ "$_crl_value" -lt 0 ]; then _crl_value=0; fi
  if [ "$_crl_value" -gt 1000 ]; then _crl_value=1000; fi
  printf '%s\n' "$_crl_value"
}

fetch_more_cloud_sources() {
  [ "$_sync_command" = "sync-cloud-builders" ] || return 0
  [ "${_cloud_refill_exhausted:-0}" -eq 0 ] || return 0
  [ "$_cloud_refill_count" -lt "$_cloud_refill_limit" ] || {
    _cloud_refill_exhausted=1
    return 0
  }
  _fmcs_now="$(date +%s)"
  if [ "$_fmcs_now" -ge "$_cloud_refill_stop_at" ]; then
    _cloud_refill_exhausted=1
    return 0
  fi

  _cloud_refill_count=$(( _cloud_refill_count + 1 ))
  _fmcs_file="$JOB_TMP_DIR/cloud-fetch-refill-$_cloud_refill_count.json"
  _fmcs_stderr="$JOB_TMP_DIR/cloud-fetch-refill-$_cloud_refill_count.err"
  _fmcs_limit="$(cloud_fetch_source_limit)"
  job_run_update running "Local fetch queue is low; requesting more cloud sources." "cloud_refill_started" \
    --stage "fetch_sources" \
    --cloud-refill "$_cloud_refill_count"
  set +e
  node "$AGENT_DIR/builder-digest.mjs" fetch-cloud-library \
    --days "${BUILDER_BLOG_FETCH_DAYS:-30}" \
    --post-limit "5" \
    --limit "$_fmcs_limit" \
    ${BUILDER_BLOG_FETCH_FORCE:-} > "$_fmcs_file" 2> "$_fmcs_stderr"
  _fmcs_code="$?"
  set -e
  [ ! -s "$_fmcs_stderr" ] || cat "$_fmcs_stderr" >&2
  if [ "$_fmcs_code" -ne 0 ]; then
    echo "Cloud source refill failed; finishing already assigned local work." >&2
    job_run_update running "Cloud source refill failed; finishing already assigned local work." "cloud_refill_failed" \
      --stage "fetch_sources" \
      --exit-code "$_fmcs_code"
    _cloud_refill_exhausted=1
    return 0
  fi
  cat "$_fmcs_file"
  _fmcs_task_count="$(library_fetch_task_count "$_fmcs_file")" || _fmcs_task_count=0
  case "$_fmcs_task_count" in ''|*[!0-9]*) _fmcs_task_count=0 ;; esac
  _fmcs_run_id="$(cloud_run_id_from_result "$_fmcs_file")"
  if [ "$_fmcs_task_count" -eq 0 ]; then
    if sync_cloud_terminal_outcomes "$_fmcs_file" "$_fmcs_run_id"; then
      :
    else
      _scto_code="$?"
      echo "Cloud source refill produced terminal outcomes but sync failed." >&2
      job_run_update failed "Cloud source refill outcomes could not be synced." "cloud_terminal_outcome_sync_failed" \
        --stage "sync_cloud_terminal_outcomes" \
        --exit-code "$_scto_code"
      _cloud_refill_exhausted=1
      return "$_scto_code"
    fi
    _cloud_refill_exhausted=1
    return 0
  fi
  append_cloud_run_id "$_fmcs_run_id"
  cloud_fetch_heartbeat "$_fmcs_run_id"
  _existing_task_count="$(library_fetch_task_count "$_result_file")" || _existing_task_count=0
  case "$_existing_task_count" in ''|*[!0-9]*) _existing_task_count=0 ;; esac
  if [ "$_existing_task_count" -eq 0 ]; then
    cp "$_fmcs_file" "$_result_file"
  else
    _fmcs_merged="$JOB_TMP_DIR/cloud-fetch-merged-$_cloud_refill_count.json"
    node "$AGENT_DIR/builder-digest.mjs" merge-fetch-results \
      --base "$_result_file" \
      --next "$_fmcs_file" \
      --out "$_fmcs_merged"
    mv "$_fmcs_merged" "$_result_file"
  fi
  _dynamic_queue_drained=0
}

patch_current_fetch_plans() {
  node "$AGENT_DIR/builder-digest.mjs" patch-fetch-run-plan \
    --tasks "$_result_file" \
    --results-dir "$_results_dir" || true
  if [ "$_sync_command" = "sync-cloud-builders" ]; then
    if ! node "$AGENT_DIR/builder-digest.mjs" patch-cloud-fetch-plan \
      --tasks "$_result_file"; then
      _pcfp_code="$?"
      echo "Failed to patch cloud execution plans; continuing local work after bounded retries." >&2
      job_run_update running "Failed to patch cloud execution plans; continuing local work after bounded retries." "cloud_plan_patch_failed" \
        --stage "patch_cloud_execution_plan" \
        --exit-code "$_pcfp_code"
    fi
  fi
}

library_worker_was_started() {
  _lwws_name="${1:-}"
  case " $_started_shard_names " in
    *" $_lwws_name "*) return 0 ;;
  esac
  return 1
}

worker_result_covers_shard_tasks() {
  _wrcst_result="${1:-}"
  _wrcst_shard="${2:-}"
  [ -r "$_wrcst_shard" ] || return 1
  node - "$_wrcst_result" "$_wrcst_shard" <<'NODE' >/dev/null 2>&1
const fs = require("fs");
const path = require("path");
function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}
function resultItems(result) {
  const builders = Array.isArray(result.builders) ? result.builders : [];
  return [
    ...(Array.isArray(result.items) ? result.items : []),
    ...(Array.isArray(result.feedItems) ? result.feedItems : []),
    ...builders.flatMap((builder) => (Array.isArray(builder?.items) ? builder.items : [])),
  ];
}
function addCoveredFromPayload(payload, covered) {
  for (const item of resultItems(payload)) {
    const id = item?.rawJson?.fetchTaskId ?? item?.fetchTaskId;
    if (id) covered.add(String(id));
  }
  for (const outcome of Array.isArray(payload?.taskOutcomes) ? payload.taskOutcomes : []) {
    const id = outcome?.fetchTaskId ?? outcome?.taskId;
    if (id) covered.add(String(id));
  }
}
function readCheckpointPayloads(resultPath) {
  const base = path.basename(resultPath || "");
  const match = base.match(/^(shard-.*)-result\.json$/);
  if (!match) return [];
  const dir = path.join(path.dirname(resultPath), `${match[1]}-checkpoints`);
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const payloads = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      payloads.push(readJson(path.join(dir, file)));
    } catch {}
  }
  return payloads;
}
let result = {};
try {
  result = readJson(process.argv[2]);
} catch {}
const shard = readJson(process.argv[3]);
const tasks = Array.isArray(shard.fetchTasks)
  ? shard.fetchTasks
  : Array.isArray(shard.tasks)
    ? shard.tasks
    : [];
const plannedIds = tasks.map((task) => task?.id).filter(Boolean).map(String);
const covered = new Set();
addCoveredFromPayload(result, covered);
for (const payload of readCheckpointPayloads(process.argv[2])) {
  addCoveredFromPayload(payload, covered);
}
process.exit(plannedIds.every((id) => covered.has(id)) ? 0 : 1);
NODE
}

merge_result_issue_count() {
  _mric_merge_file="${1:-}"
  _mric_results_dir="${2:-}"
  [ -r "$_mric_merge_file" ] || {
    printf '0\n'
    return 0
  }
  _mric_issue_file="${JOB_TMP_DIR:-${TMPDIR:-/tmp}}/merge-result-issues-$$.tsv"
  node - "$_mric_merge_file" > "$_mric_issue_file" <<'NODE' 2>/dev/null || {
const fs = require("fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
function sourceShardFromDiagnostic(value) {
  const text = String(value || "");
  const match = text.match(/^(shard-[0-9]+)(?:-result\.json|-checkpoints\/.*)?$/);
  return match ? match[1] : "";
}
const backfilled = Number(result.backfilledOutcomes || 0);
console.log(`BACKFILLED\t${Number.isFinite(backfilled) && backfilled > 0 ? backfilled : 0}`);
for (const shard of Array.isArray(result.shards) ? result.shards : []) {
  if (!shard || shard.status === "ok") continue;
  const diagnosticShard = String(shard.shard || "");
  const sourceShard = String(shard.sourceShard || "") || sourceShardFromDiagnostic(diagnosticShard);
  console.log(`ISSUE\t${sourceShard}\t${diagnosticShard}`);
}
NODE
    rm -f "$_mric_issue_file"
    printf '0\n'
    return 0
  }
  _mric_count=0
  _mric_backfilled_count=0
  while IFS="$(printf '\t')" read -r _mric_kind _mric_source _mric_shard; do
    case "$_mric_kind" in
      BACKFILLED)
        case "$_mric_source" in
          ''|*[!0-9]*) ;;
          *)
            _mric_backfilled_count="$_mric_source"
            _mric_count=$(( _mric_count + _mric_source ))
            ;;
        esac
        ;;
      ISSUE)
        if [ "$_mric_backfilled_count" -gt 0 ] && printf '%s' "$_mric_shard" | grep -q -- '-result\.json$'; then
          continue
        fi
        if [ -z "$_mric_source" ] && [ -n "$_mric_shard" ]; then
          _mric_source="$(printf '%s' "$_mric_shard" | sed 's/-result\.json$//')"
        fi
        if [ -n "$_mric_source" ] && [ -n "$_mric_results_dir" ]; then
          _mric_result_path="$_mric_results_dir/$_mric_source-result.json"
          _mric_shards_dir="$(dirname "$_mric_results_dir")"
          _mric_shard_path="$_mric_shards_dir/$_mric_source.json"
          if worker_result_covers_shard_tasks "$_mric_result_path" "$_mric_shard_path"; then
            continue
          fi
        fi
        _mric_count=$(( _mric_count + 1 ))
        ;;
    esac
  done < "$_mric_issue_file"
  rm -f "$_mric_issue_file"
  printf '%s\n' "$_mric_count"
}

start_library_worker() {
  _slw_shard_file="${1:-}"
  [ -n "$_slw_shard_file" ] || return 0
  [ -e "$_slw_shard_file" ] || return 0
  _slw_shard_name="$(basename "$_slw_shard_file" .json)"
  _slw_lane_id="$(node - "$_slw_shard_file" "$_slw_shard_name" <<'NODE'
const fs = require("fs");
try {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const first = Array.isArray(payload.fetchTasks) ? payload.fetchTasks.find(Boolean) : null;
  console.log(String(payload.workerId || first?.workerId || process.argv[3]));
} catch {
  console.log(process.argv[3]);
}
NODE
)"
  if library_worker_was_started "$_slw_shard_name"; then
    return 0
  fi
  _worker_timeout="$(shard_timeout_seconds_for_file "$_slw_shard_file")"
  _slw_checkpoint_dir="$_results_dir/$_slw_shard_name-checkpoints"
  _slw_agent_output_file="$_results_dir/$_slw_shard_name-agent-output.log"
  mkdir -p "$_slw_checkpoint_dir"
  (
    BUILDER_BLOG_SHARD_FILE="$_slw_shard_file"
    BUILDER_BLOG_SHARD_RESULT="$_results_dir/$_slw_shard_name-result.json"
    BUILDER_BLOG_SHARD_CHECKPOINT_DIR="$_slw_checkpoint_dir"
    BUILDER_BLOG_SHARD_TIMEOUT_SECONDS="$_worker_timeout"
    BUILDER_BLOG_SHARD_STARTED_AT_EPOCH="$(date +%s)"
    BUILDER_BLOG_AGENT_OUTPUT_FILE="$_slw_agent_output_file"
    readonly BUILDER_BLOG_SHARD_STARTED_AT_EPOCH
    export BUILDER_BLOG_SHARD_FILE BUILDER_BLOG_SHARD_RESULT BUILDER_BLOG_SHARD_CHECKPOINT_DIR BUILDER_BLOG_SHARD_TIMEOUT_SECONDS BUILDER_BLOG_SHARD_STARTED_AT_EPOCH BUILDER_BLOG_AGENT_OUTPUT_FILE
    if [ "$PINNED_RUNTIME" = "openclaw" ]; then
      OPENCLAW_SESSION_ID="$(printf 'followbrief-%s-%s-%s-%s' "$ACCOUNT_SLUG" "$JOB_NAME" "$$" "$_slw_shard_name" | tr -c 'a-zA-Z0-9_.@+-' '_')"
      export OPENCLAW_SESSION_ID
    fi
    PROMPT_FILE="$AGENT_DIR/jobs/library-worker.md"
    if [ "$PINNED_RUNTIME" = "openclaw" ]; then
      PROMPT_FILE="$(openclaw_worker_prompt_file "$_slw_shard_name" "$BUILDER_BLOG_SHARD_FILE" "$BUILDER_BLOG_SHARD_RESULT" "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR" "$BUILDER_BLOG_SHARD_TIMEOUT_SECONDS")"
    fi
    BUILDER_BLOG_LIBRARY_AGENT_STAGE=worker
    export BUILDER_BLOG_LIBRARY_AGENT_STAGE
    # Workers must never wait on interactive permission prompts, so they
    # always use the pinned runtime's unattended invocation — even when the
    # enclosing job is a one-time run.
    IS_CRON_JOB=1
    run_selected_runtime
  ) > "$_results_dir/$_slw_shard_name-worker.log" 2>&1 &
  _worker_entries="${_worker_entries:-} $!:$(date +%s):$_slw_shard_name:$_slw_lane_id"
  _started_shard_names="$_started_shard_names $_slw_shard_name"
  _started_worker_count=$(( _started_worker_count + 1 ))
  echo "Started worker $_slw_lane_id for $_slw_shard_name (pid $!)."
}

worker_fits_remaining_outer_window() {
  _wfrow_shard_file="${1:-}"
  [ "$_sync_command" = "sync-cloud-builders" ] || return 0
  [ "${_cloud_persistent_host:-0}" -eq 0 ] || return 0
  shard_is_cloud_file "$_wfrow_shard_file" || return 0
  _wfrow_budget="$(shard_timeout_seconds_for_file "$_wfrow_shard_file")"
  _wfrow_deadline="$(current_outer_deadline_epoch_seconds)"
  _wfrow_remaining="$(( _wfrow_deadline - $(date +%s) ))"
  _wfrow_required="$(( _wfrow_budget + ${_cloud_refill_buffer:-0} ))"
  [ "$_wfrow_remaining" -ge "$_wfrow_required" ]
}

start_pending_library_workers() {
  _started_worker_count=0
  for _splw_shard_file in "$_shards_dir"/shard-*.json; do
    [ -e "$_splw_shard_file" ] || continue
    if ! worker_fits_remaining_outer_window "$_splw_shard_file"; then
      continue
    fi
    start_library_worker "$_splw_shard_file"
  done
}

reset_cloud_refill_window() {
  # Per-shard timeout: 3/4 of the whole-job timeout. A hung shard is
  # terminated early enough for merge, failure reporting, and sync to finish
  # before the outer runner timeout kills non-host runs. Persistent cloud hosts
  # reuse the same worker-shard timeout while refreshing the refill window after
  # each idle wait.
  _whole_timeout="$(job_timeout_seconds)"
  _shard_timeout="$(shard_timeout_seconds "$_whole_timeout")"
  _cloud_refill_buffer=300
  if [ "$JOB_NAME" = "cloud-library-cron" ]; then
    _cloud_refill_buffer=900
  fi
  if [ "$_whole_timeout" -le 600 ]; then
    _cloud_refill_buffer=$(( _whole_timeout / 2 ))
  fi
  if [ "$JOB_NAME" = "cloud-library-cron" ] && [ "${_cloud_persistent_host:-0}" -eq 0 ]; then
    _cloud_refill_stop_at=$(( $(current_outer_deadline_epoch_seconds) - _cloud_refill_buffer ))
  else
    _cloud_refill_stop_at=$(( $(date +%s) + _whole_timeout - _cloud_refill_buffer ))
  fi
}

run_library_job() {
  _fetch_command="${1:-fetch-personal}"
  _sync_command="${2:-sync-builders}"
  _result_basename="${3:-library-fetch-result.json}"
  _job_label="${4:-library}"
  _shards_dir="$JOB_TMP_DIR/shards"
  _results_dir="$_shards_dir/results"
  rm -rf "$_shards_dir"
  mkdir -p "$_results_dir"
  _result_file="$JOB_TMP_DIR/$_result_basename"
  _sync_extra_args=""
  _cloud_run_id=""
  _last_cloud_heartbeat=0
  _last_job_run_heartbeat=0
  _assigned_fetch_task_ids_file="$JOB_TMP_DIR/assigned-fetch-task-ids.txt"
  _active_fetch_group_keys_file="$JOB_TMP_DIR/active-fetch-group-keys.txt"
  _cloud_run_ids_file="$JOB_TMP_DIR/cloud-run-ids.txt"
  _dynamic_queue_enabled=0
  _dynamic_assignment_count=0
  _dynamic_queue_drained=0
  _cloud_refill_count=0
  _cloud_refill_limit="$(cloud_refill_limit)"
  _cloud_refill_exhausted=0
  _cloud_persistent_host=0
  if [ "$_sync_command" = "sync-cloud-builders" ] && [ "${BUILDER_BLOG_CLOUD_PERSISTENT_HOST:-0}" = "1" ]; then
    _cloud_persistent_host=1
  fi
  : > "$_cloud_run_ids_file"

  echo "FollowBrief $_job_label run: $MAX_PARALLEL_WORKERS worker(s)."

  run_openclaw_library_preflight || return "$?"

  job_run_update running "Fetching source candidates." "fetch_started" --stage "fetch_sources"
  _fetch_stderr="$JOB_TMP_DIR/library-fetch.err"
  _discovery_failed=0
  set +e
  if [ "$_fetch_command" = "fetch-cloud-library" ]; then
    _cloud_fetch_source_limit="$(cloud_fetch_source_limit)"
    node "$AGENT_DIR/builder-digest.mjs" fetch-cloud-library \
      --days "${BUILDER_BLOG_FETCH_DAYS:-30}" \
      --post-limit "5" \
      --limit "$_cloud_fetch_source_limit" \
      ${BUILDER_BLOG_FETCH_FORCE:-} > "$_result_file" 2> "$_fetch_stderr"
  else
    node "$AGENT_DIR/builder-digest.mjs" fetch-personal \
      --days "${BUILDER_BLOG_FETCH_DAYS:-30}" \
      --limit "${BUILDER_BLOG_FETCH_LIMIT:-3}" \
      ${BUILDER_BLOG_FETCH_FORCE:-} > "$_result_file" 2> "$_fetch_stderr"
  fi
  _fetch_code="$?"
  set -e
  [ ! -s "$_fetch_stderr" ] || cat "$_fetch_stderr" >&2
  if [ "$_fetch_code" -ne 0 ]; then
    job_run_update failed "Fetch sources failed." "fetch_failed" \
      --stage "fetch_sources" \
      --exit-code "$_fetch_code"
    return "$_fetch_code"
  fi
  print_compact_json_artifact_summary "fetch_sources" "$_result_file"
  if [ "$_sync_command" = "sync-cloud-builders" ]; then
    _cloud_run_id="$(cloud_run_id_from_result "$_result_file")"
    if [ -n "$_cloud_run_id" ]; then
      append_cloud_run_id "$_cloud_run_id"
      cloud_fetch_heartbeat "$_cloud_run_id"
    fi
  fi
  SYNC_BUILDERS_COMMAND="$_sync_command"
  SYNC_BUILDERS_EXTRA_ARGS="$_sync_extra_args"
  if [ "$_sync_command" = "sync-cloud-builders" ]; then
    SYNC_PAYLOAD_SLICE_GRANULARITY="cloud-run"
  else
    SYNC_PAYLOAD_SLICE_GRANULARITY="${SYNC_PAYLOAD_SLICE_GRANULARITY:-task}"
  fi
  export SYNC_BUILDERS_COMMAND SYNC_BUILDERS_EXTRA_ARGS SYNC_PAYLOAD_SLICE_GRANULARITY

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
      BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT:-}" \
      node "$AGENT_DIR/builder-digest.mjs" expand-discovery \
        --tasks "$_result_file" \
        --file "$_discovery_result_file" \
        --out "$_expanded_result_file" > "$JOB_TMP_DIR/library-expand-discovery.out" 2> "$_expand_stderr"
      _expand_code="$?"
      set -e
      [ ! -s "$_expand_stderr" ] || cat "$_expand_stderr" >&2
      if [ "$_expand_code" -eq 0 ]; then
        mv "$_expanded_result_file" "$_result_file"
        print_compact_json_artifact_summary "expand_discovery" "$_result_file"
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
    patch_current_fetch_plans
    if sync_cloud_terminal_outcomes "$_result_file" "$_cloud_run_id"; then
      :
    else
      _scto_code="$?"
      job_run_update failed "Cloud task outcomes could not be synced." "cloud_terminal_outcome_sync_failed" \
        --stage "sync_cloud_terminal_outcomes" \
        --exit-code "$_scto_code"
      return "$_scto_code"
    fi
    if [ "$_cloud_persistent_host" -eq 1 ]; then
      echo "No cloud source work available yet. Worker host will wait and ask again."
      reset_cloud_refill_window
      while [ "$_task_count" -eq 0 ]; do
        job_run_update running "Worker host idle; waiting before asking cloud for more sources." "worker_host_idle" \
          --stage "waiting_for_cloud_sources"
        cloud_host_sleep_with_heartbeat "$(cloud_host_idle_seconds)"
        _cloud_refill_count=0
        _cloud_refill_exhausted=0
        reset_cloud_refill_window
        job_run_update running "Worker host requesting cloud sources." "worker_host_polling" \
          --stage "requesting_cloud_sources"
        if fetch_more_cloud_sources; then :; else return "$?"; fi
        _task_count="$(library_fetch_task_count "$_result_file")" || _task_count=0
        case "$_task_count" in ''|*[!0-9]*) _task_count=0 ;; esac
      done
      _cloud_run_id="$(cloud_run_id_from_result "$_result_file")"
    else
      echo "No source updates to sync. Planned 0 post tasks."
      job_run_update succeeded "No update. Planned 0 post tasks." "no_update" \
        --stage "no_update"
      return 0
    fi
  fi

  if [ "$_sync_command" = "sync-cloud-builders" ] && [ -z "$_cloud_run_id" ]; then
    echo "Cloud fetch result did not include cloudRunId." >&2
    job_run_update failed "Cloud fetch result did not include cloudRunId." "cloud_run_id_missing" \
      --stage "fetch_sources"
    return 65
  fi

  job_run_update running "Assigning $_task_count fetch task(s)." "shard_started" --stage "shard_fetch_tasks"
  _dynamic_queue_enabled=1
  : > "$_assigned_fetch_task_ids_file"
  assign_dynamic_fetch_workers "$MAX_PARALLEL_WORKERS"

  patch_current_fetch_plans
  set_initial_worker_window_deadline

  reset_cloud_refill_window
  _run_started_epoch_seconds="$(
    node -e 'const date = new Date(process.env.BUILDER_BLOG_JOB_STARTED_AT || Date.now()); const seconds = Math.floor(date.getTime() / 1000); console.log(Number.isFinite(seconds) ? seconds : Math.floor(Date.now() / 1000));'
  )"
  _worker_entries=""
  _skip_wait_pids=""
  _timed_out_worker_pids=""
  _started_shard_names=""
  _checkpoint_synced_ids_file="$JOB_TMP_DIR/completed-checkpoint-synced-task-ids.txt"
  : > "$_checkpoint_synced_ids_file"
  job_run_update running "Running source fetch workers." "workers_started" --stage "run_fetch_workers"
  start_pending_library_workers

  while :; do
    _alive=0
    _now="$(date +%s)"
    for _entry in ${_worker_entries:-}; do
      _pid="${_entry%%:*}"
      _rest="${_entry#*:}"
      _started="${_rest%%:*}"
      _after_started="${_rest#*:}"
      _name="${_after_started%%:*}"
      _lane="$(worker_entry_lane "$_entry")"
      _worker_shard_file="$_shards_dir/$_name.json"
      _worker_timeout="$(shard_timeout_seconds_for_file "$_worker_shard_file")"
      _worker_no_progress_timeout="$(worker_no_progress_timeout_seconds "$_worker_timeout")"
      _worker_stall_timeout="$(worker_stall_timeout_seconds "$_worker_timeout")"
      if kill -0 "$_pid" 2>/dev/null; then
        case " $_timed_out_worker_pids " in
          *" $_pid "*) continue ;;
        esac
        _result_path="$_results_dir/$_name-result.json"
        _shard_path="$_shards_dir/$_name.json"
        if worker_result_covers_shard_tasks "$_result_path" "$_shard_path"; then
          echo "Worker $_lane ($_name) result file is complete; terminating lingering runtime and continuing." >&2
          if ! terminate_process_tree "$_pid" TERM 5; then
            terminate_process_tree "$_pid" KILL 3 || true
          fi
          wait "$_pid" 2>/dev/null || true
          _skip_wait_pids="$_skip_wait_pids $_pid"
          _completed_worker_pids="${_completed_worker_pids:-} $_pid"
          continue
        fi
        _worker_log_path="$_results_dir/$_name-worker.log"
        _worker_agent_output_path="$_results_dir/$_name-agent-output.log"
        if worker_log_has_backgrounded_tool "$_worker_log_path" || worker_log_has_backgrounded_tool "$_worker_agent_output_path"; then
          echo "Worker $_lane ($_name) started a background tool call before completing every task; terminating it (unfinished tasks will be reported as failed)." >&2
          write_worker_control_event "$_worker_log_path" "worker_backgrounded_tool" "$_lane" "$_name" "Worker started a background tool call before completing every task."
          printf 'Worker %s (%s) started a background tool call before completing every task; terminating it (unfinished tasks will be reported as failed).\n' "$_lane" "$_name" >> "$_worker_log_path" 2>/dev/null || true
          job_run_update running "Worker $_lane started a background tool call and will be terminated." "worker_backgrounded_tool" \
            --timeout-stage "worker_shard" \
            --timed-out-worker "$_name" \
            --timed-out-worker-lane "$_lane" \
            --timed-out-worker-pid "$_pid" \
            --termination "terminating"
          if terminate_process_tree "$_pid" TERM 10 || terminate_process_tree "$_pid" KILL 3; then
            job_run_update running "Worker $_lane with backgrounded tool call was terminated." "worker_backgrounded_tool" \
              --timeout-stage "worker_shard" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "terminated"
          else
            echo "Worker $_lane ($_name) pid $_pid was still alive after backgrounded-tool termination; continuing without waiting." >&2
            _skip_wait_pids="$_skip_wait_pids $_pid"
            job_run_update running "Worker $_lane with backgrounded tool call did not exit after forced termination." "worker_backgrounded_tool" \
              --timeout-stage "worker_shard" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "still_alive_after_kill" \
              --skipped-wait-pids "$_skip_wait_pids"
          fi
          _timed_out_worker_pids="$_timed_out_worker_pids $_pid"
        else
          _worker_progress_mtime="$(worker_progress_mtime_seconds "$_result_path" "$_results_dir/$_name-checkpoints")"
          case "$_worker_progress_mtime" in
            ''|*[!0-9]*) _worker_progress_mtime=0 ;;
          esac
          _worker_no_progress_age=$(( _now - _started ))
          _worker_stall_age=$(( _now - _worker_progress_mtime ))
          if [ "$_worker_progress_mtime" -le 0 ] && [ "$_worker_no_progress_age" -ge "$_worker_no_progress_timeout" ]; then
          echo "Worker $_lane ($_name) made no checkpoint progress for ${_worker_no_progress_timeout}s; terminating it (unfinished tasks will be reported as failed)." >&2
          write_worker_control_event "$_results_dir/$_name-worker.log" "worker_no_progress_timeout" "$_lane" "$_name" "Worker made no checkpoint, progress, or result-file progress for ${_worker_no_progress_timeout}s."
          printf 'Worker %s (%s) made no checkpoint progress for %ss; terminating it (unfinished tasks will be reported as failed).\n' "$_lane" "$_name" "$_worker_no_progress_timeout" >> "$_results_dir/$_name-worker.log" 2>/dev/null || true
          job_run_update running "Worker $_lane made no checkpoint progress and will be terminated." "worker_no_progress_timeout" \
            --timeout-seconds "$_worker_no_progress_timeout" \
            --timeout-stage "worker_no_progress" \
            --timed-out-worker "$_name" \
            --timed-out-worker-lane "$_lane" \
            --timed-out-worker-pid "$_pid" \
            --termination "terminating"
          if terminate_process_tree "$_pid" TERM 10 || terminate_process_tree "$_pid" KILL 3; then
            job_run_update running "Worker $_lane with no checkpoint progress was terminated." "worker_no_progress_timeout" \
              --timeout-seconds "$_worker_no_progress_timeout" \
              --timeout-stage "worker_no_progress" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "terminated"
          else
            echo "Worker $_lane ($_name) pid $_pid was still alive after no-progress termination; continuing without waiting." >&2
            _skip_wait_pids="$_skip_wait_pids $_pid"
            job_run_update running "Worker $_lane with no checkpoint progress did not exit after forced termination." "worker_no_progress_timeout" \
              --timeout-seconds "$_worker_no_progress_timeout" \
              --timeout-stage "worker_no_progress" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "still_alive_after_kill" \
              --skipped-wait-pids "$_skip_wait_pids"
          fi
          _timed_out_worker_pids="$_timed_out_worker_pids $_pid"
          elif [ "$_worker_progress_mtime" -gt 0 ] && [ "$_worker_stall_age" -ge "$_worker_stall_timeout" ]; then
            echo "Worker $_lane ($_name) made no checkpoint progress for ${_worker_stall_timeout}s after prior progress; terminating it (unfinished tasks will be reported as failed)." >&2
            write_worker_control_event "$_results_dir/$_name-worker.log" "worker_stalled_timeout" "$_lane" "$_name" "Worker stopped updating result, checkpoint, or progress files for ${_worker_stall_timeout}s after prior progress."
            printf 'Worker %s (%s) stalled after prior progress for %ss; terminating it (unfinished tasks will be reported as failed).\n' "$_lane" "$_name" "$_worker_stall_timeout" >> "$_results_dir/$_name-worker.log" 2>/dev/null || true
            job_run_update running "Worker $_lane stopped making checkpoint progress and will be terminated." "worker_stalled_timeout" \
              --timeout-seconds "$_worker_stall_timeout" \
              --timeout-stage "worker_stalled" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "terminating"
            if terminate_process_tree "$_pid" TERM 10 || terminate_process_tree "$_pid" KILL 3; then
              job_run_update running "Worker $_lane with stalled checkpoint progress was terminated." "worker_stalled_timeout" \
                --timeout-seconds "$_worker_stall_timeout" \
                --timeout-stage "worker_stalled" \
                --timed-out-worker "$_name" \
                --timed-out-worker-lane "$_lane" \
                --timed-out-worker-pid "$_pid" \
                --termination "terminated"
            else
              echo "Worker $_lane ($_name) pid $_pid was still alive after stalled-worker termination; continuing without waiting." >&2
              _skip_wait_pids="$_skip_wait_pids $_pid"
              job_run_update running "Worker $_lane with stalled checkpoint progress did not exit after forced termination." "worker_stalled_timeout" \
                --timeout-seconds "$_worker_stall_timeout" \
                --timeout-stage "worker_stalled" \
                --timed-out-worker "$_name" \
                --timed-out-worker-lane "$_lane" \
                --timed-out-worker-pid "$_pid" \
                --termination "still_alive_after_kill" \
                --skipped-wait-pids "$_skip_wait_pids"
            fi
            _timed_out_worker_pids="$_timed_out_worker_pids $_pid"
          elif [ $(( _now - _started )) -ge "$_worker_timeout" ]; then
          echo "Worker $_lane ($_name) exceeded ${_worker_timeout}s; terminating it (its tasks will be reported as failed)." >&2
          write_worker_control_event "$_results_dir/$_name-worker.log" "worker_shard_timeout" "$_lane" "$_name" "Worker exceeded ${_worker_timeout}s before completing every task."
          printf 'Worker %s (%s) exceeded %ss; terminating it (its tasks will be reported as failed).\n' "$_lane" "$_name" "$_worker_timeout" >> "$_results_dir/$_name-worker.log" 2>/dev/null || true
          job_run_update running "Worker $_lane exceeded timeout and will be terminated." "worker_shard_timeout" \
            --timeout-seconds "$_worker_timeout" \
            --timeout-stage "worker_shard" \
            --timed-out-worker "$_name" \
            --timed-out-worker-lane "$_lane" \
            --timed-out-worker-pid "$_pid" \
            --termination "terminating"
          if terminate_process_tree "$_pid" TERM 10 || terminate_process_tree "$_pid" KILL 3; then
            job_run_update running "Worker $_lane timed out and was terminated." "worker_shard_timeout" \
              --timeout-seconds "$_worker_timeout" \
              --timeout-stage "worker_shard" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "terminated"
          else
            echo "Worker $_lane ($_name) pid $_pid was still alive after forced termination; continuing without waiting." >&2
            _skip_wait_pids="$_skip_wait_pids $_pid"
            job_run_update running "Worker $_lane timed out and did not exit after forced termination." "worker_shard_timeout" \
              --timeout-seconds "$_worker_timeout" \
              --timeout-stage "worker_shard" \
              --timed-out-worker "$_name" \
              --timed-out-worker-lane "$_lane" \
              --timed-out-worker-pid "$_pid" \
              --termination "still_alive_after_kill" \
              --skipped-wait-pids "$_skip_wait_pids"
          fi
          _timed_out_worker_pids="$_timed_out_worker_pids $_pid"
          else
            _alive=$(( _alive + 1 ))
          fi
        fi
      else
        record_worker_runtime_auth_failure "$_name" "$_lane"
      fi
    done
    if [ "$_dynamic_queue_enabled" -eq 1 ]; then
      _free_slots=$(( MAX_PARALLEL_WORKERS - _alive ))
      if [ "$_free_slots" -gt 0 ]; then
        if [ "${_dynamic_queue_drained:-0}" -eq 0 ]; then
          assign_dynamic_fetch_workers "$_free_slots"
          start_pending_library_workers
          if [ "${_started_worker_count:-0}" -gt 0 ]; then
            patch_current_fetch_plans
            _alive=$(( _alive + _started_worker_count ))
          fi
        fi
        _free_slots=$(( MAX_PARALLEL_WORKERS - _alive ))
        if [ "$_sync_command" = "sync-cloud-builders" ] && [ "$_free_slots" -gt 0 ] && [ "${_dynamic_queue_drained:-0}" -eq 1 ] && [ "${_cloud_refill_exhausted:-0}" -eq 0 ]; then
          if fetch_more_cloud_sources; then :; else return "$?"; fi
          if [ "${_dynamic_queue_drained:-0}" -eq 0 ]; then
            assign_dynamic_fetch_workers "$_free_slots"
            start_pending_library_workers
            if [ "${_started_worker_count:-0}" -gt 0 ]; then
              patch_current_fetch_plans
              _alive=$(( _alive + _started_worker_count ))
            fi
          fi
        fi
      fi
    fi
    if [ "$_alive" -eq 0 ]; then
      if [ "$_cloud_persistent_host" -eq 1 ] && [ "$_dynamic_queue_enabled" -eq 1 ]; then
        sync_completed_checkpoints "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" || true
        if ! flush_remaining_library_results "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" "$_shard_timeout" "cloud-host-idle" "" "assigned"; then
          job_run_update running "Worker host could not sync every idle result; it will keep running and retry with later progress." "worker_host_idle_flush_failed" \
            --stage "waiting_after_sync_issue"
        else
          cleanup_transient_job_artifacts || true
          cleanup_old_job_runs
        fi
        for _entry in ${_worker_entries:-}; do
          _pid="${_entry%%:*}"
          case " $_skip_wait_pids " in
            *" $_pid "*) continue ;;
          esac
          wait "$_pid" 2>/dev/null || true
        done
        _worker_entries=""
        _skip_wait_pids=""
        _timed_out_worker_pids=""
        _cloud_refill_count=0
        _cloud_refill_exhausted=0
        job_run_update running "Worker host idle; waiting before asking cloud for more sources." "worker_host_idle" \
          --stage "waiting_for_cloud_sources"
        cloud_host_sleep_with_heartbeat "$(cloud_host_idle_seconds)"
        reset_cloud_refill_window
        job_run_update running "Worker host requesting cloud sources." "worker_host_polling" \
          --stage "requesting_cloud_sources"
        if fetch_more_cloud_sources; then :; else return "$?"; fi
        if [ "${_dynamic_queue_drained:-0}" -eq 0 ]; then
          assign_dynamic_fetch_workers "$MAX_PARALLEL_WORKERS"
          start_pending_library_workers
          if [ "${_started_worker_count:-0}" -gt 0 ]; then
            patch_current_fetch_plans
          fi
        fi
        continue
      fi
      break
    fi
    if [ "$_sync_command" = "sync-cloud-builders" ] && [ -n "$_cloud_run_id" ]; then
      _cloud_heartbeat_interval="${BUILDER_BLOG_CLOUD_HEARTBEAT_SECONDS:-60}"
      case "$_cloud_heartbeat_interval" in
        ''|*[!0-9]*) _cloud_heartbeat_interval=60 ;;
      esac
      if [ $(( _now - _last_cloud_heartbeat )) -ge "$_cloud_heartbeat_interval" ]; then
        cloud_fetch_heartbeat_all
        _last_cloud_heartbeat="$_now"
      fi
    fi
    _job_heartbeat_interval="${HEARTBEAT_INTERVAL_SECONDS:-60}"
    case "$_job_heartbeat_interval" in
      ''|*[!0-9]*) _job_heartbeat_interval=60 ;;
    esac
    if [ $(( _now - _last_job_run_heartbeat )) -ge "$_job_heartbeat_interval" ]; then
      job_run_update running "Running source fetch workers." "heartbeat" \
        --stage "run_fetch_workers"
      _last_job_run_heartbeat="$_now"
    fi
    node "$AGENT_DIR/builder-digest.mjs" checkpoint-progress \
      --tasks "$_result_file" \
      --results-dir "$_results_dir" \
      --stage "workers_running" >/dev/null 2>&1 || true
    sync_completed_checkpoints "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" || true
    sleep 5
  done
  sync_completed_checkpoints "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" || true
  for _entry in ${_worker_entries:-}; do
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

  if ! flush_remaining_library_results "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" "$_shard_timeout" "library-result"; then
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

if [ "$JOB_NAME" = "cloud-library-host" ]; then
  run_cloud_worker_host
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
