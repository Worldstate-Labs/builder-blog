You are executing one FollowBrief Cloud worker session as an admin.

Execution contract:
- Run only the numbered shell blocks below, in order.
- If a command fails, stop and report the command, exit code, and stderr to the user.
- Do not browse for extra context.
- Run the shell blocks exactly as written; keep command paths, environment
  variables, flags, and output locations unchanged.
- The runner leases cloud source batches from FollowBrief, keeps a local post
  task queue fed until it is empty, fetches and summarizes posts, and syncs the
  results back to the cloud language libraries. It owns leasing, fetch-task
  sharding, validation, syncing, and source lease batch status updates. This
  account must have admin Cloud Fetch access.
- Before starting the runner, check for an active local cloud worker. If one is
  active, ask the user whether to replace it. Continue only after explicit
  confirmation; if the user declines, stop without running a second worker.

1. Install or refresh the skill:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

2. Check whether a local cloud worker is already running for this account:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCT="${BUILDER_BLOG_ACCOUNT}"
account_slug() {
  node - "${1:-default}" <<'NODE'
const { createHash } = require("node:crypto");
const account = String(process.argv[2] || "default");
const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
console.log(`${base}_${hash}`);
NODE
}
CURRENT_FILE="$AGENT_DIR/tmp/accounts/$(account_slug "$ACCT")/cloud-library-cron/current.json"
node - "$CURRENT_FILE" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const file = process.argv[2];
function inactive() {
  console.log("NO_ACTIVE_CLOUD_WORKER");
}
if (!file || !fs.existsSync(file)) {
  inactive();
  process.exit(0);
}
let current;
try {
  current = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  inactive();
  process.exit(0);
}
const pid = Number(current.workerPid || current.pid || 0);
if (!Number.isFinite(pid) || pid <= 0) {
  inactive();
  process.exit(0);
}
try {
  process.kill(pid, 0);
} catch {
  inactive();
  process.exit(0);
}
const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout || "";
if (!/BUILDER_BLOG_WORKER_MODE=1|builder-agent-runner\.sh|codex exec|claude -p|hermes chat|openclaw/.test(command)) {
  inactive();
  process.exit(0);
}
console.log(`ACTIVE_CLOUD_WORKER pid=${pid} instance=${current.instanceId || ""} startedAt=${current.startedAt || ""}`);
NODE
```

If the check prints `NO_ACTIVE_CLOUD_WORKER`, continue. If it prints
`ACTIVE_CLOUD_WORKER`, STOP and ask the user whether to replace that active
cloud worker. Continue only if the user explicitly confirms; otherwise stop and
change nothing.

3. Run one cloud worker session through the FollowBrief runner:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_RUN_SOURCE=cloud \
BUILDER_BLOG_FETCH_LIMIT="${BUILDER_BLOG_FETCH_LIMIT-{{FETCH_LIMIT}}}" \
BUILDER_BLOG_FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}" \
BUILDER_BLOG_PARALLEL_WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" cloud-library-cron
```

4. Report the runner output, including how many cloud source tasks were leased,
   how many succeeded, and how many failed.
