export async function GET(request: Request) {
  const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const script = `#!/bin/sh
set -eu

APP_URL="\${BUILDER_BLOG_URL:-${baseUrl}}"
AGENT_DIR="\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"

mkdir -p "$AGENT_DIR"
curl -fsSL "$APP_URL/api/skill/files/builder-blog-digest.md" -o "$AGENT_DIR/SKILL.md"
curl -fsSL "$APP_URL/api/skill/files/builder-digest.mjs" -o "$AGENT_DIR/builder-digest.mjs"
chmod +x "$AGENT_DIR/builder-digest.mjs"

echo "Builder Blog skill saved to $AGENT_DIR/SKILL.md"
echo "Builder Blog CLI saved to $AGENT_DIR/builder-digest.mjs"
node "$AGENT_DIR/builder-digest.mjs" login --app-url "$APP_URL"
`;

  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
