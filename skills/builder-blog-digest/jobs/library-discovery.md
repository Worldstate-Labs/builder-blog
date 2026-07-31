Use the FollowBrief skill to run the private library candidate-discovery
pre-pass.

This is an unattended pre-pass launched by the FollowBrief runner before fetch
tasks are sharded across parallel workers. Do not ask the user questions.

Complete ONLY the `candidate_discovery_fallback` discovery entries in the fetch
result, write `library-discovery-result.json`, and stop. Do NOT complete normal
post fetch tasks, do NOT summarize posts, and do NOT run `expand-discovery`,
`validate-agent-sync`, or `sync-builders` — the runner handles everything after
the discovery result is written.

Agent discretion boundary: use the exact input/output paths and JSON shapes
specified below.

1. Read the fetch result (the runner sets `BUILDER_BLOG_JOB_TMP_DIR`):

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
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron}"
DISCOVERY_TASKS_FILE="${BUILDER_BLOG_DISCOVERY_TASKS_FILE:-$TMP_DIR/library-fetch-result.json}"
DISCOVERY_RESULT_FILE="${BUILDER_BLOG_DISCOVERY_RESULT_FILE:-$TMP_DIR/library-discovery-result.json}"
cat "$DISCOVERY_TASKS_FILE"
```

2. Complete the discovery entries exactly as specified below.

{{INCLUDE:fetch-task-discovery TMP_JOB="library-cron"}}

3. Write the discovery payload to `$DISCOVERY_RESULT_FILE`.

4. Print one final JSON line and stop:
`{"discoveryDone": true}`.
