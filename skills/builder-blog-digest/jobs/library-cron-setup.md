Set up the FollowBrief private source library scheduled job.

This is an interactive local agent setup run. Do not ask the user questions
except where step 3 requires it (confirming whether to replace an existing
library fetch cron), where step 6 requires it (confirming whether to schedule
after safe post-level failures), or when crontab permissions or a missing local
credential blocks the setup.

Run these steps exactly. If any command fails, stop and report the command, exit
code, and stderr. Do not use `--force`. Do not browse for extra context. Do not
invoke any other skill, plugin, or subagent — run the numbered steps yourself
exactly as written; this prompt is the whole task.

This setup prompt only orchestrates scheduler setup. The real fetch/summarize
work happens only through the runner command in step 6; do not manually perform
fetch-task work outside the numbered commands.

Scheduled runtime: **{{AGENT_RUNTIME_LABEL}}** ({{AGENT_RUNTIME}}). Every step
below uses this pinned runtime; do not fall back to a different one.

1. Install or refresh the skill:

{{INCLUDE:install-skill}}

2. Create required directories and verify this account's local credential before
changing scheduler state. The web Copy-prompt version runs a one-time exchange
step after step 1 and before this check; static local copies cannot create the account file
themselves. If the credential is missing, stop before pinning settings or
installing the schedule.

```bash
mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/logs"
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -z "$ACCT" ]; then
  echo "BUILDER_BLOG_ACCOUNT is empty. Re-copy this setup prompt from FollowBrief." >&2
  exit 1
fi
SAFE_ACCT="$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9._@+-' '_')"
ACCOUNT_FILE="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/accounts/$SAFE_ACCT.json"
if [ ! -s "$ACCOUNT_FILE" ]; then
  echo "Account file not found for $ACCT (expected $ACCOUNT_FILE)." >&2
  echo "Stop before installing the schedule. Re-copy this setup prompt from FollowBrief so it includes a fresh one-time exchange code, then run that prompt." >&2
  exit 1
fi
```

{{SOURCE_CREDENTIAL_PREP}}

Before checking or changing schedule ownership, check the runner-owned
managed-media capability. Dependency installation is interactive and optional
for this private schedule:

{{INCLUDE:asr-capability-setup}}

3. Before changing anything, check FollowBrief's server state for this
account's library fetch cron, then check whether the schedule already exists on
this machine. The server check detects another machine that may already own the
recurring schedule.

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-state --job library-cron
```

If the JSON output contains `"status": "active"`, STOP: report the current
frequency, runtime, hostname, platform, and ownerId from the server output,
explain that continuing replaces the server-authorized library fetch schedule
owner after this setup proves a new initial run and schedule install, and ask
the user whether to replace it. Only continue after the user explicitly
confirms. If they decline, stop and change nothing. Do not run `cron-status`
yet: the old server owner must remain authorized until this setup's initial run
and local schedule install both succeed.

Next, check whether this account's library fetch cron already exists on this
machine. Run the check for this machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin)

```bash
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
legacy_account_slug() {
  node - "${1:-default}" <<'NODE'
const account = String(process.argv[2] || "default");
console.log(account.replace(/[^a-zA-Z0-9]/g, "_"));
NODE
}
LABEL="com.followbrief.library.$(account_slug "$ACCT")"
LEGACY_LABEL="com.followbrief.library.$(legacy_account_slug "$ACCT")"
FOUND=0
for CANDIDATE_LABEL in "$LABEL" "$LEGACY_LABEL"; do
  PLIST="$HOME/Library/LaunchAgents/$CANDIDATE_LABEL.plist"
  if launchctl print "gui/$(id -u)/$CANDIDATE_LABEL" >/dev/null 2>&1; then
    echo "Loaded LaunchAgent: $CANDIDATE_LABEL"
    FOUND=1
  elif [ -f "$PLIST" ]; then
    echo "Inactive LaunchAgent plist found (not loaded; no active schedule): $PLIST"
  fi
done
if [ "$FOUND" -eq 0 ]; then
  echo "(none found)"
fi
```

### Linux / other

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
crontab -l 2>/dev/null | grep "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron" || echo "(none found)"
```

