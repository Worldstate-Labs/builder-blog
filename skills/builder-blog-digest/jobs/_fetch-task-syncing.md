<!--
  Legacy payload / validate / sync tail of the fetch-task execution contract.
  Current library jobs are runner-owned, so normal prompts should not include
  this fragment. Keep it only for old prompt compatibility and contract tests
  that exercise the CLI validation language.

      {{INCLUDE:fetch-task-syncing REPORT_TARGET="..." TMP_JOB="..."}}
-->
Write the sync payload to:

```text
$TMP_DIR/library-agent-sync.json
```

The payload is `{ builders: [{ …builderSync, items: [synced items] }],
taskOutcomes: [non-synced task outcomes] }`.

Then validate before sync, and sync, running these commands exactly:

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
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/{{TMP_JOB}}}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" validate-agent-sync \
  --tasks "$TMP_DIR/library-fetch-result.json" \
  --file "$TMP_DIR/library-agent-sync.json"
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
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/{{TMP_JOB}}}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" sync-builders \
  --file "$TMP_DIR/library-agent-sync.json" \
  --tasks "$TMP_DIR/library-fetch-result.json"
```

A fetchTask is complete ONLY when its local sync item has real crawled content
for validation/summarization AND a non-empty `summary`. `sync-builders` then
applies source-specific raw retention before upload: for some source types the
server stores only a summary, excerpt, or structured facts instead of the full
raw body. The server still refuses missing summaries, and it refuses
insufficient durable content for source types whose policy allows durable raw
storage. So summarize every task you fetch before syncing — do not silently drop
a task from the sync payload because you couldn't summarize it. If a specific
task genuinely cannot be summarized, write the concrete reason
{{REPORT_TARGET}} and continue with the rest; the server will mark that one
as a FAILURE.

Run `validate-agent-sync` over the FULL fetch-result file (not a subset) before
`sync-builders`, and stop if it reports errors — it checks that every planned
task is either synced (with content + summary) or accounted for in
`taskOutcomes`, and that every `skipped` carries its own per-task evidence (so a
blanket bulk-skip fails). Success means status is ok, localErrors
is empty, and `fetchTasks` is empty or `validate-agent-sync` reports all fetch
tasks validated and `sync-builders` succeeds. Already-fetched posts remain
skipped regardless of read state. If the run cannot complete without a missing
credential or unsupported local capability, write the concrete reason
{{REPORT_TARGET}} and stop.
