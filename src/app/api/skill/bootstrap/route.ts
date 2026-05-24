export async function GET(request: Request) {
  const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const script = `#!/bin/sh
set -eu

APP_URL="\${BUILDER_BLOG_URL:-${baseUrl}}"
AGENT_DIR="\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"

export APP_URL AGENT_DIR

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
chmod +x "$AGENT_DIR/builder-digest.mjs"
chmod +x "$AGENT_DIR/builder-agent-runner.sh"

echo "FollowBrief skill saved to $AGENT_DIR/SKILL.md"
echo "FollowBrief CLI saved to $AGENT_DIR/builder-digest.mjs"
echo "FollowBrief agent runner saved to $AGENT_DIR/builder-agent-runner.sh"
echo "FollowBrief scheduled job prompts saved to $AGENT_DIR/jobs"
if CONFIG_PATH="$AGENT_DIR/config.json" node -e 'const fs = require("fs"); try { const c = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8")); process.exit(c.appUrl === process.env.APP_URL && c.token ? 0 : 1); } catch { process.exit(1); }'; then
  echo "FollowBrief login already configured for $APP_URL"
else
  node "$AGENT_DIR/builder-digest.mjs" login --app-url "$APP_URL"
fi
`;

  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