Only a `Loaded LaunchAgent:` line or a matching Linux crontab line means an
existing local schedule was found. An `Inactive LaunchAgent plist found` line
is stale configuration, not an active schedule; do not ask for confirmation
because of that line, and continue automatically when the output also says
`(none found)`. If an existing local schedule is found, STOP: report exactly what was found, explain
that continuing replaces this account's library fetch schedule and its pinned
runtime/fetch settings (including fetch days; jobs for other accounts are left untouched), and ask
the user whether to override. Only continue past this step after the user
explicitly confirms. If they decline, stop and change nothing.

On an override, do not unload the existing schedule here. Leave it loaded through
the initial run and let step 7 replace it atomically (its install block boots
out the old job, enables its label, then bootstraps the new one) only after the initial run has passed —
so a failed initial run never tears down a working schedule and leaves the account
with none.

4. Keep the selected runtime and fetch mode scoped to this setup run until the
initial run passes. Do not write cron pin files yet: on an override
setup, the old schedule is still loaded, and writing new pins early could make
that old schedule run with the new runtime before this setup has been proven.
The initial run command below passes the selected settings as env vars; step 7
writes the pins immediately before installing the new schedule.

5. Verify the runtime CLI is on PATH for the scheduler. Schedulers (launchd and
cron) do not inherit the interactive shell PATH; the runner injects this
FollowBrief scheduler-safe PATH so default user-level installs can still be
found:

```bash
SCHEDULER_PATH="$HOME/.local/bin:$HOME/bin:$HOME/.codex/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
PATH="$SCHEDULER_PATH" command -v {{AGENT_RUNTIME}}
```

If the path printed is empty, stop before installing the schedule: the selected
runtime is not installed in a location FollowBrief can find from launchd/cron.
Reinstall that runtime with its normal installer, or configure
`BUILDER_BLOG_AGENT_COMMAND` to an absolute command path, then re-run this
setup prompt.

For OpenClaw only, also verify that scheduled runs will not wait for exec
approval prompts. Do not change OpenClaw policy from this setup prompt; just
fail fast if this machine is configured to ask. The user can either configure
OpenClaw for unattended exec or choose a different Local Agent. This setup
prompt raises OpenClaw's response timeout to the scheduled FollowBrief job
timeout when needed, and the runner does the same before each unattended run.

```bash
if [ "{{AGENT_RUNTIME}}" = "openclaw" ]; then
  OPENCLAW_POLICY="$(openclaw exec-policy show 2>&1)"
  printf '%s\n' "$OPENCLAW_POLICY"
  printf '%s\n' "$OPENCLAW_POLICY" | grep -q 'ask=off' || {
    echo "OpenClaw exec policy is not ask=off. Scheduled FollowBrief jobs cannot wait for approvals." >&2
    echo "Configure OpenClaw for unattended exec, then re-run this setup prompt." >&2
    exit 1
  }
  OPENCLAW_TIMEOUT_CURRENT="$(openclaw config get agents.defaults.timeoutSeconds 2>/dev/null || printf '0\n')"
  case "$OPENCLAW_TIMEOUT_CURRENT" in ''|*[!0-9]*) OPENCLAW_TIMEOUT_CURRENT=0 ;; esac
  if [ "$OPENCLAW_TIMEOUT_CURRENT" -lt "{{CRON_TIMEOUT_SECONDS}}" ]; then
    openclaw config set agents.defaults.timeoutSeconds "{{CRON_TIMEOUT_SECONDS}}" --strict-json
  fi
fi
```

