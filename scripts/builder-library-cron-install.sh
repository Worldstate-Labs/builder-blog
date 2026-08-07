#!/bin/sh
set -eu

usage() {
  echo "Usage: builder-library-cron-install.sh --contract <absolute-path>" >&2
  exit 64
}

if [ "$#" -ne 2 ] || [ "${1:-}" != "--contract" ]; then
  usage
fi

CONTRACT_PATH="${2:-}"
case "$CONTRACT_PATH" in
  /*) ;;
  *) echo "Contract path must be absolute." >&2; exit 64 ;;
esac

AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
CLI="$AGENT_DIR/builder-digest.mjs"
RUNNER="$AGENT_DIR/builder-agent-runner.sh"
PLATFORM="${FOLLOWBRIEF_TEST_UNAME:-$(uname)}"
LAUNCH_AGENTS_DIR="${FOLLOWBRIEF_TEST_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"

current_host() {
  node - <<'NODE'
const os = require("node:os");
const candidate = String(process.env.FOLLOWBRIEF_TEST_HOSTNAME || os.hostname() || "unknown");
process.stdout.write(candidate.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "unknown");
NODE
}

iso_minute_now() {
  node - <<'NODE'
const raw = process.env.FOLLOWBRIEF_TEST_NOW || new Date().toISOString();
const value = new Date(raw);
if (!Number.isFinite(value.getTime())) {
  throw new Error("Invalid FOLLOWBRIEF_TEST_NOW override");
}
value.setUTCSeconds(0, 0);
process.stdout.write(value.toISOString().replace(/\.\d{3}Z$/, "Z"));
NODE
}

atomic_write_text() {
  _path="$1"
  _content="$2"
  _mode="${3:-600}"
  _dir="$(dirname "$_path")"
  mkdir -p "$_dir"
  _tmp="$_dir/.tmp.$(basename "$_path").$$"
  printf '%s\n' "$_content" > "$_tmp"
  chmod "$_mode" "$_tmp"
  mv "$_tmp" "$_path"
}

read_first_line() {
  node - "$1" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
process.stdout.write(String(fs.readFileSync(path, "utf8")).split(/\r?\n/, 1)[0].trim());
NODE
}

VALIDATED_TSV="$(AGENT_DIR="$AGENT_DIR" FOLLOWBRIEF_CONFIRM_PARTIAL="${FOLLOWBRIEF_CONFIRM_PARTIAL:-0}" node - "$CONTRACT_PATH" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const contractPath = process.argv[2];
const agentDir = process.env.AGENT_DIR;
const confirmPartial = process.env.FOLLOWBRIEF_CONFIRM_PARTIAL === "1";
const allowedInitial = new Set([
  "version",
  "job",
  "account",
  "accountSlug",
  "instanceId",
  "verdictStatus",
  "runtime",
  "frequencyKey",
  "frequencyLabel",
  "intervalMinutes",
  "force",
  "fetchDays",
  "parallelWorkers",
  "createdAt",
]);
const allowedExtended = new Set([...allowedInitial, "ownerId", "anchorAt", "completedAt", "evidence"]);
const frequencyMeta = {
  "1h": { label: "Hourly", interval: 60 },
  daily: { label: "Daily", interval: 1440 },
  weekly: { label: "Weekly", interval: 10080 },
};
const runtimes = new Set(["claude", "codex", "openclaw"]);
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const isoMinuteRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/;

function fail(message) {
  console.error(message);
  process.exit(64);
}
function slugForAccount(account) {
  const base = String(account || "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || "default";
  const hash = crypto.createHash("sha256").update(String(account || "")).digest("hex").slice(0, 8);
  return `${base}_${hash}`;
}
function validIso(value, minuteOnly = false) {
  const text = String(value || "");
  const regex = minuteOnly ? isoMinuteRe : isoRe;
  return regex.test(text) && Number.isFinite(Date.parse(text));
}
function currentHost() {
  return String(process.env.FOLLOWBRIEF_TEST_HOSTNAME || os.hostname() || "unknown")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80) || "unknown";
}

let stats;
try {
  stats = fs.statSync(contractPath);
} catch {
  fail("Contract file does not exist.");
}
if (!stats.isFile()) fail("Contract path must point to a file.");
if ((stats.mode & 0o777) !== 0o600) fail("Contract file mode must be exactly 0600.");
if (typeof process.getuid === "function" && stats.uid !== process.getuid()) fail("Contract file must be owned by the current user.");

let contract;
try {
  contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch {
  fail("Contract file must contain valid JSON.");
}
if (!contract || typeof contract !== "object" || Array.isArray(contract)) fail("Contract JSON must be an object.");
for (const key of Object.keys(contract)) {
  if (!allowedExtended.has(key)) fail(`Unknown contract key: ${key}`);
}
if (contract.version !== 1) fail("Unsupported contract version.");
if (contract.job !== "library-cron") fail("Unsupported contract job.");
if (typeof contract.account !== "string" || !contract.account.trim()) fail("Contract account is required.");
if (/[\x00-\x1f\x7f]/.test(contract.account)) fail("Contract account must not contain control characters.");
if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contract.account)) fail("Contract account must be a reasonable email address.");
if (typeof contract.accountSlug !== "string" || contract.accountSlug !== slugForAccount(contract.account)) fail("Contract account slug is invalid.");
if (typeof contract.instanceId !== "string" || !uuidRe.test(contract.instanceId)) fail("Contract instanceId is invalid.");
if (path.basename(contractPath) !== `resume-contract-${contract.instanceId}.json`) fail("Contract filename must match instanceId.");
const expectedDir = path.join(agentDir, "tmp", "accounts", contract.accountSlug, "library-cron-direct");
const realDir = fs.realpathSync(path.dirname(contractPath));
const expectedRealDir = fs.realpathSync(expectedDir);
if (realDir !== expectedRealDir) fail("Contract path must live in the account-scoped library-cron-direct directory.");
if (!["ok", "needs_confirmation"].includes(contract.verdictStatus)) fail("Unsupported verdict status.");
if (!runtimes.has(contract.runtime)) fail("Unsupported runtime.");
const freq = frequencyMeta[contract.frequencyKey];
if (!freq) fail("Unsupported frequencyKey.");
if (contract.frequencyLabel !== freq.label) fail("frequencyLabel does not match frequencyKey.");
if (Number(contract.intervalMinutes) !== freq.interval) fail("intervalMinutes does not match frequencyKey.");
if (typeof contract.force !== "boolean") fail("force must be boolean.");
if (!Number.isInteger(contract.fetchDays) || contract.fetchDays <= 0 || contract.fetchDays > 365) fail("fetchDays must be a positive integer.");
if (!Number.isInteger(contract.parallelWorkers) || contract.parallelWorkers <= 0 || contract.parallelWorkers > 32) fail("parallelWorkers must be a positive integer.");
if (!validIso(contract.createdAt, false)) fail("createdAt must be an ISO timestamp.");
if (contract.ownerId != null) {
  if (typeof contract.ownerId !== "string") fail("ownerId must be a string.");
  const parts = contract.ownerId.split(":");
  if (parts.length !== 5 || parts[0] !== "local" || parts[1] !== currentHost() || parts[2] !== contract.accountSlug || parts[3] !== "library-cron" || !uuidRe.test(parts[4])) {
    fail("ownerId must be machine/account/job bound.");
  }
}
if (contract.anchorAt != null && !validIso(contract.anchorAt, true)) fail("anchorAt must be an ISO-minute timestamp.");
if (contract.completedAt != null && !validIso(contract.completedAt, false)) fail("completedAt must be an ISO timestamp.");
if (contract.evidence != null) {
  if (!contract.completedAt) fail("evidence requires completedAt.");
  if (!contract.ownerId || !contract.anchorAt) fail("evidence requires ownerId and anchorAt.");
  if (!contract.evidence || typeof contract.evidence !== "object" || Array.isArray(contract.evidence)) fail("evidence must be an object.");
  const allowedEvidence = new Set(["localScheduler", "localLabel", "schedule", "serverStatus", "hostname"]);
  for (const key of Object.keys(contract.evidence)) {
    if (!allowedEvidence.has(key)) fail(`Unknown evidence key: ${key}`);
  }
}
if (contract.verdictStatus === "needs_confirmation" && !contract.completedAt && !confirmPartial) {
  console.error("This contract requires explicit partial-result confirmation. Re-run with FOLLOWBRIEF_CONFIRM_PARTIAL=1.");
  process.exit(65);
}

for (const [key, value] of [
  ["ACCOUNT", contract.account],
  ["ACCOUNT_SLUG", contract.accountSlug],
  ["INSTANCE_ID", contract.instanceId],
  ["VERDICT_STATUS", contract.verdictStatus],
  ["RUNTIME", contract.runtime],
  ["FREQUENCY_KEY", contract.frequencyKey],
  ["FREQUENCY_LABEL", contract.frequencyLabel],
  ["INTERVAL_MINUTES", String(contract.intervalMinutes)],
  ["FORCE", contract.force ? "1" : "0"],
  ["FETCH_DAYS", String(contract.fetchDays)],
  ["PARALLEL_WORKERS", String(contract.parallelWorkers)],
  ["CREATED_AT", contract.createdAt],
  ["OWNER_ID", contract.ownerId || ""],
  ["ANCHOR_AT", contract.anchorAt || ""],
  ["COMPLETED_AT", contract.completedAt || ""],
  ["EVIDENCE_LOCAL_SCHEDULER", contract.evidence?.localScheduler || ""],
  ["EVIDENCE_LOCAL_LABEL", contract.evidence?.localLabel || ""],
  ["EVIDENCE_SCHEDULE", contract.evidence?.schedule || ""],
  ["EVIDENCE_SERVER_STATUS", contract.evidence?.serverStatus || ""],
  ["EVIDENCE_HOSTNAME", contract.evidence?.hostname || ""],
]) {
  process.stdout.write(`${key}\t${value}\n`);
}
NODE
)"

ACCOUNT=""
ACCOUNT_SLUG=""
INSTANCE_ID=""
VERDICT_STATUS=""
RUNTIME=""
FREQUENCY_KEY=""
FREQUENCY_LABEL=""
INTERVAL_MINUTES=""
FORCE=""
FETCH_DAYS=""
PARALLEL_WORKERS=""
CREATED_AT=""
OWNER_ID=""
ANCHOR_AT=""
COMPLETED_AT=""
EVIDENCE_LOCAL_SCHEDULER=""
EVIDENCE_LOCAL_LABEL=""
EVIDENCE_SCHEDULE=""
EVIDENCE_SERVER_STATUS=""
EVIDENCE_HOSTNAME=""

TAB="$(printf '\t')"
while IFS="$TAB" read -r _key _value; do
  case "$_key" in
    ACCOUNT) ACCOUNT="$_value" ;;
    ACCOUNT_SLUG) ACCOUNT_SLUG="$_value" ;;
    INSTANCE_ID) INSTANCE_ID="$_value" ;;
    VERDICT_STATUS) VERDICT_STATUS="$_value" ;;
    RUNTIME) RUNTIME="$_value" ;;
    FREQUENCY_KEY) FREQUENCY_KEY="$_value" ;;
    FREQUENCY_LABEL) FREQUENCY_LABEL="$_value" ;;
    INTERVAL_MINUTES) INTERVAL_MINUTES="$_value" ;;
    FORCE) FORCE="$_value" ;;
    FETCH_DAYS) FETCH_DAYS="$_value" ;;
    PARALLEL_WORKERS) PARALLEL_WORKERS="$_value" ;;
    CREATED_AT) CREATED_AT="$_value" ;;
    OWNER_ID) OWNER_ID="$_value" ;;
    ANCHOR_AT) ANCHOR_AT="$_value" ;;
    COMPLETED_AT) COMPLETED_AT="$_value" ;;
    EVIDENCE_LOCAL_SCHEDULER) EVIDENCE_LOCAL_SCHEDULER="$_value" ;;
    EVIDENCE_LOCAL_LABEL) EVIDENCE_LOCAL_LABEL="$_value" ;;
    EVIDENCE_SCHEDULE) EVIDENCE_SCHEDULE="$_value" ;;
    EVIDENCE_SERVER_STATUS) EVIDENCE_SERVER_STATUS="$_value" ;;
    EVIDENCE_HOSTNAME) EVIDENCE_HOSTNAME="$_value" ;;
  esac
done <<EOF
$VALIDATED_TSV
EOF

HOSTNAME_SANITIZED="$(current_host)"
LABEL="com.followbrief.library.$ACCOUNT_SLUG"
RUNTIME_FILE="$AGENT_DIR/runtime-library-cron-$ACCOUNT_SLUG"
FORCE_FILE="$AGENT_DIR/fetch-force-library-cron-$ACCOUNT_SLUG"
DAYS_FILE="$AGENT_DIR/fetch-days-library-cron-$ACCOUNT_SLUG"
PARALLEL_FILE="$AGENT_DIR/parallel-library-cron-$ACCOUNT_SLUG"
ANCHOR_FILE="$AGENT_DIR/schedule-anchor-library-cron-$ACCOUNT_SLUG"
OWNER_FILE="$AGENT_DIR/cron-owner-library-cron-$ACCOUNT_SLUG"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
CRON_ROW="# FollowBrief library cron · $ACCOUNT"
MARKER_SCHEDULER="crontab"
if [ "$PLATFORM" = "Darwin" ]; then
  MARKER_SCHEDULER="launchd"
fi

update_contract_json() {
  UPDATE_ACTION="$1" \
  CONTRACT_PATH="$CONTRACT_PATH" \
  OWNER_ID_VALUE="${2:-}" \
  ANCHOR_AT_VALUE="${3:-}" \
  COMPLETED_AT_VALUE="${4:-}" \
  EVIDENCE_SCHEDULER_VALUE="${5:-}" \
  EVIDENCE_LABEL_VALUE="${6:-}" \
  EVIDENCE_SCHEDULE_VALUE="${7:-}" \
  EVIDENCE_STATUS_VALUE="${8:-}" \
  EVIDENCE_HOSTNAME_VALUE="${9:-}" \
  node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const contractPath = process.env.CONTRACT_PATH;
const action = process.env.UPDATE_ACTION;
const current = JSON.parse(fs.readFileSync(contractPath, "utf8"));
if (action === "owner_anchor") {
  current.ownerId = process.env.OWNER_ID_VALUE;
  current.anchorAt = process.env.ANCHOR_AT_VALUE;
} else if (action === "completed") {
  current.ownerId = process.env.OWNER_ID_VALUE;
  current.anchorAt = process.env.ANCHOR_AT_VALUE;
  current.completedAt = process.env.COMPLETED_AT_VALUE;
  current.evidence = {
    localScheduler: process.env.EVIDENCE_SCHEDULER_VALUE,
    localLabel: process.env.EVIDENCE_LABEL_VALUE,
    schedule: process.env.EVIDENCE_SCHEDULE_VALUE,
    serverStatus: process.env.EVIDENCE_STATUS_VALUE,
    hostname: process.env.EVIDENCE_HOSTNAME_VALUE,
  };
} else {
  throw new Error(`Unsupported update action: ${action}`);
}
const dir = path.dirname(contractPath);
const temp = path.join(dir, `.tmp.${path.basename(contractPath)}.${process.pid}`);
fs.writeFileSync(temp, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(temp, 0o600);
fs.renameSync(temp, contractPath);
NODE
}

write_pin_files() {
  atomic_write_text "$RUNTIME_FILE" "$RUNTIME" 600
  atomic_write_text "$FORCE_FILE" "$FORCE" 600
  atomic_write_text "$DAYS_FILE" "$FETCH_DAYS" 600
  atomic_write_text "$PARALLEL_FILE" "$PARALLEL_WORKERS" 600
  atomic_write_text "$ANCHOR_FILE" "$ANCHOR_AT" 600
  atomic_write_text "$OWNER_FILE" "$OWNER_ID" 600
}

verify_pin_files() {
  [ "$(read_first_line "$RUNTIME_FILE")" = "$RUNTIME" ] || { echo "Local runtime pin does not match contract." >&2; exit 75; }
  [ "$(read_first_line "$FORCE_FILE")" = "$FORCE" ] || { echo "Local force pin does not match contract." >&2; exit 75; }
  [ "$(read_first_line "$DAYS_FILE")" = "$FETCH_DAYS" ] || { echo "Local fetch-days pin does not match contract." >&2; exit 75; }
  [ "$(read_first_line "$PARALLEL_FILE")" = "$PARALLEL_WORKERS" ] || { echo "Local parallel-workers pin does not match contract." >&2; exit 75; }
  [ "$(read_first_line "$ANCHOR_FILE")" = "$ANCHOR_AT" ] || { echo "Local anchor pin does not match contract." >&2; exit 75; }
  [ "$(read_first_line "$OWNER_FILE")" = "$OWNER_ID" ] || { echo "Local owner pin does not match contract." >&2; exit 75; }
}

generate_schedule_spec() {
  _schedule_json="$("$CLI" schedule-spec --freq "$FREQUENCY_KEY" --anchor-at "$ANCHOR_AT")"
  PARSED_SCHEDULE_TSV="$(SCHEDULE_SPEC_JSON="$_schedule_json" EXPECTED_FREQUENCY_KEY="$FREQUENCY_KEY" EXPECTED_ANCHOR_AT="$ANCHOR_AT" node - <<'NODE'
  const payload = JSON.parse(String(process.env.SCHEDULE_SPEC_JSON || ""));
  function fail(message) {
    console.error(message);
    process.exit(75);
  }
  if (!payload || typeof payload !== "object") fail("schedule-spec returned invalid JSON.");
  if (payload.status !== "ok") fail("schedule-spec did not report ok.");
  if (payload.freq !== process.env.EXPECTED_FREQUENCY_KEY) fail("schedule-spec frequency does not match contract.");
  if (payload.anchorAt !== process.env.EXPECTED_ANCHOR_AT) fail("schedule-spec anchor does not match contract.");
  if (typeof payload.cron !== "string" || !payload.cron.trim()) fail("schedule-spec cron expression is missing.");
  if (typeof payload.launchdXml !== "string" || !payload.launchdXml.trim()) fail("schedule-spec launchd XML is missing.");
  if (typeof payload.statusSchedule !== "string" || !payload.statusSchedule.trim()) fail("schedule-spec status schedule is missing.");
  if (payload.statusSchedule !== `anchor:${payload.cron}`) fail("schedule-spec status schedule does not match cron expression.");
  for (const [key, value] of [
    ["CRON_EXPR", payload.cron],
    ["EXPECTED_LAUNCHD_XML_B64", Buffer.from(String(payload.launchdXml), "utf8").toString("base64")],
    ["SCHEDULE_STATUS", payload.statusSchedule],
    ["SCHEDULE_TIME_ZONE", payload.timeZone == null ? "" : String(payload.timeZone)],
  ]) {
    process.stdout.write(`${key}\t${String(value)}\n`);
  }
NODE
)"
  PARSED_SCHEDULE_TSV="$PARSED_SCHEDULE_TSV" node - <<'NODE'
const allowed = new Set(["CRON_EXPR", "EXPECTED_LAUNCHD_XML_B64", "SCHEDULE_STATUS", "SCHEDULE_TIME_ZONE"]);
for (const line of String(process.env.PARSED_SCHEDULE_TSV || "").split(/\n/)) {
  if (!line) continue;
  const [key] = line.split("\t");
  if (!allowed.has(key)) {
    console.error(`Unexpected parsed schedule key: ${key}`);
    process.exit(75);
  }
}
NODE
  while IFS="$TAB" read -r _key _value; do
    case "$_key" in
      CRON_EXPR) CRON_EXPR="$_value" ;;
      EXPECTED_LAUNCHD_XML_B64) EXPECTED_LAUNCHD_XML="$(printf '%s' "$_value" | node -e 'const fs=require("node:fs"); process.stdout.write(Buffer.from(fs.readFileSync(0,"utf8").trim(),"base64").toString("utf8"))')";;
      SCHEDULE_STATUS) SCHEDULE_STATUS="$_value" ;;
      SCHEDULE_TIME_ZONE) SCHEDULE_TIME_ZONE="$_value" ;;
    esac
  done <<EOF
$PARSED_SCHEDULE_TSV
EOF
}

wait_for_launchd_absent() {
  _label="$1"
  _remaining=30
  while [ "$_remaining" -gt 0 ]; do
    if ! launchctl print "gui/$(id -u)/$_label" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    _remaining=$((_remaining - 1))
  done
  ! launchctl print "gui/$(id -u)/$_label" >/dev/null 2>&1
}

install_launchd() {
  mkdir -p "$LAUNCH_AGENTS_DIR" "$AGENT_DIR/logs"
  "$CLI" cron-audit --job library-cron --event launchd_bootout_start --label "$LABEL" --plist-exists "$([ -f "$PLIST_PATH" ] && echo 1 || echo 0)" >/dev/null
  BOOTOUT_CODE=0
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || BOOTOUT_CODE="$?"
  "$CLI" cron-audit --job library-cron --event launchd_bootout_finished --label "$LABEL" --plist-exists "$([ -f "$PLIST_PATH" ] && echo 1 || echo 0)" --reason "exit_$BOOTOUT_CODE" >/dev/null
  if ! wait_for_launchd_absent "$LABEL"; then
    echo "Timed out waiting for launchd to unload $LABEL." >&2
    exit 75
  fi
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key>
<array>
<string>$RUNNER</string>
<string>library-cron</string>
</array>
<key>EnvironmentVariables</key>
<dict>
<key>BUILDER_BLOG_ACCOUNT</key><string>$ACCOUNT</string>
<key>BUILDER_BLOG_SCHEDULER_TICK</key><string>1</string>
<key>BUILDER_BLOG_INTERVAL_MINUTES</key><string>$INTERVAL_MINUTES</string>
<key>INTERVAL_MINUTES</key><string>$INTERVAL_MINUTES</string>
</dict>
$EXPECTED_LAUNCHD_XML
<key>StandardOutPath</key><string>$AGENT_DIR/logs/$LABEL.log</string>
<key>StandardErrorPath</key><string>$AGENT_DIR/logs/$LABEL.log</string>
</dict>
</plist>
EOF
  launchctl enable "gui/$(id -u)/$LABEL"
  if launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"; then
    "$CLI" cron-audit --job library-cron --event launchd_bootstrap_succeeded --label "$LABEL" --plist-exists 1 --reason setup_install >/dev/null
  else
    BOOTSTRAP_CODE="$?"
    "$CLI" cron-audit --job library-cron --event launchd_bootstrap_failed --label "$LABEL" --plist-exists 1 --reason "exit_$BOOTSTRAP_CODE" >/dev/null
    exit "$BOOTSTRAP_CODE"
  fi
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || {
    echo "LaunchAgent did not load successfully." >&2
    exit 75
  }
}

install_crontab() {
  mkdir -p "$AGENT_DIR/logs"
  CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"
  FILTERED_CRONTAB="$(CURRENT_CRONTAB="$CURRENT_CRONTAB" ACCOUNT="$ACCOUNT" RUNNER="$RUNNER" node - <<'NODE'
const current = String(process.env.CURRENT_CRONTAB || "");
const account = String(process.env.ACCOUNT || "");
const runner = String(process.env.RUNNER || "");
const comment = `# FollowBrief library cron · ${account}`;
const accountToken = `BUILDER_BLOG_ACCOUNT="${account}"`;
const output = [];
for (const line of current.split(/\n/)) {
  if (!line) continue;
  if (line === comment) continue;
  const removeRow =
    line.includes(accountToken) &&
    line.includes(runner) &&
    /\bbuilder-agent-runner\.sh library-cron\b/.test(line);
  if (removeRow) continue;
  output.push(line);
}
process.stdout.write(output.join("\n"));
NODE
)"
  (
    if [ -n "$FILTERED_CRONTAB" ]; then
      printf '%s\n' "$FILTERED_CRONTAB"
    fi
    printf '# FollowBrief library cron · %s\n%s BUILDER_BLOG_ACCOUNT="%s" %s library-cron >> %s/logs/%s.log 2>&1\n' "$ACCOUNT" "$CRON_EXPR" "$ACCOUNT" "$RUNNER" "$AGENT_DIR" "$LABEL"
  ) | crontab -
  "$CLI" cron-audit --job library-cron --event crontab_install_succeeded --label "$LABEL" --reason setup_install >/dev/null
  crontab -l | grep 'builder-agent-runner.sh library-cron' >/dev/null 2>&1 || {
    echo "Crontab row was not installed." >&2
    exit 75
  }
}

verify_local_scheduler() {
  if [ "$MARKER_SCHEDULER" = "launchd" ]; then
    [ -f "$PLIST_PATH" ] || { echo "FollowBrief LaunchAgent plist is missing." >&2; exit 75; }
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || {
      echo "FollowBrief LaunchAgent is not loaded." >&2
      exit 75
    }
    EXPECTED_LAUNCHD_XML="$EXPECTED_LAUNCHD_XML" EXPECTED_LABEL="$LABEL" EXPECTED_RUNNER="$RUNNER" EXPECTED_ACCOUNT="$ACCOUNT" EXPECTED_INTERVAL="$INTERVAL_MINUTES" PLIST_PATH="$PLIST_PATH" node - <<'NODE'
const fs = require("node:fs");
const plistPath = process.env.PLIST_PATH;
const expectedLabel = process.env.EXPECTED_LABEL;
const expectedRunner = process.env.EXPECTED_RUNNER;
const expectedLaunchdXml = String(process.env.EXPECTED_LAUNCHD_XML || "");
const expectedAccount = process.env.EXPECTED_ACCOUNT;
const expectedInterval = process.env.EXPECTED_INTERVAL;
const plist = fs.readFileSync(plistPath, "utf8");
function fail(message) {
  console.error(message);
  process.exit(75);
}
const normalized = plist.replace(/\s+/g, " ");
const normalizedExpectedXml = expectedLaunchdXml.replace(/\s+/g, " ").trim();
if (!normalized.includes(`<key>Label</key><string>${expectedLabel}</string>`)) fail("LaunchAgent label does not match contract.");
if (!/<key>ProgramArguments<\/key>\s*<array>\s*<string>[^<]*builder-agent-runner\.sh<\/string>\s*<string>library-cron<\/string>\s*<\/array>/s.test(plist)) {
  fail("LaunchAgent program arguments do not match the library-cron runner.");
}
if (!normalized.includes(`<string>${expectedRunner}</string>`)) fail("LaunchAgent runner path does not match contract.");
if (!normalized.includes(normalizedExpectedXml)) fail("LaunchAgent StartCalendarInterval does not match the regenerated schedule.");
const envMatch = plist.match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/);
if (!envMatch) fail("LaunchAgent EnvironmentVariables block is missing.");
const envEntries = [...envMatch[1].matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)];
const envMap = Object.fromEntries(envEntries.map((match) => [match[1], match[2]]));
if (envMap.BUILDER_BLOG_ACCOUNT !== expectedAccount) fail("LaunchAgent account binding does not match contract.");
if (envMap.BUILDER_BLOG_SCHEDULER_TICK !== "1") fail("LaunchAgent scheduler tick flag does not match contract.");
if (envMap.BUILDER_BLOG_INTERVAL_MINUTES !== expectedInterval) fail("LaunchAgent interval binding does not match contract.");
if (envMap.INTERVAL_MINUTES !== expectedInterval) fail("LaunchAgent INTERVAL_MINUTES binding does not match contract.");
NODE
  else
    CRONTAB_CONTENT="$(crontab -l 2>/dev/null || true)"
    printf '%s\n' "$CRONTAB_CONTENT" | grep -F "$CRON_ROW" >/dev/null 2>&1 || {
      echo "FollowBrief crontab comment is missing." >&2
      exit 75
    }
    EXPECTED_ROW="$CRON_EXPR BUILDER_BLOG_ACCOUNT=\"$ACCOUNT\" $RUNNER library-cron >> $AGENT_DIR/logs/$LABEL.log 2>&1"
    printf '%s\n' "$CRONTAB_CONTENT" | grep -Fx "$EXPECTED_ROW" >/dev/null 2>&1 || {
      echo "FollowBrief crontab row does not match the regenerated schedule." >&2
      exit 75
    }
  fi
}

verify_server_state() {
  _state_json="$1"
  CRON_STATE_JSON="$_state_json" \
  EXPECTED_HOST="$HOSTNAME_SANITIZED" \
  EXPECTED_RUNTIME="$RUNTIME" \
  EXPECTED_FREQUENCY_KEY="$FREQUENCY_KEY" \
  EXPECTED_FREQUENCY_LABEL="$FREQUENCY_LABEL" \
  EXPECTED_FORCE="$FORCE" \
  EXPECTED_OWNER_ID="$OWNER_ID" \
  EXPECTED_STARTED_AT="$ANCHOR_AT" \
  EXPECTED_SCHEDULE="$SCHEDULE_STATUS" \
  node - <<'NODE'
const state = JSON.parse(String(process.env.CRON_STATE_JSON || ""));
function fail(message) {
  console.error(message);
  process.exit(75);
}
if (!state || typeof state !== "object") fail("cron-state returned invalid JSON.");
if (state.status !== "active") fail("Server cron-state is not active.");
if (state.runtime !== process.env.EXPECTED_RUNTIME) fail("Server runtime does not match contract.");
if (state.frequencyKey !== process.env.EXPECTED_FREQUENCY_KEY) fail("Server frequency does not match contract.");
if (state.frequencyLabel !== process.env.EXPECTED_FREQUENCY_LABEL) fail("Server frequency label does not match contract.");
if (String(Boolean(state.overrideFetched)) !== String(process.env.EXPECTED_FORCE === "1")) fail("Server force setting does not match contract.");
if (state.ownerId !== process.env.EXPECTED_OWNER_ID) fail("Server ownerId does not match contract.");
if (state.startedAt !== process.env.EXPECTED_STARTED_AT) fail("Server startedAt does not match contract.");
if (state.hostname !== process.env.EXPECTED_HOST) fail("Server hostname does not match current host.");
if (state.schedule !== process.env.EXPECTED_SCHEDULE) fail("Server schedule does not match generated schedule.");
NODE
}

verify_completed_evidence() {
  [ "$EVIDENCE_LOCAL_SCHEDULER" = "$MARKER_SCHEDULER" ] || {
    echo "Completed contract localScheduler evidence does not match live state." >&2
    exit 75
  }
  [ "$EVIDENCE_LOCAL_LABEL" = "$LABEL" ] || {
    echo "Completed contract localLabel evidence does not match live state." >&2
    exit 75
  }
  [ "$EVIDENCE_SCHEDULE" = "$SCHEDULE_STATUS" ] || {
    echo "Completed contract schedule evidence does not match live state." >&2
    exit 75
  }
  [ "$EVIDENCE_SERVER_STATUS" = "active" ] || {
    echo "Completed contract serverStatus evidence does not match live state." >&2
    exit 75
  }
  [ "$EVIDENCE_HOSTNAME" = "$HOSTNAME_SANITIZED" ] || {
    echo "Completed contract hostname evidence does not match live state." >&2
    exit 75
  }
}

emit_marker() {
  node - <<'NODE'
const marker = {
  followbriefScheduleInstall: "ok",
  job: "library-cron",
  account: process.env.MARKER_ACCOUNT,
  instanceId: process.env.MARKER_INSTANCE_ID,
  runtime: process.env.MARKER_RUNTIME,
  frequencyKey: process.env.MARKER_FREQUENCY_KEY,
  ownerId: process.env.MARKER_OWNER_ID,
  startedAt: process.env.MARKER_STARTED_AT,
  localScheduler: process.env.MARKER_LOCAL_SCHEDULER,
  serverStatus: "active",
};
process.stdout.write(`${JSON.stringify(marker)}\n`);
NODE
}

if [ -z "$OWNER_ID" ]; then
  OWNER_ID="$(HOSTNAME_SANITIZED="$HOSTNAME_SANITIZED" ACCOUNT_SLUG="$ACCOUNT_SLUG" FOLLOWBRIEF_TEST_OWNER_UUID="${FOLLOWBRIEF_TEST_OWNER_UUID:-}" node - <<'NODE'
const { randomUUID } = require("node:crypto");
const host = process.env.HOSTNAME_SANITIZED;
const slug = process.env.ACCOUNT_SLUG;
const uuid = process.env.FOLLOWBRIEF_TEST_OWNER_UUID || randomUUID();
process.stdout.write(`local:${host}:${slug}:library-cron:${uuid}`);
NODE
)"
fi
if [ -z "$ANCHOR_AT" ]; then
  ANCHOR_AT="$(iso_minute_now)"
fi

if [ -n "$COMPLETED_AT" ]; then
  verify_pin_files
  generate_schedule_spec
  verify_completed_evidence
  verify_local_scheduler
  CRON_STATE_JSON="$("$CLI" cron-state --job library-cron)"
  verify_server_state "$CRON_STATE_JSON"
  MARKER_ACCOUNT="$ACCOUNT" MARKER_INSTANCE_ID="$INSTANCE_ID" MARKER_RUNTIME="$RUNTIME" MARKER_FREQUENCY_KEY="$FREQUENCY_KEY" MARKER_OWNER_ID="$OWNER_ID" MARKER_STARTED_AT="$ANCHOR_AT" MARKER_LOCAL_SCHEDULER="$MARKER_SCHEDULER" emit_marker
  exit 0
fi

update_contract_json owner_anchor "$OWNER_ID" "$ANCHOR_AT"
write_pin_files
verify_pin_files
generate_schedule_spec

if [ "$MARKER_SCHEDULER" = "launchd" ]; then
  install_launchd
else
  install_crontab
fi

verify_local_scheduler

"$CLI" cron-status \
  --job library-cron \
  --status active \
  --freq "$FREQUENCY_KEY" \
  --label "$FREQUENCY_LABEL" \
  --schedule "$SCHEDULE_STATUS" \
  --started-at "$ANCHOR_AT" \
  --runtime "$RUNTIME" \
  --owner-id "$OWNER_ID" \
  --force "$FORCE" >/dev/null

CRON_STATE_JSON="$("$CLI" cron-state --job library-cron)"
verify_server_state "$CRON_STATE_JSON"

COMPLETED_AT="$(iso_minute_now)"
update_contract_json completed "$OWNER_ID" "$ANCHOR_AT" "$COMPLETED_AT" "$MARKER_SCHEDULER" "$LABEL" "$SCHEDULE_STATUS" "active" "$HOSTNAME_SANITIZED"

MARKER_ACCOUNT="$ACCOUNT" MARKER_INSTANCE_ID="$INSTANCE_ID" MARKER_RUNTIME="$RUNTIME" MARKER_FREQUENCY_KEY="$FREQUENCY_KEY" MARKER_OWNER_ID="$OWNER_ID" MARKER_STARTED_AT="$ANCHOR_AT" MARKER_LOCAL_SCHEDULER="$MARKER_SCHEDULER" emit_marker
