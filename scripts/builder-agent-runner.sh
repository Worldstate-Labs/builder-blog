#!/bin/sh
set -eu

JOB_NAME="${1:-}"
APP_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PROMPT_FILE="$AGENT_DIR/jobs/$JOB_NAME.md"

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
# Tag every fetch the CLI emits as "cron" while we're inside the cron
# runner so the per-user fetch log can distinguish scheduled jobs from
# manual terminal invocations.
BUILDER_BLOG_RUN_SOURCE=cron
export PATH BUILDER_BLOG_URL="$APP_URL" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" BUILDER_BLOG_RUN_SOURCE

if [ -z "$JOB_NAME" ]; then
  echo "Usage: builder-agent-runner.sh <library-once|digest-once|library-cron-setup|digest-cron-setup|library-cron|digest-cron>" >&2
  exit 64
fi

mkdir -p "$AGENT_DIR/logs" "$AGENT_DIR/tmp"

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
  _next="$AGENT_DIR/.builder-agent-runner.next"
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
  openclaw agent --local --message "$(cat "$PROMPT_FILE")"
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
  codex exec --skip-git-repo-check --full-auto -C "$AGENT_DIR" - < "$PROMPT_FILE"
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
  # OpenClaw has no per-invocation approval flag (the flag we used before was
  # rejected by the CLI). Unattended auto-approval is a host-level exec policy,
  # so apply the "yolo" preset (idempotent) before the run. NOTE: this is
  # host-global for openclaw — it auto-approves exec for all openclaw sessions
  # on this machine, not just this cron.
  openclaw exec-policy preset yolo >/dev/null 2>&1 || true
  openclaw agent --local --message "$(cat "$PROMPT_FILE")"
}

run_with_gemini_unattended() {
  gemini --yolo -p "$(cat "$PROMPT_FILE")"
}

run_shell_library_fallback() {
  echo "No local agent runtime found; running non-AI library fetch fallback." >&2
  echo "Sources requiring AI, cookies, transcription, summaries, or custom tools will need BUILDER_BLOG_AGENT_COMMAND, codex, claude, openclaw, or gemini." >&2
  refresh_skill_files
  RESULT_FILE="$AGENT_DIR/tmp/library-fallback-fetch-result.json"
  node "$AGENT_DIR/builder-digest.mjs" fetch-personal --days 30 --limit 3 > "$RESULT_FILE"
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

# Cron-setup pins config in per-job files so two job types (e.g. library-cron
# + digest-cron) can use different runtimes/fetch modes on one machine. Read
# the job-scoped file first ($AGENT_DIR/<base>-<job>), then fall back to the
# legacy global $AGENT_DIR/<base> so crons installed before the per-job split
# keep working after the runner self-updates.
read_pin() {
  # $1 = base name (runtime | fetch-force)
  if [ -r "$AGENT_DIR/$1-$JOB_NAME" ]; then
    tr -d ' \t\r\n' < "$AGENT_DIR/$1-$JOB_NAME"
  elif [ -r "$AGENT_DIR/$1" ]; then
    tr -d ' \t\r\n' < "$AGENT_DIR/$1"
  fi
}

# The pinned runtime is a single word: claude | codex | gemini | openclaw.
# We honor it for *-cron jobs so unattended runs use the matching allowlist /
# auto-approve flags. Interactive jobs (library-once, digest-once) keep the
# discovery chain — the user is at a TTY and sees any permission prompts.
PINNED_RUNTIME="$(read_pin runtime)"

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

IS_CRON_JOB=0
case "$JOB_NAME" in
  *-cron) IS_CRON_JOB=1 ;;
esac

if [ -n "${BUILDER_BLOG_AGENT_COMMAND:-}" ]; then
  run_with_override
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