6. Run one real initial fetch job now. This runs on this machine through the
selected local runtime, uses the selected fetch settings, and performs the same
fetch, summarize, validate, and web-sync work as the recurring `library-cron`
job. It is recorded as a one-time setup run, not a scheduled window. This can
take until the normal job timeout; do not treat a lack of output as a hang before
the command exits or the runner timeout fires.

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
ACCOUNT_SLUG="$(account_slug "$ACCT")"
SETUP_TMP_DIR="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-direct"
mkdir -p "$SETUP_TMP_DIR"
EXPECTED_INSTANCE_ID="$(node -e 'const { randomUUID } = require("node:crypto"); process.stdout.write(randomUUID())')"
SETUP_VERDICT_FILE="$SETUP_TMP_DIR/setup-verdict-$EXPECTED_INSTANCE_ID.json"
rm -f -- "$SETUP_VERDICT_FILE"
if BUILDER_BLOG_JOB_TMP_DIR="$SETUP_TMP_DIR" \
BUILDER_BLOG_WORKER_MODE=1 \
BUILDER_BLOG_SETUP_INITIAL=1 \
BUILDER_BLOG_JOB_RUN_ID="$EXPECTED_INSTANCE_ID" \
BUILDER_BLOG_SETUP_VERDICT_FILE="$SETUP_VERDICT_FILE" \
BUILDER_BLOG_JOB_TRIGGER=one_time \
BUILDER_BLOG_AGENT_RUNTIME="{{AGENT_RUNTIME}}" \
BUILDER_BLOG_FETCH_FORCE="{{FETCH_FLAG}}" \
BUILDER_BLOG_FETCH_DAYS="{{FETCH_DAYS}}" \
BUILDER_BLOG_PARALLEL_WORKERS="{{PARALLEL_WORKERS}}" \
BUILDER_BLOG_INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
INTERVAL_MINUTES="{{CRON_INTERVAL_MINUTES}}" \
BUILDER_BLOG_ACCOUNT="$ACCT" \
"$AGENT_DIR/builder-agent-runner.sh" library-cron
then
  RUNNER_EXIT_CODE=0
else
  RUNNER_EXIT_CODE="$?"
fi
if ! SETUP_VERDICT_JSON="$(
  node "$AGENT_DIR/builder-digest.mjs" verify-library-setup-verdict \
    --file "$SETUP_VERDICT_FILE" \
    --instance-id "$EXPECTED_INSTANCE_ID" \
    --runner-exit-code "$RUNNER_EXIT_CODE"
)"; then
  echo "Initial fetch verdict verification failed (runner exit $RUNNER_EXIT_CODE)." >&2
  exit 1
