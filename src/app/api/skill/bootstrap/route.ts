export async function GET(request: Request) {
  const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const script = `#!/bin/sh
set -eu

APP_URL="\${BUILDER_BLOG_URL:-${baseUrl}}"
AGENT_DIR="\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"

export APP_URL AGENT_DIR

if ! command -v node >/dev/null 2>&1; then
  echo "FollowBrief requires Node.js 20 or newer on this computer." >&2
  echo "Install Node.js, then rerun this skill prompt." >&2
  exit 69
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "FollowBrief requires curl to download the skill files." >&2
  echo "Install curl, then rerun this skill prompt." >&2
  exit 69
fi

mkdir -p "$AGENT_DIR"
mkdir -p "$AGENT_DIR/jobs" "$AGENT_DIR/logs" "$AGENT_DIR/tmp"

download_skill_file() {
  _url="$1"
  _dest="$2"
  mkdir -p "$(dirname "$_dest")"
  _tmp="$(dirname "$_dest")/.$(basename "$_dest").$$.tmp"
  if ! curl -fsSL "$_url" -o "$_tmp"; then
    rm -f "$_tmp" 2>/dev/null || true
    return 1
  fi
  mv "$_tmp" "$_dest"
}

download_skill_file "$APP_URL/api/skill/files/builder-digest.mjs" "$AGENT_DIR/builder-digest.mjs"
download_skill_file "$APP_URL/api/skill/files/builder-agent-runner.sh" "$AGENT_DIR/builder-agent-runner.sh"
download_skill_file "$APP_URL/api/skill/files/builder-blog-library-once.md" "$AGENT_DIR/jobs/library-once.md"
download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-once.md" "$AGENT_DIR/jobs/digest-once.md"
download_skill_file "$APP_URL/api/skill/files/builder-blog-library-cron-setup.md" "$AGENT_DIR/jobs/library-cron-setup.md"
download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-cron-setup.md" "$AGENT_DIR/jobs/digest-cron-setup.md"
download_skill_file "$APP_URL/api/skill/files/builder-blog-digest-cron.md" "$AGENT_DIR/jobs/digest-cron.md"
download_skill_file "$APP_URL/api/skill/files/builder-blog-library-worker.md" "$AGENT_DIR/jobs/library-worker.md"
download_skill_file "$APP_URL/api/skill/files/builder-blog-library-discovery.md" "$AGENT_DIR/jobs/library-discovery.md"
# Per-source config (content-quality floors, url patterns) — the single source
# of truth the CLI reads. Downloaded here so the once-flow (bootstrap → direct
# CLI, no runner) always has it; the CLI no longer carries an embedded fallback.
download_skill_file "$APP_URL/api/skill/files/sources.json" "$AGENT_DIR/sources.json"
download_skill_file "$APP_URL/api/skill/files/local-agent-timeouts.json" "$AGENT_DIR/local-agent-timeouts.json"
chmod +x "$AGENT_DIR/builder-digest.mjs"
chmod +x "$AGENT_DIR/builder-agent-runner.sh"

echo "FollowBrief CLI saved to $AGENT_DIR/builder-digest.mjs"
echo "FollowBrief agent runner saved to $AGENT_DIR/builder-agent-runner.sh"
echo "FollowBrief scheduled job prompts saved to $AGENT_DIR/jobs"
echo "Next step: use the Copy prompt button in the web app (Sources page) to authenticate your agent."
`;

  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
