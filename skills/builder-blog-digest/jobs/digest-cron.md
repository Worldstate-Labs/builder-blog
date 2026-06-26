You are writing FollowBrief AI Digest summary JSON for an unattended run.

Execution contract:

- Read only `$TMP_DIR/builder-blog-context.json`.
- Write only `$TMP_DIR/builder-blog-digest-agent-output.json`.
- Do not ask the user questions.
- Do not browse for extra context.

Resolve `TMP_DIR` as:

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
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/digest-cron}"
```

{{INCLUDE:digest-task-contract TMP_JOB="digest-cron"}}