fi
printf '%s\n' "$SETUP_VERDICT_JSON"
```

Report its output. This is a real run: it writes fetch-log rows, builders, and
feed items to FollowBrief. The runner's exit code is captured instead of
terminating this step immediately so the verifier can distinguish safe,
synchronized post-level failures from fatal or incomplete runs. Trust only the
JSON printed by `verify-library-setup-verdict`; do not infer that scheduling is
safe from the runner's stderr or from exit code 65 alone. If verdict verification
itself fails, report `RUNNER_EXIT_CODE` and the verifier error, then stop without
installing the schedule.

If the verifier prints `"status": "ok"`, tell the user the validation run completed
without failed post tasks, then continue automatically to step 7 and install the
original scheduled job.

If the verifier prints `"status": "needs_confirmation"`, list every failed post
task for the user with its title, source, failed stage (`read`, `summarize`, or
`sync`), and reason. Then ask whether to install the scheduled run anyway. Only
continue to step 7 if the user explicitly agrees; otherwise stop and do not
install or report an active schedule.

If the verifier prints `"status": "fatal"`, report `RUNNER_EXIT_CODE`, the
verdict code, and every available failure detail, then stop. A timeout,
discovery failure, credential/runtime failure, malformed or missing evidence,
or any other fatal verdict must never install or report an active schedule.

If this initial run surfaces an `x_token_missing` (or any `*_token_missing`)
notice, that is expected when the user declined or skipped that token in the
credential-prep step earlier. Report it as an "Action needed" notice and
continue — do NOT re-ask. That source stays in "Action needed" until its token
is added to `~/.builder-blog/secrets.json` later.

7. After `verify-library-setup-verdict` succeeds, create a same-account resume
contract beside the setup verdict and let only the bundled helper touch local
scheduler state. Do not inspect or run any unrelated OpenClaw cron, skill,
plugin, subagent, or manual verification job here. Natural-language claims and
unrelated OpenClaw cron state are insufficient: only this exact contract-bound
helper may install or confirm the FollowBrief library schedule.

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
ACCOUNT_SLUG="$(account_slug "$ACCT")"
RESUME_CONTRACT_PATH="$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/library-cron-direct/resume-contract-$EXPECTED_INSTANCE_ID.json"
SETUP_VERDICT_STATUS="$(
  node - "$SETUP_VERDICT_JSON" <<'NODE'
const verdict = JSON.parse(process.argv[2]);
if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) {
  throw new Error("Setup verdict must be a JSON object.");
}
const allowedStatuses = new Set(["ok", "needs_confirmation", "fatal"]);
if (!allowedStatuses.has(verdict.status)) {
  throw new Error(`Unsupported setup verdict status: ${String(verdict.status)}`);
}
process.stdout.write(verdict.status);
NODE
)"
FAILED_POST_DETAILS="$(
  node - "$SETUP_VERDICT_JSON" <<'NODE'
const verdict = JSON.parse(process.argv[2]);
const rows = Array.isArray(verdict.failedPosts) ? verdict.failedPosts : [];
for (const row of rows) {
  const title = typeof row?.title === "string" && row.title.trim() ? row.title.trim() : "(untitled)";
  const source = typeof row?.source === "string" && row.source.trim() ? row.source.trim() : "(unknown source)";
  const stage = typeof row?.stage === "string" && row.stage.trim() ? row.stage.trim() : "(unknown stage)";
  const reason = typeof row?.reason === "string" && row.reason.trim() ? row.reason.trim() : "(unknown reason)";
  console.log(`- ${title} | ${source} | ${stage} | ${reason}`);
}
NODE
)"
if [ "$SETUP_VERDICT_STATUS" = "fatal" ]; then
  rm -f -- "$RESUME_CONTRACT_PATH"
  echo "Fatal setup verdict; removed same-instance resume contract candidate: $RESUME_CONTRACT_PATH" >&2
  if [ -n "$FAILED_POST_DETAILS" ]; then
    printf '%s\n' "$FAILED_POST_DETAILS" >&2
  fi
  exit 1
fi
umask 077
RESUME_CONTRACT_TMP="$(mktemp "$SETUP_TMP_DIR/resume-contract-$EXPECTED_INSTANCE_ID.json.tmp.XXXXXX")"
node - "$RESUME_CONTRACT_TMP" "$ACCT" "$ACCOUNT_SLUG" "$EXPECTED_INSTANCE_ID" "$SETUP_VERDICT_STATUS" <<'NODE'
const fs = require("node:fs");
const tmpPath = process.argv[2];
const ACCT = process.argv[3];
const ACCOUNT_SLUG = process.argv[4];
const EXPECTED_INSTANCE_ID = process.argv[5];
const SETUP_VERDICT_STATUS = process.argv[6];
const contract = {
  version: 1,
  job: "library-cron",
  account: ACCT,
  accountSlug: ACCOUNT_SLUG,
  instanceId: EXPECTED_INSTANCE_ID,
  verdictStatus: SETUP_VERDICT_STATUS,
  runtime: "{{AGENT_RUNTIME}}",
  frequencyKey: "{{CRON_FREQUENCY_KEY}}",
  frequencyLabel: "{{CRON_FREQUENCY_LABEL}}",
  intervalMinutes: Number("{{CRON_INTERVAL_MINUTES}}"),
  force: "{{FETCH_FORCE}}" === "1",
  fetchDays: Number("{{FETCH_DAYS}}"),
  parallelWorkers: Number("{{PARALLEL_WORKERS}}"),
  createdAt: new Date().toISOString(),
};
fs.writeFileSync(tmpPath, `${JSON.stringify(contract, null, 2)}\n`, { mode: 0o600 });
NODE
chmod 600 "$RESUME_CONTRACT_TMP"
mv -f "$RESUME_CONTRACT_TMP" "$RESUME_CONTRACT_PATH"
printf 'Resume contract: %s\n' "$RESUME_CONTRACT_PATH"
CONFIRM_COMMAND="FOLLOWBRIEF_CONFIRM_PARTIAL=1 \"$AGENT_DIR/builder-library-cron-install.sh\" --contract \"$RESUME_CONTRACT_PATH\""
if [ "$SETUP_VERDICT_STATUS" = "needs_confirmation" ]; then
  echo 'Initial fetch completed with safe post-level failures.'
  if [ -n "$FAILED_POST_DETAILS" ]; then
    printf '%s\n' "$FAILED_POST_DETAILS"
  fi
  printf 'Exact confirmation command: %s\n' "$CONFIRM_COMMAND"
  exit 0
fi
INSTALL_STDOUT_FILE="$SETUP_TMP_DIR/install-$EXPECTED_INSTANCE_ID.stdout"
INSTALL_STDERR_FILE="$SETUP_TMP_DIR/install-$EXPECTED_INSTANCE_ID.stderr"
set +e
"$AGENT_DIR/builder-library-cron-install.sh" --contract "$RESUME_CONTRACT_PATH" >"$INSTALL_STDOUT_FILE" 2>"$INSTALL_STDERR_FILE"
INSTALL_EXIT_CODE="$?"
set -e
cat "$INSTALL_STDOUT_FILE"
cat "$INSTALL_STDERR_FILE" >&2
printf 'builder-library-cron-install.sh exit: %s\n' "$INSTALL_EXIT_CODE" >&2
if [ "$INSTALL_EXIT_CODE" -ne 0 ]; then
  echo "FollowBrief schedule is not confirmed active." >&2
  exit "$INSTALL_EXIT_CODE"
fi
if ! node - "$INSTALL_STDOUT_FILE" "$RESUME_CONTRACT_PATH" <<'NODE'
const fs = require("node:fs");
const stdoutPath = process.argv[2];
const contractPath = process.argv[3];
const stdout = fs.readFileSync(stdoutPath, "utf8");
const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (lines.length === 0) {
  throw new Error("Missing final marker line.");
}
const marker = JSON.parse(lines.at(-1));
const expectedKeys = [
  "followbriefScheduleInstall",
  "job",
  "account",
  "instanceId",
  "runtime",
  "frequencyKey",
  "ownerId",
  "startedAt",
  "localScheduler",
  "serverStatus",
];
const actualKeys = Object.keys(marker).sort();
if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
  throw new Error(`Unexpected helper marker keys: ${actualKeys.join(",")}`);
}
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
if (marker.followbriefScheduleInstall !== "ok") throw new Error("Marker status must be ok.");
if (marker.job !== "library-cron") throw new Error("Marker job mismatch.");
if (marker.account !== contract.account) throw new Error("Marker account mismatch.");
if (marker.instanceId !== contract.instanceId) throw new Error("Marker instance mismatch.");
if (marker.runtime !== contract.runtime) throw new Error("Marker runtime mismatch.");
if (marker.frequencyKey !== contract.frequencyKey) throw new Error("Marker frequency mismatch.");
if (typeof marker.ownerId !== "string" || marker.ownerId !== contract.ownerId) throw new Error("Marker ownerId mismatch.");
if (typeof marker.startedAt !== "string" || marker.startedAt !== contract.anchorAt) throw new Error("Marker startedAt mismatch.");
if (marker.localScheduler !== "launchd" && marker.localScheduler !== "crontab") throw new Error("Marker localScheduler mismatch.");
if (marker.serverStatus !== "active") throw new Error("Marker serverStatus mismatch.");
NODE
then
  echo "FollowBrief schedule is not confirmed active." >&2
  exit 1
fi
```

