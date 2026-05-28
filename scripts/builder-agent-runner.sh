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

if [ -n "${BUILDER_BLOG_AGENT_COMMAND:-}" ]; then
  run_with_override
elif command -v codex >/dev/null 2>&1; then
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
