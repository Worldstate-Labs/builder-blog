import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

type JsonRecord = Record<string, unknown>;

type Contract = {
  version: 1;
  job: "library-cron";
  account: string;
  accountSlug: string;
  instanceId: string;
  verdictStatus: "ok" | "needs_confirmation";
  runtime: "claude" | "codex" | "openclaw";
  frequencyKey: "daily" | "weekly";
  frequencyLabel: "Daily" | "Weekly";
  intervalMinutes: 1440 | 10080;
  force: boolean;
  fetchDays: number;
  parallelWorkers: number;
  createdAt: string;
  ownerId?: string;
  anchorAt?: string;
  completedAt?: string;
  evidence?: JsonRecord;
};

type Harness = {
  platform: "Darwin" | "Linux";
  rootDir: string;
  homeDir: string;
  agentDir: string;
  launchAgentsDir: string;
  fakeBinDir: string;
  contractPath: string;
  mutationLogPath: string;
  launchctlStatePath: string;
  serverControlPath: string;
  openclawLogPath: string;
  crontabPath: string;
  contract: Contract;
  ownerId: string;
  anchorAt: string;
  scheduleStatus: string;
  label: string;
};

type DriftScenario = {
  name: string;
  setup: (harness: Harness) => Promise<void>;
  verify?: (harness: Harness) => Promise<void>;
};

const repoRoot = process.cwd();
const helperPath = join(repoRoot, "scripts", "builder-library-cron-install.sh");

const ACCOUNT = "test@example.com";
const ACCOUNT_SLUG = "test_example_com_973dfe46";
const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_UUID = "22222222-2222-4222-8222-222222222222";
const HOSTNAME = "followbrief-test-host";
const CREATED_AT = "2026-08-07T15:24:00Z";
const ANCHOR_AT = "2026-08-07T15:24:00Z";
const LABEL = `com.followbrief.library.${ACCOUNT_SLUG}`;
const OWNER_ID = `local:${HOSTNAME}:${ACCOUNT_SLUG}:library-cron:${OWNER_UUID}`;
const SCHEDULE_STATUS = "anchor:24 15 * * *";
const FORBIDDEN_KEYS = new Set([
  "bearerToken",
  "exchangeCode",
  "prompt",
  "credentials",
  "credentialJson",
  "env",
  "environment",
  "environmentSnapshot",
]);
const INITIAL_KEYS = [
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
] as const;
const EXTENDED_KEYS = [...INITIAL_KEYS, "ownerId", "anchorAt", "completedAt", "evidence"] as const;

function accountSlugFor(account: string): string {
  const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
  const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
  return `${base}_${hash}`;
}

function scheduleSpecFor(freq: Contract["frequencyKey"], anchorAt = ANCHOR_AT) {
  const date = new Date(anchorAt);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const weekday = date.getUTCDay();
  if (freq === "weekly") {
    return {
      cron: `${minute} ${hour} * * ${weekday}`,
      launchd: `<key>StartCalendarInterval</key>\n  <dict><key>Weekday</key><integer>${weekday}</integer><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`,
      status: `anchor:${minute} ${hour} * * ${weekday}`,
    };
  }
  return {
    cron: `${minute} ${hour} * * *`,
    launchd: `<key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`,
    status: `anchor:${minute} ${hour} * * *`,
  };
}

function expectedCrontabRow(harness: Harness, cronExpr = scheduleSpecFor(harness.contract.frequencyKey, harness.anchorAt).cron) {
  return `${cronExpr} BUILDER_BLOG_ACCOUNT="${harness.contract.account}" ${join(harness.agentDir, "builder-agent-runner.sh")} library-cron >> ${join(harness.agentDir, "logs", `${harness.label}.log`)} 2>&1`;
}

