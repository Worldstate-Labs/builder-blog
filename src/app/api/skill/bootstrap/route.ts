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
curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest.md" -o "$AGENT_DIR/SKILL.md"
curl -fsSL "$APP_URL/api/skill/files/builder-digest.mjs" -o "$AGENT_DIR/builder-digest.mjs"
curl -fsSL "$APP_URL/api/skill/files/builder-agent-runner.sh" -o "$AGENT_DIR/builder-agent-runner.sh"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-once.md" -o "$AGENT_DIR/jobs/library-once.md"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest-once.md" -o "$AGENT_DIR/jobs/digest-once.md"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-cron-setup.md" -o "$AGENT_DIR/jobs/library-cron-setup.md"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest-cron-setup.md" -o "$AGENT_DIR/jobs/digest-cron-setup.md"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-library-cron.md" -o "$AGENT_DIR/jobs/library-cron.md"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest-cron.md" -o "$AGENT_DIR/jobs/digest-cron.md"
# Per-source config (content-quality floors, url patterns) — the single source
# of truth the CLI reads. Downloaded here so the once-flow (bootstrap → direct
# CLI, no runner) always has it; the CLI no longer carries an embedded fallback.
curl -fsSL "$APP_URL/api/skill/files/sources.json" -o "$AGENT_DIR/sources.json"
chmod +x "$AGENT_DIR/builder-digest.mjs"
chmod +x "$AGENT_DIR/builder-agent-runner.sh"

echo "FollowBrief skill saved to $AGENT_DIR/SKILL.md"
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
