import { readFile } from "node:fs/promises";
import { join } from "node:path";

const INSTALLER_DELIMITER = "FOLLOWBRIEF_BUNDLE_INSTALLER";

export async function GET(request: Request) {
  const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const installer = await readFile(
    join(process.cwd(), "scripts/install-agent-skill-bundle.cjs"),
    "utf8",
  );
  if (installer.split(/\r?\n/).includes(INSTALLER_DELIMITER)) {
    throw new Error("Agent skill installer conflicts with the bootstrap heredoc delimiter.");
  }

  const script = `#!/bin/sh
set -eu

APP_URL="\${BUILDER_BLOG_URL:-${baseUrl}}"
AGENT_DIR="\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
BUNDLE_URL="$APP_URL/api/skill/bundle"

if ! command -v node >/dev/null 2>&1; then
  echo "FollowBrief requires Node.js 20 or newer on this computer." >&2
  echo "Install Node.js, then rerun this skill prompt." >&2
  exit 69
fi

mkdir -p "$AGENT_DIR" "$AGENT_DIR/jobs" "$AGENT_DIR/logs" "$AGENT_DIR/tmp"

node - "$BUNDLE_URL" "$AGENT_DIR" <<'${INSTALLER_DELIMITER}'
${installer.trimEnd()}
${INSTALLER_DELIMITER}

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