function baseContract(overrides: Partial<Contract> = {}): Contract {
  return {
    version: 1,
    job: "library-cron",
    account: ACCOUNT,
    accountSlug: ACCOUNT_SLUG,
    instanceId: INSTANCE_ID,
    verdictStatus: "needs_confirmation",
    runtime: "openclaw",
    frequencyKey: "daily",
    frequencyLabel: "Daily",
    intervalMinutes: 1440,
    force: true,
    fetchDays: 14,
    parallelWorkers: 3,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

async function writeExecutable(path: string, content: string) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function writeContract(path: string, contract: Contract, mode = 0o600) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  await chmod(path, mode);
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
}

function source(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function extractHeredoc(text: string, startMarker: string): string {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `Expected to find ${JSON.stringify(startMarker)}`);
  const bodyStart = text.indexOf("\n", start) + 1;
  const end = text.indexOf("\nNODE", bodyStart);
  assert.ok(end > bodyStart, "Expected a closing NODE heredoc delimiter");
  return text.slice(bodyStart, end);
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function walk(current: string, prefix: string) {
    let entries: string[];
    try {
      entries = (await readdir(current)).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const details = await stat(fullPath);
      if (details.isDirectory()) {
        snapshot[`${relative}/`] = "<dir>";
        await walk(fullPath, relative);
      } else {
        snapshot[relative] = await readFile(fullPath, "utf8");
      }
    }
  }
  await walk(root, "");
  return snapshot;
}

function finalNonEmptyLine(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function parseMarker(stdout: string): JsonRecord | null {
  const line = finalNonEmptyLine(stdout);
  if (!line) return null;
  try {
    return JSON.parse(line) as JsonRecord;
  } catch {
    return null;
  }
}

async function readMutationLog(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readJsonLines(path: string): Promise<JsonRecord[]> {
  const text = await readMutationLog(path);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

function countEvents(entries: JsonRecord[], command: string): number {
  return entries.filter((entry) => entry.command === command).length;
}

function countWhere(entries: JsonRecord[], predicate: (entry: JsonRecord) => boolean): number {
  return entries.filter(predicate).length;
}

function assertNoForbiddenProperties(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenProperties(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!FORBIDDEN_KEYS.has(key), `unexpected persisted key: ${key}`);
    assertNoForbiddenProperties(nested);
  }
}

function assertExactKeys(record: JsonRecord, keys: readonly string[]) {
  assert.deepEqual(Object.keys(record).sort(), [...keys].sort());
}

function assertPinText(text: string, expected: string) {
  assert.equal(text.trim(), expected);
}

async function seedCompletedLocalState(
  harness: Harness,
  overrides: {
    runtime?: string;
    force?: boolean;
    fetchDays?: number;
    parallelWorkers?: number;
    anchorAt?: string;
    ownerId?: string;
    writePlist?: boolean;
    launchctlLoaded?: boolean;
  } = {},
) {
  const runtime = overrides.runtime ?? harness.contract.runtime;
  const force = overrides.force ?? harness.contract.force;
  const fetchDays = overrides.fetchDays ?? harness.contract.fetchDays;
  const parallelWorkers = overrides.parallelWorkers ?? harness.contract.parallelWorkers;
  const anchorAt = overrides.anchorAt ?? harness.anchorAt;
  const ownerId = overrides.ownerId ?? harness.ownerId;

  const files = [
    [`runtime-library-cron-${harness.contract.accountSlug}`, runtime],
    [`fetch-force-library-cron-${harness.contract.accountSlug}`, force ? "1" : "0"],
    [`fetch-days-library-cron-${harness.contract.accountSlug}`, String(fetchDays)],
    [`parallel-library-cron-${harness.contract.accountSlug}`, String(parallelWorkers)],
    [`schedule-anchor-library-cron-${harness.contract.accountSlug}`, anchorAt],
    [`cron-owner-library-cron-${harness.contract.accountSlug}`, ownerId],
  ] as const;
  for (const [name, value] of files) {
    const path = join(harness.agentDir, name);
    await writeFile(path, `${value}\n`, "utf8");
    await chmod(path, 0o600);
  }

  if (harness.platform === "Darwin") {
    if (overrides.writePlist !== false) {
      await writeFile(
        join(harness.launchAgentsDir, `${harness.label}.plist`),
        `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n<key>Label</key><string>${harness.label}</string>\n<key>ProgramArguments</key>\n<array>\n<string>${join(harness.agentDir, "builder-agent-runner.sh")}</string>\n<string>library-cron</string>\n</array>\n${scheduleSpecFor(harness.contract.frequencyKey, anchorAt).launchd}\n</dict>\n</plist>\n`,
        "utf8",
      );
    }
  } else {
    await writeFile(
      harness.crontabPath,
      `# FollowBrief library cron · ${harness.contract.account}\n${expectedCrontabRow(harness, scheduleSpecFor(harness.contract.frequencyKey, anchorAt).cron)}\n`,
      "utf8",
    );
  }

  const launchctlState = {
    loaded: overrides.launchctlLoaded === false
      ? {}
      : {
          [harness.label]: {
            plist: join(harness.launchAgentsDir, `${harness.label}.plist`),
            program: join(harness.agentDir, "builder-agent-runner.sh"),
          },
        },
  };
  await writeFile(harness.launchctlStatePath, `${JSON.stringify(launchctlState, null, 2)}\n`, "utf8");
}

async function seedScheduleScratchState(harness: Harness) {
  const scratchDir = join(harness.agentDir, "tmp", "accounts", harness.contract.accountSlug, "library-cron-schedule");
  await mkdir(scratchDir, { recursive: true });
  await writeFile(join(scratchDir, "cron.txt"), "sentinel cron\n", "utf8");
  await writeFile(join(scratchDir, "launchd.xml"), "<sentinel />\n", "utf8");
  await writeFile(join(scratchDir, "status.txt"), "sentinel status\n", "utf8");
  await writeFile(join(scratchDir, "timezone.txt"), "Mars/Olympus\n", "utf8");
  await writeFile(join(scratchDir, "cron-state-readback.json"), "{\"sentinel\":true}\n", "utf8");
  await writeFile(join(scratchDir, "custom.txt"), "custom scratch\n", "utf8");
  return scratchDir;
}

async function setServerState(
  harness: Harness,
  overrides: Partial<{
    status: string;
    frequencyKey: string;
    frequencyLabel: string;
    schedule: string;
    runtime: string;
    overrideFetched: boolean;
    ownerId: string;
    startedAt: string;
    hostname: string;
    applyCronStatus: boolean;
  }> = {},
) {
  const payload = {
    account: harness.contract.account,
    hostname: overrides.hostname ?? HOSTNAME,
    applyCronStatus: overrides.applyCronStatus ?? true,
    cronState: {
      job: "library-cron",
      status: overrides.status ?? "active",
      frequencyKey: overrides.frequencyKey ?? harness.contract.frequencyKey,
      frequencyLabel: overrides.frequencyLabel ?? harness.contract.frequencyLabel,
      schedule: overrides.schedule ?? harness.scheduleStatus,
      runtime: overrides.runtime ?? harness.contract.runtime,
      overrideFetched: overrides.overrideFetched ?? harness.contract.force,
      ownerId: overrides.ownerId ?? harness.ownerId,
      startedAt: new Date(overrides.startedAt ?? harness.anchorAt).toISOString(),
      hostname: overrides.hostname ?? HOSTNAME,
    },
  };
  await writeFile(harness.serverControlPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function makeHarness(
  contractOverrides: Partial<Contract> = {},
  options: { platform?: "Darwin" | "Linux" } = {},
): Promise<Harness> {
  const platform = options.platform ?? "Darwin";
  const rootDir = await mkdtemp(join(tmpdir(), "library-cron-install-"));
  const homeDir = join(rootDir, "home");
  const agentDir = join(homeDir, ".builder-blog");
  const launchAgentsDir = join(homeDir, "Library", "LaunchAgents");
  const fakeBinDir = join(rootDir, "fake-bin");
  const contractPath = join(
    agentDir,
    "tmp",
    "accounts",
    contractOverrides.accountSlug ?? ACCOUNT_SLUG,
    "library-cron-direct",
    `resume-contract-${INSTANCE_ID}.json`,
  );
  const mutationLogPath = join(rootDir, "mutations.jsonl");
  const launchctlStatePath = join(rootDir, "launchctl-state.json");
  const serverControlPath = join(rootDir, "server-control.json");
  const openclawLogPath = join(rootDir, "openclaw.log");
  const crontabPath = join(rootDir, "crontab.txt");
  const contract = baseContract(contractOverrides);
  const schedule = scheduleSpecFor(contract.frequencyKey, ANCHOR_AT);

  await mkdir(agentDir, { recursive: true });
  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(mutationLogPath, "", "utf8");
  await writeFile(openclawLogPath, "", "utf8");
  await writeFile(crontabPath, "", "utf8");
  await writeFile(launchctlStatePath, `${JSON.stringify({ loaded: {} }, null, 2)}\n`, "utf8");
  await setServerState(
    {
      platform,
      rootDir,
      homeDir,
      agentDir,
      launchAgentsDir,
      fakeBinDir,
      contractPath,
      mutationLogPath,
      launchctlStatePath,
      serverControlPath,
      openclawLogPath,
      crontabPath,
      contract,
      ownerId: OWNER_ID,
      anchorAt: ANCHOR_AT,
      scheduleStatus: schedule.status,
      label: `com.followbrief.library.${contract.accountSlug}`,
    },
    { status: "stopped" },
  );
  await writeContract(contractPath, contract);

  await writeFile(join(agentDir, "builder-agent-runner.sh"), "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(join(agentDir, "builder-agent-runner.sh"), 0o755);
  await writeFile(join(agentDir, "logs", ".keep"), "", "utf8").catch(async () => {
    await mkdir(join(agentDir, "logs"), { recursive: true });
    await writeFile(join(agentDir, "logs", ".keep"), "", "utf8");
  });

  await writeExecutable(
    join(agentDir, "builder-digest.mjs"),
    `#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";

const command = process.argv[2];
const args = process.argv.slice(3);
const logFile = process.env.FOLLOWBRIEF_TEST_MUTATION_LOG_FILE;
const serverFile = process.env.FOLLOWBRIEF_TEST_SERVER_CONTROL_FILE;

function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}
function append(entry) {
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\\n");
}
function loadServer() {
  return JSON.parse(fs.readFileSync(serverFile, "utf8"));
}
function saveServer(value) {
  fs.writeFileSync(serverFile, JSON.stringify(value, null, 2) + "\\n");
}
function scheduleForAnchor(freq, anchorAt) {
  const date = new Date(anchorAt);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const weekday = date.getUTCDay();
  if (freq === "weekly") {
    return {
      cron: minute + " " + hour + " * * " + weekday,
      launchd: "<key>StartCalendarInterval</key>\\n  <dict><key>Weekday</key><integer>" + weekday + "</integer><key>Hour</key><integer>" + hour + "</integer><key>Minute</key><integer>" + minute + "</integer></dict>",
    };
  }
  return {
    cron: minute + " " + hour + " * * *",
    launchd: "<key>StartCalendarInterval</key>\\n  <dict><key>Hour</key><integer>" + hour + "</integer><key>Minute</key><integer>" + minute + "</integer></dict>",
  };
}
const requiredAccount = loadServer().account;
if (process.env.BUILDER_BLOG_ACCOUNT !== requiredAccount) {
  console.error("builder-digest account context is missing");
  process.exit(66);
}
append({ command, args });
if (command === "schedule-spec") {
  const freq = arg("--freq") ?? "daily";
  const anchorAt = arg("--anchor-at") ?? fs.readFileSync(arg("--anchor-file"), "utf8").trim();
  const spec = scheduleForAnchor(freq, anchorAt);
  const status = "anchor:" + spec.cron;
  const timezone = "UTC";
  if (arg("--cron-out")) fs.writeFileSync(arg("--cron-out"), spec.cron + "\\n");
  if (arg("--launchd-out")) fs.writeFileSync(arg("--launchd-out"), spec.launchd + "\\n");
  if (arg("--status-out")) fs.writeFileSync(arg("--status-out"), status + "\\n");
  if (arg("--timezone-out")) fs.writeFileSync(arg("--timezone-out"), timezone + "\\n");
  console.log(JSON.stringify({ status: "ok", freq, anchorAt, cron: spec.cron, launchdXml: spec.launchd, statusSchedule: status, timeZone: timezone }, null, 2));
  process.exit(0);
}
if (command === "cron-audit") {
  console.log(JSON.stringify({ ok: true }, null, 2));
  process.exit(0);
}
if (command === "cron-status") {
  const server = loadServer();
  const payload = {
    job: arg("--job"),
    status: arg("--status"),
    frequencyKey: arg("--freq"),
    frequencyLabel: arg("--label"),
    schedule: arg("--schedule"),
    runtime: arg("--runtime"),
    overrideFetched: arg("--force") === "1",
    ownerId: arg("--owner-id"),
    startedAt: arg("--started-at"),
    hostname: server.hostname ?? os.hostname(),
  };
  append({ command, payload });
  if (server.applyCronStatus !== false) {
    server.cronState = {
      ...payload,
      startedAt: new Date(payload.startedAt).toISOString(),
    };
    saveServer(server);
  }
  console.log(JSON.stringify({ ok: true, payload }, null, 2));
  process.exit(0);
}
if (command === "cron-state") {
  const server = loadServer();
  console.log(JSON.stringify({ job: server.cronState }, null, 2));
  process.exit(0);
}
console.error("unsupported command: " + command);
process.exit(64);
`,
  );

  await writeExecutable(
    join(fakeBinDir, "launchctl"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const stateFile = process.env.FOLLOWBRIEF_TEST_LAUNCHCTL_STATE_FILE;
const logFile = process.env.FOLLOWBRIEF_TEST_MUTATION_LOG_FILE;

function load() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { loaded: {} };
  }
}
function save(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\\n");
}
function log(entry) {
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\\n");
}

const state = load();
const command = args[0];
log({ command: "launchctl." + command, args });

if (command === "print") {
  const label = String(args[1] || "").split("/").pop();
  const loaded = state.loaded?.[label];
  if (!loaded) process.exit(1);
  process.stdout.write("state = running\\n");
  process.stdout.write("program = " + (loaded.program || "builder-agent-runner.sh") + "\\n");
  process.exit(0);
}

if (command === "bootout") {
  const label = String(args[1] || "").split("/").pop();
  if (state.loaded) delete state.loaded[label];
  save(state);
  process.exit(0);
}

if (command === "enable") process.exit(0);

if (command === "bootstrap") {
  const plist = args[2];
  const label = path.basename(plist, ".plist");
  const plistText = fs.readFileSync(plist, "utf8");
  const match = plistText.match(/<string>([^<]*builder-agent-runner\\.sh)<\\/string>/);
  state.loaded ||= {};
  state.loaded[label] = { plist, program: match ? match[1] : "builder-agent-runner.sh" };
  save(state);
  process.exit(0);
}

console.error("unsupported launchctl command");
process.exit(64);
`,
  );

  await writeExecutable(
    join(fakeBinDir, "crontab"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = process.env.FOLLOWBRIEF_TEST_CRONTAB_FILE;
const logFile = process.env.FOLLOWBRIEF_TEST_MUTATION_LOG_FILE;
const args = process.argv.slice(2);
fs.appendFileSync(logFile, JSON.stringify({ command: "crontab", args }) + "\\n");
if (args[0] === "-l") {
  try {
    process.stdout.write(fs.readFileSync(path, "utf8"));
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
if (args[0] === "-") {
  const input = fs.readFileSync(0, "utf8");
  fs.writeFileSync(path, input);
  process.exit(0);
}
process.exit(64);
`,
  );

  await writeExecutable(
    join(fakeBinDir, "openclaw"),
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.FOLLOWBRIEF_TEST_OPENCLAW_LOG_FILE, process.argv.slice(2).join(" ") + "\\n");
console.log("unrelated openclaw cron");
`,
  );

  await writeExecutable(join(fakeBinDir, "sleep"), "#!/bin/sh\nexit 0\n");

  return {
    platform,
    rootDir,
    homeDir,
    agentDir,
    launchAgentsDir,
    fakeBinDir,
    contractPath,
    mutationLogPath,
    launchctlStatePath,
    serverControlPath,
    openclawLogPath,
    crontabPath,
    contract,
    ownerId: OWNER_ID,
    anchorAt: ANCHOR_AT,
    scheduleStatus: schedule.status,
    label: `com.followbrief.library.${contract.accountSlug}`,
  };
}

function runInstaller(harness: Harness, extraEnv: Record<string, string | undefined> = {}) {
  return spawnSync("sh", [helperPath, "--contract", harness.contractPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: harness.homeDir,
      PATH: `${harness.fakeBinDir}:${process.env.PATH ?? ""}`,
      BUILDER_BLOG_AGENT_DIR: harness.agentDir,
      FOLLOWBRIEF_TEST_UNAME: harness.platform,
      FOLLOWBRIEF_TEST_NOW: ANCHOR_AT,
      FOLLOWBRIEF_TEST_HOSTNAME: HOSTNAME,
      FOLLOWBRIEF_TEST_OWNER_UUID: OWNER_UUID,
      FOLLOWBRIEF_TEST_LAUNCH_AGENTS_DIR: harness.launchAgentsDir,
      FOLLOWBRIEF_TEST_LAUNCHCTL_STATE_FILE: harness.launchctlStatePath,
      FOLLOWBRIEF_TEST_MUTATION_LOG_FILE: harness.mutationLogPath,
      FOLLOWBRIEF_TEST_SERVER_CONTROL_FILE: harness.serverControlPath,
      FOLLOWBRIEF_TEST_OPENCLAW_LOG_FILE: harness.openclawLogPath,
      FOLLOWBRIEF_TEST_CRONTAB_FILE: harness.crontabPath,
      ...extraEnv,
    },
  });
}

test("needs_confirmation requires explicit partial-result confirmation", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    const initial = await readJson(harness.contractPath);
    assertExactKeys(initial, INITIAL_KEYS);
    assertNoForbiddenProperties(initial);

    const result = runInstaller(harness);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit partial-result confirmation/i);
    assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
    assert.deepEqual(await readJson(harness.contractPath), initial);
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("prompt-shaped needs_confirmation contract uses second-precision createdAt accepted by helper validation", async () => {
  const harness = await makeHarness({
    verdictStatus: "needs_confirmation",
    createdAt: "placeholder",
  });
  try {
    const prompt = source("skills/builder-blog-digest/jobs/library-cron-setup.md");
    const writer = extractHeredoc(
      prompt,
      `node - "$RESUME_CONTRACT_TMP" "$ACCT" "$ACCOUNT_SLUG" "$EXPECTED_INSTANCE_ID" "$SETUP_VERDICT_STATUS" <<'NODE'`,
    )
      .replaceAll("{{AGENT_RUNTIME}}", "openclaw")
      .replaceAll("{{CRON_FREQUENCY_KEY}}", "daily")
      .replaceAll("{{CRON_FREQUENCY_LABEL}}", "Daily")
      .replaceAll("{{CRON_INTERVAL_MINUTES}}", "1440")
      .replaceAll("{{FETCH_FORCE}}", "1")
      .replaceAll("{{FETCH_DAYS}}", "14")
      .replaceAll("{{PARALLEL_WORKERS}}", "3");

    const writeResult = spawnSync(
      "node",
      [
        "-",
        harness.contractPath,
        ACCOUNT,
        ACCOUNT_SLUG,
        INSTANCE_ID,
        "needs_confirmation",
      ],
      { input: writer, encoding: "utf8" },
    );
    assert.equal(writeResult.status, 0, writeResult.stderr);

    const contract = (await readJson(harness.contractPath)) as Contract;
    assert.match(contract.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.doesNotMatch(contract.createdAt, /\.\d{3}Z$/);

    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit partial-result confirmation/i);
    assert.doesNotMatch(result.stderr, /createdAt/i);
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("contract mode must be exactly 0600", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    await chmod(harness.contractPath, 0o644);
    const initial = await readJson(harness.contractPath);

    const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /0600|group\/world writable|mode/i);
    assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
    assert.deepEqual(await readJson(harness.contractPath), initial);
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("account must be a reasonable email without control characters", async () => {
  const badAccount = "bad\tuser@example.com";
  const harness = await makeHarness(
    {
      account: badAccount,
      accountSlug: accountSlugFor(badAccount),
      verdictStatus: "needs_confirmation",
    },
  );
  try {
    const initial = await readJson(harness.contractPath);
    const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /account|email|control/i);
    assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
    assert.deepEqual(await readJson(harness.contractPath), initial);
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("installer rejects unsupported hourly contract frequency before any schedule mutation", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    await writeContract(harness.contractPath, {
      ...harness.contract,
      frequencyKey: "1h" as never,
      frequencyLabel: "Hourly" as never,
      intervalMinutes: 60 as never,
    });

    const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported frequencyKey/);
    assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("contract path must stay inside non-symlink trusted descendants", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    const externalDir = join(harness.rootDir, "external");
    await mkdir(externalDir, { recursive: true });
    const externalTarget = join(externalDir, `resume-contract-${INSTANCE_ID}.json`);
    const externalContract = baseContract({ verdictStatus: "needs_confirmation" });
    await writeContract(externalTarget, externalContract, 0o600);
    const externalBefore = await readFile(externalTarget, "utf8");

    await unlink(harness.contractPath);
    await symlink(externalTarget, harness.contractPath);

    const symlinkResult = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
    assert.notEqual(symlinkResult.status, 0);
    assert.match(symlinkResult.stderr, /symlink|regular file|contract path/i);
    assert.doesNotMatch(symlinkResult.stdout, /followbriefScheduleInstall/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
    assert.equal(await readFile(externalTarget, "utf8"), externalBefore);

    const directoryCases = [
      {
        name: "library-cron-direct symlink",
        replacePath: join(harness.agentDir, "tmp", "accounts", harness.contract.accountSlug, "library-cron-direct"),
        symlinkTarget: join(externalDir, "dir-target"),
        externalContractPath: join(externalDir, "dir-target", `resume-contract-${INSTANCE_ID}.json`),
      },
      {
        name: "account slug directory symlink",
        replacePath: join(harness.agentDir, "tmp", "accounts", harness.contract.accountSlug),
        symlinkTarget: join(externalDir, "account-target"),
        externalContractPath: join(externalDir, "account-target", "library-cron-direct", `resume-contract-${INSTANCE_ID}.json`),
      },
    ] as const;

    for (const scenario of directoryCases) {
      await rm(join(harness.agentDir, "tmp"), { recursive: true, force: true });
      const externalDirTarget = scenario.symlinkTarget;
      await mkdir(externalDirTarget, { recursive: true });
      await writeContract(scenario.externalContractPath, externalContract, 0o600);
      const externalDirBefore = await readFile(scenario.externalContractPath, "utf8");
      await mkdir(join(scenario.replacePath, ".."), { recursive: true });
      await symlink(scenario.symlinkTarget, scenario.replacePath);

      const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
      assert.notEqual(result.status, 0, scenario.name);
      assert.match(result.stderr, /symlink|directory|contract path|resolve/i, scenario.name);
      assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/, scenario.name);
      assert.equal(await readMutationLog(harness.mutationLogPath), "", scenario.name);
      assert.equal(await readFile(scenario.externalContractPath, "utf8"), externalDirBefore, scenario.name);
      await rm(join(harness.agentDir, "tmp"), { recursive: true, force: true });
      await writeContract(harness.contractPath, harness.contract, 0o600);
    }

    await unlink(harness.contractPath);
    await symlink(join(externalDir, "missing-contract.json"), harness.contractPath);

    const brokenResult = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
    assert.notEqual(brokenResult.status, 0);
    assert.match(brokenResult.stderr, /contract|symlink|file/i);
    assert.doesNotMatch(brokenResult.stderr, /at Object\.|node:fs|Error:/i);
    assert.doesNotMatch(brokenResult.stdout, /followbriefScheduleInstall/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("completed contracts fail closed when local or server evidence drifts", async () => {
  const cases: DriftScenario[] = [
    {
      name: "local LaunchAgent missing while server stays active",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness, { writePlist: false, launchctlLoaded: false });
        await setServerState(harness, { status: "active" });
      },
    },
    {
      name: "local LaunchAgent present while server is stopped",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { status: "stopped" });
      },
    },
    {
      name: "server runtime mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { runtime: "codex" });
      },
    },
    {
      name: "server frequency mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { frequencyKey: "weekly", frequencyLabel: "Weekly" });
      },
    },
    {
      name: "server force mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { overrideFetched: false });
      },
    },
    {
      name: "server owner mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { ownerId: `local:${HOSTNAME}:${ACCOUNT_SLUG}:library-cron:33333333-3333-4333-8333-333333333333` });
      },
    },
    {
      name: "server anchor mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { startedAt: "2026-08-07T16:24:00Z" });
      },
    },
    {
      name: "server host mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness);
        await setServerState(harness, { hostname: "other-host" });
      },
    },
    {
      name: "unrelated OpenClaw cron exists but no FollowBrief LaunchAgent",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness, { writePlist: false, launchctlLoaded: false });
        await setServerState(harness, { status: "active" });
        await writeFile(join(harness.rootDir, "unrelated-openclaw-cron.txt"), "openclaw cron add digest\n", "utf8");
      },
      verify: async (harness: Harness) => {
        assert.equal(await readMutationLog(harness.openclawLogPath), "");
      },
    },
    {
      name: "local runtime pin mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness, { runtime: "codex" });
        await setServerState(harness, { status: "active" });
      },
    },
    {
      name: "local fetch-days pin mismatched",
      setup: async (harness: Harness) => {
        await seedCompletedLocalState(harness, { fetchDays: 21 });
        await setServerState(harness, { status: "active" });
      },
    },
  ];

  for (const scenario of cases) {
    const harness = await makeHarness({
      verdictStatus: "needs_confirmation",
      ownerId: OWNER_ID,
      anchorAt: ANCHOR_AT,
      completedAt: "2026-08-07T15:30:00Z",
      evidence: {
        localScheduler: "launchd",
        localLabel: LABEL,
        schedule: SCHEDULE_STATUS,
        serverStatus: "active",
        hostname: HOSTNAME,
      },
    });
    try {
      await scenario.setup(harness);
      const result = runInstaller(harness);

      assert.notEqual(result.status, 0, scenario.name);
      assert.doesNotMatch(result.stdout, /followbriefScheduleInstall/, scenario.name);
      if (scenario.verify) await scenario.verify(harness);
    } finally {
      await rm(harness.rootDir, { recursive: true, force: true });
    }
  }
});

test("explicit confirmation installs the account-scoped scheduler and persists verified evidence", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    await setServerState(harness, { status: "stopped", applyCronStatus: true });

    const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
    const marker = parseMarker(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(marker, result.stdout);
    assert.deepEqual(Object.keys(marker!).sort(), [
      "account",
      "followbriefScheduleInstall",
      "frequencyKey",
      "instanceId",
      "job",
      "localScheduler",
      "ownerId",
      "runtime",
      "serverStatus",
      "startedAt",
    ]);
    assert.deepEqual(marker, {
      followbriefScheduleInstall: "ok",
      job: "library-cron",
      account: ACCOUNT,
      instanceId: INSTANCE_ID,
      runtime: "openclaw",
      frequencyKey: "daily",
      ownerId: OWNER_ID,
      startedAt: ANCHOR_AT,
      localScheduler: "launchd",
      serverStatus: "active",
    });

    const contract = await readJson(harness.contractPath);
    assertExactKeys(contract, EXTENDED_KEYS);
    assertNoForbiddenProperties(contract);
    assert.equal(contract.ownerId, OWNER_ID);
    assert.equal(contract.anchorAt, ANCHOR_AT);
    assert.equal(typeof contract.completedAt, "string");
    assert.deepEqual(contract.evidence, {
      localScheduler: "launchd",
      localLabel: harness.label,
      schedule: harness.scheduleStatus,
      serverStatus: "active",
      hostname: HOSTNAME,
    });

    const pinFiles = [
      [`runtime-library-cron-${harness.contract.accountSlug}`, "openclaw"],
      [`fetch-force-library-cron-${harness.contract.accountSlug}`, "1"],
      [`fetch-days-library-cron-${harness.contract.accountSlug}`, "14"],
      [`parallel-library-cron-${harness.contract.accountSlug}`, "3"],
      [`schedule-anchor-library-cron-${harness.contract.accountSlug}`, ANCHOR_AT],
      [`cron-owner-library-cron-${harness.contract.accountSlug}`, OWNER_ID],
    ] as const;
    for (const [name, value] of pinFiles) {
      const path = join(harness.agentDir, name);
      const details = await stat(path);
      assert.equal(details.mode & 0o777, 0o600, name);
      assertPinText(await readFile(path, "utf8"), value);
    }

    const plistPath = join(harness.launchAgentsDir, `${harness.label}.plist`);
    const plist = await readFile(plistPath, "utf8");
    assert.match(plist, new RegExp(`<string>${join(harness.agentDir, "builder-agent-runner.sh").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/string>`));
    assert.match(plist, /<string>library-cron<\/string>/);

    const launchctlState = (await readJson(harness.launchctlStatePath)) as JsonRecord;
    assert.ok((launchctlState.loaded as JsonRecord)[harness.label]);

    const mutations = await readJsonLines(harness.mutationLogPath);
    assert.ok(countEvents(mutations, "schedule-spec") >= 1);
    assert.ok(countEvents(mutations, "cron-status") >= 1);
    assert.ok(countEvents(mutations, "cron-state") >= 1);
    assert.ok(countEvents(mutations, "launchctl.bootstrap") >= 1);

    const cronStatusEvent = mutations.find((entry) => entry.command === "cron-status" && entry.payload) as JsonRecord | undefined;
    assert.deepEqual(cronStatusEvent?.payload, {
      job: "library-cron",
      status: "active",
      frequencyKey: "daily",
      frequencyLabel: "Daily",
      schedule: harness.scheduleStatus,
      runtime: "openclaw",
      overrideFetched: true,
      ownerId: OWNER_ID,
      startedAt: ANCHOR_AT,
      hostname: HOSTNAME,
    });
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("initial install replaces a stale foreign-host owner file instead of inheriting it", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    await setServerState(harness, { status: "stopped", applyCronStatus: true });
    const ownerFile = join(
      harness.agentDir,
      `cron-owner-library-cron-${harness.contract.accountSlug}`,
    );
    const staleOwnerId = `local:other-host:${harness.contract.accountSlug}:library-cron:33333333-3333-4333-8333-333333333333`;
    await writeFile(ownerFile, `${staleOwnerId}\n`, "utf8");
    await chmod(ownerFile, 0o600);

    const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
    const marker = parseMarker(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(marker, {
      followbriefScheduleInstall: "ok",
      job: "library-cron",
      account: ACCOUNT,
      instanceId: INSTANCE_ID,
      runtime: "openclaw",
      frequencyKey: "daily",
      ownerId: OWNER_ID,
      startedAt: ANCHOR_AT,
      localScheduler: "launchd",
      serverStatus: "active",
    });
    assertPinText(await readFile(ownerFile, "utf8"), OWNER_ID);

    const contract = await readJson(harness.contractPath);
    assert.equal(contract.ownerId, OWNER_ID);

    const serverState = await readJson(harness.serverControlPath);
    assert.equal((serverState.cronState as JsonRecord).ownerId, OWNER_ID);
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("completed retry is read-only and fails closed on later local or server drift", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" });
  try {
    await setServerState(harness, { status: "stopped", applyCronStatus: true });
    const first = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
    assert.equal(first.status, 0, first.stderr);
    const scratchDir = await seedScheduleScratchState(harness);

    const beforeRetryMutations = await readJsonLines(harness.mutationLogPath);
    const beforeRetryContract = await readJson(harness.contractPath);
    const beforeRetryScratch = await snapshotTree(scratchDir);

    const retry = runInstaller(harness);
    assert.equal(retry.status, 0, retry.stderr);
    const retryMarker = parseMarker(retry.stdout);
    assert.deepEqual(retryMarker, {
      followbriefScheduleInstall: "ok",
      job: "library-cron",
      account: ACCOUNT,
      instanceId: INSTANCE_ID,
      runtime: "openclaw",
      frequencyKey: "daily",
      ownerId: OWNER_ID,
      startedAt: ANCHOR_AT,
      localScheduler: "launchd",
      serverStatus: "active",
    });

    const afterRetryMutations = await readJsonLines(harness.mutationLogPath);
    assert.equal(countEvents(afterRetryMutations, "launchctl.bootstrap"), countEvents(beforeRetryMutations, "launchctl.bootstrap"));
    assert.equal(countEvents(afterRetryMutations, "cron-status"), countEvents(beforeRetryMutations, "cron-status"));
    assert.ok(countEvents(afterRetryMutations, "cron-state") > countEvents(beforeRetryMutations, "cron-state"));
    assert.deepEqual(await snapshotTree(scratchDir), beforeRetryScratch);

    const afterRetryContract = await readJson(harness.contractPath);
    assert.equal(afterRetryContract.ownerId, beforeRetryContract.ownerId);
    assert.equal(afterRetryContract.anchorAt, beforeRetryContract.anchorAt);

    await writeFile(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), "99\n", "utf8");
    await chmod(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), 0o600);
    const beforeLocalDrift = await readJsonLines(harness.mutationLogPath);
    const localDrift = runInstaller(harness);
    assert.notEqual(localDrift.status, 0);
    assert.doesNotMatch(localDrift.stdout, /followbriefScheduleInstall/);
    const afterLocalDrift = await readJsonLines(harness.mutationLogPath);
    assert.equal(countEvents(afterLocalDrift, "launchctl.bootstrap"), countEvents(beforeLocalDrift, "launchctl.bootstrap"));
    assert.equal(countEvents(afterLocalDrift, "cron-status"), countEvents(beforeLocalDrift, "cron-status"));
    assertPinText(await readFile(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), "utf8"), "99");

    await writeFile(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), "14\n", "utf8");
    await chmod(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), 0o600);
    await setServerState(harness, { ownerId: `local:${HOSTNAME}:${ACCOUNT_SLUG}:library-cron:44444444-4444-4444-8444-444444444444` });
    const beforeServerDrift = await readJsonLines(harness.mutationLogPath);
    const serverDrift = runInstaller(harness);
    assert.notEqual(serverDrift.status, 0);
    assert.doesNotMatch(serverDrift.stdout, /followbriefScheduleInstall/);
    const afterServerDrift = await readJsonLines(harness.mutationLogPath);
    assert.equal(countEvents(afterServerDrift, "launchctl.bootstrap"), countEvents(beforeServerDrift, "launchctl.bootstrap"));
    assert.equal(countEvents(afterServerDrift, "cron-status"), countEvents(beforeServerDrift, "cron-status"));
    const serverState = await readJson(harness.serverControlPath);
    assert.equal((serverState.cronState as JsonRecord).ownerId, `local:${HOSTNAME}:${ACCOUNT_SLUG}:library-cron:44444444-4444-4444-8444-444444444444`);

    await setServerState(harness, {
      ownerId: OWNER_ID,
      hostname: HOSTNAME,
      status: "active",
      applyCronStatus: true,
    });
    await writeFile(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), "14\n", "utf8");
    await chmod(join(harness.agentDir, `fetch-days-library-cron-${harness.contract.accountSlug}`), 0o600);

    const evidenceDriftCases = [
      {
        name: "localScheduler evidence drift",
        evidence: { localScheduler: "crontab" },
      },
      {
        name: "localLabel evidence drift",
        evidence: { localLabel: `${LABEL}.other` },
      },
      {
        name: "schedule evidence drift",
        evidence: { schedule: "anchor:0 0 * * *" },
      },
      {
        name: "serverStatus evidence drift",
        evidence: { serverStatus: "stopped" },
      },
      {
        name: "hostname evidence drift",
        evidence: { hostname: "different-host" },
      },
    ] as const;

    for (const scenario of evidenceDriftCases) {
      const currentContract = (await readJson(harness.contractPath)) as Contract & { evidence: JsonRecord };
      await writeContract(harness.contractPath, {
        ...currentContract,
        evidence: {
          ...currentContract.evidence,
          ...scenario.evidence,
        },
      } as Contract);
      const beforeEvidenceDrift = await readJsonLines(harness.mutationLogPath);
      const evidenceDrift = runInstaller(harness);
      assert.notEqual(evidenceDrift.status, 0, scenario.name);
      assert.doesNotMatch(evidenceDrift.stdout, /followbriefScheduleInstall/, scenario.name);
      const afterEvidenceDrift = await readJsonLines(harness.mutationLogPath);
      assert.equal(
        countEvents(afterEvidenceDrift, "launchctl.bootstrap"),
        countEvents(beforeEvidenceDrift, "launchctl.bootstrap"),
        scenario.name,
      );
      assert.equal(
        countEvents(afterEvidenceDrift, "cron-status"),
        countEvents(beforeEvidenceDrift, "cron-status"),
        scenario.name,
      );

      await writeContract(harness.contractPath, {
        ...currentContract,
      } as Contract);
    }

    const beforeLaunchdDrift = await readJsonLines(harness.mutationLogPath);
    const driftedPlistPath = join(harness.launchAgentsDir, `${harness.label}.plist`);
    const driftedPlist = (await readFile(driftedPlistPath, "utf8"))
      .replace("<key>Hour</key><integer>15</integer>", "<key>Hour</key><integer>0</integer>")
      .replace("<key>Minute</key><integer>24</integer>", "<key>Minute</key><integer>0</integer>");
    await writeFile(driftedPlistPath, driftedPlist, "utf8");
    const launchdDrift = runInstaller(harness);
    assert.notEqual(launchdDrift.status, 0);
    assert.doesNotMatch(launchdDrift.stdout, /followbriefScheduleInstall/);
    const afterLaunchdDrift = await readJsonLines(harness.mutationLogPath);
    assert.equal(countEvents(afterLaunchdDrift, "launchctl.bootstrap"), countEvents(beforeLaunchdDrift, "launchctl.bootstrap"));
    assert.equal(countEvents(afterLaunchdDrift, "cron-status"), countEvents(beforeLaunchdDrift, "cron-status"));

    const restoredPlist = (await readFile(driftedPlistPath, "utf8"))
      .replace("<key>Hour</key><integer>0</integer>", "<key>Hour</key><integer>15</integer>")
      .replace("<key>Minute</key><integer>0</integer>", "<key>Minute</key><integer>24</integer>");
    await writeFile(driftedPlistPath, restoredPlist, "utf8");

    const beforeEnvDrift = await readJsonLines(harness.mutationLogPath);
    const envDriftedPlist = (await readFile(driftedPlistPath, "utf8"))
      .replace("<key>BUILDER_BLOG_ACCOUNT</key><string>test@example.com</string>", "<key>BUILDER_BLOG_ACCOUNT</key><string>other@example.com</string>")
      .replace("<key>BUILDER_BLOG_INTERVAL_MINUTES</key><string>1440</string>", "<key>BUILDER_BLOG_INTERVAL_MINUTES</key><string>999</string>")
      .replace("<key>INTERVAL_MINUTES</key><string>1440</string>", "<key>INTERVAL_MINUTES</key><string>999</string>");
    await writeFile(driftedPlistPath, envDriftedPlist, "utf8");
    const envDrift = runInstaller(harness);
    assert.notEqual(envDrift.status, 0);
    assert.doesNotMatch(envDrift.stdout, /followbriefScheduleInstall/);
    const afterEnvDrift = await readJsonLines(harness.mutationLogPath);
    assert.equal(countEvents(afterEnvDrift, "launchctl.bootstrap"), countEvents(beforeEnvDrift, "launchctl.bootstrap"));
    assert.equal(countEvents(afterEnvDrift, "cron-status"), countEvents(beforeEnvDrift, "cron-status"));
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("linux crontab install and completed retry validate the exact live row", async () => {
  const harness = await makeHarness({ verdictStatus: "needs_confirmation" }, { platform: "Linux" });
  try {
    await setServerState(harness, { status: "stopped", applyCronStatus: true });
    const first = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });
    assert.equal(first.status, 0, first.stderr);
    const scratchDir = await seedScheduleScratchState(harness);
    assert.deepEqual(parseMarker(first.stdout), {
      followbriefScheduleInstall: "ok",
      job: "library-cron",
      account: ACCOUNT,
      instanceId: INSTANCE_ID,
      runtime: "openclaw",
      frequencyKey: "daily",
      ownerId: OWNER_ID,
      startedAt: ANCHOR_AT,
      localScheduler: "crontab",
      serverStatus: "active",
    });
    const crontabText = await readFile(harness.crontabPath, "utf8");
    assert.match(crontabText, new RegExp(`^# FollowBrief library cron · ${ACCOUNT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.match(crontabText, new RegExp(`^${expectedCrontabRow(harness).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));

    const beforeRetryMutations = await readJsonLines(harness.mutationLogPath);
    const beforeRetryContract = await readJson(harness.contractPath);
    const beforeRetryScratch = await snapshotTree(scratchDir);
    const retry = runInstaller(harness);
    assert.equal(retry.status, 0, retry.stderr);
    assert.deepEqual(parseMarker(retry.stdout), {
      followbriefScheduleInstall: "ok",
      job: "library-cron",
      account: ACCOUNT,
      instanceId: INSTANCE_ID,
      runtime: "openclaw",
      frequencyKey: "daily",
      ownerId: OWNER_ID,
      startedAt: ANCHOR_AT,
      localScheduler: "crontab",
      serverStatus: "active",
    });
    const afterRetryMutations = await readJsonLines(harness.mutationLogPath);
    assert.equal(
      countWhere(afterRetryMutations, (entry) => entry.command === "crontab" && Array.isArray(entry.args) && entry.args[0] === "-"),
      countWhere(beforeRetryMutations, (entry) => entry.command === "crontab" && Array.isArray(entry.args) && entry.args[0] === "-"),
    );
    assert.equal(countEvents(afterRetryMutations, "cron-status"), countEvents(beforeRetryMutations, "cron-status"));
    assert.deepEqual(await readJson(harness.contractPath), beforeRetryContract);
    assert.deepEqual(await snapshotTree(scratchDir), beforeRetryScratch);

    const driftedCrontab = (await readFile(harness.crontabPath, "utf8")).replace(/^24 15 \* \* \*/m, "0 0 * * *");
    await writeFile(harness.crontabPath, driftedCrontab, "utf8");
    const beforeDriftMutations = await readJsonLines(harness.mutationLogPath);
    const drift = runInstaller(harness);
    assert.notEqual(drift.status, 0);
    assert.doesNotMatch(drift.stdout, /followbriefScheduleInstall/);
    const afterDriftMutations = await readJsonLines(harness.mutationLogPath);
    assert.equal(
      countWhere(afterDriftMutations, (entry) => entry.command === "crontab" && Array.isArray(entry.args) && entry.args[0] === "-"),
      countWhere(beforeDriftMutations, (entry) => entry.command === "crontab" && Array.isArray(entry.args) && entry.args[0] === "-"),
    );
    assert.equal(countEvents(afterDriftMutations, "cron-status"), countEvents(beforeDriftMutations, "cron-status"));
    assert.match(await readFile(harness.crontabPath, "utf8"), /^0 0 \* \* \*/m);
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

test("linux install preserves unrelated FollowBrief rows for similar-looking accounts", async () => {
  const currentAccount = "a.b@example.com";
  const currentSlug = accountSlugFor(currentAccount);
  const harness = await makeHarness(
    {
      account: currentAccount,
      accountSlug: currentSlug,
      verdictStatus: "needs_confirmation",
    },
    { platform: "Linux" },
  );
  try {
    await setServerState(harness, { status: "stopped", applyCronStatus: true });
    const unrelatedRow = [
      "# FollowBrief library cron · axb@example.com",
      `24 15 * * * BUILDER_BLOG_ACCOUNT="axb@example.com" ${join(harness.agentDir, "builder-agent-runner.sh")} library-cron >> ${join(harness.agentDir, "logs", "com.followbrief.library.axb_example_com_d28c65fd.log")} 2>&1`,
    ].join("\n");
    await writeFile(
      harness.crontabPath,
      `${unrelatedRow}\n# Some other cron\n0 1 * * * echo keep-me\n`,
      "utf8",
    );

    const result = runInstaller(harness, { FOLLOWBRIEF_CONFIRM_PARTIAL: "1" });

    assert.equal(result.status, 0, result.stderr);
    const crontabText = await readFile(harness.crontabPath, "utf8");
    assert.match(crontabText, /^# FollowBrief library cron · axb@example\.com$/m);
    assert.match(
      crontabText,
      /^24 15 \* \* \* BUILDER_BLOG_ACCOUNT="axb@example\.com" .*builder-agent-runner\.sh library-cron/m,
    );
    assert.equal(
      crontabText.split("\n").filter((line) => line.includes('BUILDER_BLOG_ACCOUNT="axb@example.com"') && line.includes("builder-agent-runner.sh library-cron")).length,
      1,
    );
    assert.equal(
      crontabText.split("\n").filter((line) => line.includes(`BUILDER_BLOG_ACCOUNT="${currentAccount}"`) && line.includes("builder-agent-runner.sh library-cron")).length,
      1,
    );
    assert.match(crontabText, /^# Some other cron$/m);
    assert.match(crontabText, /^0 1 \* \* \* echo keep-me$/m);
    assert.deepEqual(parseMarker(result.stdout), {
      followbriefScheduleInstall: "ok",
      job: "library-cron",
      account: currentAccount,
      instanceId: INSTANCE_ID,
      runtime: "openclaw",
      frequencyKey: "daily",
      ownerId: `local:${HOSTNAME}:${currentSlug}:library-cron:${OWNER_UUID}`,
      startedAt: ANCHOR_AT,
      localScheduler: "crontab",
      serverStatus: "active",
    });
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});
