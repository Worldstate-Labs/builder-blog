#!/bin/sh
set -eu

JOB_NAME="${1:-}"
APP_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PROMPT_FILE="$AGENT_DIR/jobs/$JOB_NAME.md"

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH BUILDER_BLOG_URL="$APP_URL" BUILDER_BLOG_AGENT_DIR="$AGENT_DIR"

if [ -z "$JOB_NAME" ]; then
  echo "Usage: builder-agent-runner.sh <library-cron|digest-cron>" >&2
  exit 64
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Missing Builder Blog job prompt: $PROMPT_FILE" >&2
  echo "Run: /bin/sh -c \"\$(curl -fsSL $APP_URL/api/skill/bootstrap)\"" >&2
  exit 66
fi

mkdir -p "$AGENT_DIR/logs" "$AGENT_DIR/tmp"

run_with_override() {
  BUILDER_BLOG_JOB="$JOB_NAME" BUILDER_BLOG_PROMPT_FILE="$PROMPT_FILE" sh -c "$BUILDER_BLOG_AGENT_COMMAND"
}

run_with_codex() {
  codex exec --skip-git-repo-check -C "$AGENT_DIR" - < "$PROMPT_FILE"
}

run_with_claude() {
  claude -p "$(cat "$PROMPT_FILE")" --add-dir "$AGENT_DIR"
}

run_with_gemini() {
  gemini -p "$(cat "$PROMPT_FILE")"
}

run_shell_library_fallback() {
  echo "No local agent runtime found; running non-AI library crawl fallback." >&2
  echo "Sources requiring AI, cookies, transcription, or custom tools will need BUILDER_BLOG_AGENT_COMMAND, codex, claude, or gemini." >&2
  node "$AGENT_DIR/builder-digest.mjs" crawl-personal --days 30 --limit 3
}

if [ -n "${BUILDER_BLOG_AGENT_COMMAND:-}" ]; then
  run_with_override
elif command -v codex >/dev/null 2>&1; then
  run_with_codex
elif command -v claude >/dev/null 2>&1; then
  run_with_claude
elif command -v gemini >/dev/null 2>&1; then
  run_with_gemini
elif [ "$JOB_NAME" = "library-cron" ]; then
  run_shell_library_fallback
else
  echo "No local agent runtime found for Builder Blog digest generation." >&2
  echo "Install/configure Codex, Claude Code, Gemini CLI, or set BUILDER_BLOG_AGENT_COMMAND." >&2
  echo "Digest cron requires an agent because it must summarize returned items with AI before sync." >&2
  exit 78
fi
