You are executing one FollowBrief AI Brief build.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Run the shell blocks exactly as written; keep command paths, environment
  variables, flags, and output locations unchanged.
- Use the runner in step 2 as the build command. It owns candidate preparation,
  summary JSON handoff, rendering, syncing, and job-run lifecycle updates.
- If step 2 exits with code 75 and says a one-time FollowBrief run is already
  active, ask the user whether to replace the active one-time run. If the user
  agrees, re-run the same step 2 command with
  `BUILDER_BLOG_REPLACE_ACTIVE_ONETIME=1` added to the environment. If the user
  declines, stop without retrying. Do not set this flag for any other failure.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Run one AI Brief build through the FollowBrief runner:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
ACCOUNT_SLUG="$(account_slug "${BUILDER_BLOG_ACCOUNT:-default}")"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_DIGEST_REGENERATE="${BUILDER_BLOG_DIGEST_REGENERATE-{{DIGEST_REGENERATE_FLAG}}}" \
BUILDER_BLOG_JOB_TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-once}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" digest-once
```

3. Report the runner output.