If step 7 printed `"status": "needs_confirmation"`, list every failed post task
for the user with its title, source, failed stage (`read`, `summarize`, or
`sync`), and reason. Then ask whether to install the scheduled run anyway. Only
continue to step 8 if the user explicitly agrees; otherwise stop and do not
install or report an active schedule.

8. When the user explicitly confirms a `needs_confirmation` result later, run
only the exact helper command that step 7 printed:
`FOLLOWBRIEF_CONFIRM_PARTIAL=1 "$AGENT_DIR/builder-library-cron-install.sh" --contract "$RESUME_CONTRACT_PATH"`.
Do not substitute another path, inspect OpenClaw cron state, invoke any other
skill/plugin/subagent, or run a manual FollowBrief verification job. Success
requires helper exit code 0 and a final nonempty stdout line that parses as the
exact JSON marker with no extra properties:
`followbriefScheduleInstall`, `job`, `account`, `instanceId`, `runtime`,
`frequencyKey`, `ownerId`, `startedAt`, `localScheduler`, and `serverStatus`.
The marker must match the live contract values (`job=library-cron`, the same
account/instance/runtime/frequency, `ownerId` equal to the updated contract,
`startedAt` equal to the updated contract anchor, `localScheduler` equal to
`launchd` or `crontab`, and `serverStatus=active`). A marker hidden in prose,
on an earlier line, malformed, missing, mismatched, or carrying any extra
property means the FollowBrief schedule is not confirmed active. Report exactly
that failure message and stop.
