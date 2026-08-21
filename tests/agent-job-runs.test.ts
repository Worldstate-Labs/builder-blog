import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

const shellFunction = (text: string, name: string) => {
  const start = text.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing shell function ${name}`);
  const end = text.indexOf("\n}\n\n", start);
  assert.notEqual(end, -1, `missing end of shell function ${name}`);
  return text.slice(start, end + 3);
};

function runRuntimeProbeHarness({
  runtime = "claude",
  runtimeScript = null,
  runtimeVersionTimeoutSeconds = "2",
}: {
  runtime?: "claude" | "codex" | "openclaw";
  runtimeScript?: string | null;
  runtimeVersionTimeoutSeconds?: string;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "followbrief-runtime-smoke-probe-"));
  const binDir = join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });
  if (runtimeScript) {
    writeFileSync(join(binDir, runtime), runtimeScript, { mode: 0o755 });
  }
  const runner = source("scripts/builder-agent-runner.sh");
  const scriptPath = join(tempDir, "probe.sh");
  const nodeBinDir = dirname(process.execPath);
  const probePath = runtimeScript ? `${binDir}:${nodeBinDir}:/usr/bin:/bin` : `${nodeBinDir}:/usr/bin:/bin`;
  writeFileSync(
    scriptPath,
    `set -eu
JOB_TMP_DIR="${join(tempDir, "job")}"
mkdir -p "$JOB_TMP_DIR"
PATH="${probePath}"
${shellFunction(runner, "runtime_probe_output_summary")}
${shellFunction(runner, "runtime_probe_output_is_stub_not_installed")}
${shellFunction(runner, "normalize_runtime")}
${shellFunction(runner, "resolve_runtime_probe_candidate")}
${shellFunction(runner, "process_tree_pids")}
${shellFunction(runner, "terminate_process_tree")}
${shellFunction(runner, "probe_selected_runtime_executable")}
if probe_selected_runtime_executable "${runtime}"; then
  probe_code=0
else
  probe_code="$?"
fi
printf 'probe_code=%s\\n' "$probe_code"
printf 'classification=%s\\n' "\${RUNTIME_PROBE_CLASSIFICATION:-}"
printf 'diagnostic=%s\\n' "\${RUNTIME_PROBE_DIAGNOSTIC:-}"
printf 'version=%s\\n' "\${BUILDER_BLOG_RUNTIME_VERSION:-}"
`,
    "utf8",
  );

  try {
    const result = spawnSync("sh", [scriptPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        BUILDER_BLOG_RUNTIME_PROBE_TIMEOUT_SECONDS: runtimeVersionTimeoutSeconds,
      },
    });
    const values = new Map(
      result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    return {
      ...result,
      classification: values.get("classification") ?? "",
      diagnostic: values.get("diagnostic") ?? "",
      probeCode: Number(values.get("probe_code") ?? "-1"),
      version: values.get("version") ?? "",
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runWithRemovedRuntime(source: "env" | "pin") {
  const agentDir = mkdtempSync(join(tmpdir(), "followbrief-removed-runtime-"));
  mkdirSync(join(agentDir, "jobs"), { recursive: true });
  writeFileSync(join(agentDir, "jobs", "library-once.md"), "unused\n");
  if (source === "pin") {
    writeFileSync(join(agentDir, "runtime-library-once"), "hermes\n");
  }

  try {
    return spawnSync("sh", [join(root, "scripts/builder-agent-runner.sh"), "library-once"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        BUILDER_BLOG_ACCOUNT: "removed-runtime@example.com",
        BUILDER_BLOG_AGENT_DIR: agentDir,
        BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH: "1",
        ...(source === "env" ? { BUILDER_BLOG_AGENT_RUNTIME: "hermes" } : {}),
      },
    });
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

test("removed runtimes fail closed from both environment overrides and persisted pins", () => {
  for (const source of ["env", "pin"] as const) {
    const result = runWithRemovedRuntime(source);
    assert.equal(result.status, 78, `${source}: ${result.stderr}`);
    assert.match(result.stderr, /Unsupported FollowBrief runtime 'hermes'\./);
  }
});

test("unpinned Codex discovery records the runner model instead of an ambient model", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "followbrief-codex-discovery-"));
  const agentDir = join(tempDir, "agent");
  const homeDir = join(tempDir, "home");
  const binDir = join(homeDir, ".codex", "bin");
  const captureFile = join(tempDir, "codex-env.txt");
  mkdirSync(join(agentDir, "jobs"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(agentDir, "jobs", "library-cron.md"), "unused\n");
  writeFileSync(join(binDir, "codex"), `#!/bin/sh
{
  printf 'runtime=%s\\n' "\${BUILDER_BLOG_RUNTIME:-}"
  printf 'model=%s\\n' "\${BUILDER_BLOG_AGENT_MODEL:-}"
  printf 'args=%s\\n' "$*"
} > "$FOLLOWBRIEF_CAPTURE_FILE"
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}'
`, { mode: 0o755 });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    BUILDER_BLOG_ACCOUNT: "codex-discovery@example.com",
    BUILDER_BLOG_AGENT_DIR: agentDir,
    BUILDER_BLOG_DISABLE_WEB_SYNC: "1",
    BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH: "1",
    BUILDER_BLOG_SMOKE_CHECK: "1",
    CODEX_MODEL: "gpt-5.4",
    FOLLOWBRIEF_CAPTURE_FILE: captureFile,
  };
  delete env.BUILDER_BLOG_AGENT_RUNTIME;
  delete env.BUILDER_BLOG_AGENT_MODEL;
  delete env.BUILDER_BLOG_CODEX_MODEL;
  delete env.BUILDER_BLOG_CODEX_REASONING_EFFORT;

  try {
    const result = spawnSync("sh", [join(root, "scripts/builder-agent-runner.sh"), "library-cron"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    let capture = "capture file missing";
    try {
      capture = readFileSync(captureFile, "utf8");
    } catch {}
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}\n${capture}`);
    assert.match(capture, /^runtime=codex$/m);
    assert.match(capture, /^model=gpt-5\.6-luna$/m);
    assert.match(capture, /args=.*--model gpt-5\.6-luna/);
    assert.match(capture, /args=.*model_reasoning_effort=medium/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime smoke check falls back to the cheap compatible model on the current Codex CLI", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "followbrief-codex-smoke-fallback-"));
  const agentDir = join(tempDir, "agent");
  const homeDir = join(tempDir, "home");
  const binDir = join(homeDir, ".codex", "bin");
  const callsFile = join(tempDir, "codex-calls.txt");
  mkdirSync(join(agentDir, "jobs"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(agentDir, "jobs", "library-cron.md"), "unused\n");
  writeFileSync(join(binDir, "codex"), `#!/bin/sh
model=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--model" ]; then model="$argument"; fi
  previous="$argument"
done
printf '%s\n' "$model" >> "$FOLLOWBRIEF_CALLS_FILE"
if [ "$model" = "gpt-5.6-luna" ]; then
  printf '%s\n' 'This model requires a newer version of Codex.' >&2
  exit 1
fi
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}'
`, { mode: 0o755 });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    BUILDER_BLOG_ACCOUNT: "codex-smoke-fallback@example.com",
    BUILDER_BLOG_AGENT_DIR: agentDir,
    BUILDER_BLOG_AGENT_RUNTIME: "codex",
    BUILDER_BLOG_DISABLE_WEB_SYNC: "1",
    BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH: "1",
    BUILDER_BLOG_SMOKE_CHECK: "1",
    FOLLOWBRIEF_CALLS_FILE: callsFile,
  };
  delete env.BUILDER_BLOG_AGENT_MODEL;
  delete env.BUILDER_BLOG_CODEX_MODEL;

  try {
    const result = spawnSync("sh", [join(root, "scripts/builder-agent-runner.sh"), "library-cron"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(readFileSync(callsFile, "utf8").trim().split("\n"), [
      "gpt-5.6-luna",
      "gpt-5.4-mini",
      "gpt-5.4-mini",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime executable probe fails closed when the selected runtime command is missing", () => {
  const result = runRuntimeProbeHarness({ runtime: "claude" });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.probeCode, 78, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.classification, "runtime_missing_command");
  assert.match(result.diagnostic, /Selected runtime 'claude' is not on PATH|No selected FollowBrief runtime is available on PATH/);
});

test("runtime executable probe fails closed when a PATH-visible Claude stub reports no native binary", () => {
  const result = runRuntimeProbeHarness({
    runtime: "claude",
    runtimeScript: `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'Error: claude native binary not installed' >&2
  exit 1
fi
exit 0
`,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.probeCode, 78, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.classification, "runtime_stub_not_installed");
  assert.match(result.diagnostic, /claude native binary not installed/i);
});

test("runtime executable probe fails closed with a sanitized diagnostic when --version exits nonzero", () => {
  const result = runRuntimeProbeHarness({
    runtime: "claude",
    runtimeScript: `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'SECRET_TOKEN=topsecret runtime exploded' >&2
  exit 1
fi
exit 0
`,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.probeCode, 78, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.classification, "runtime_version_failed");
  assert.match(result.diagnostic, /failed its --version check/i);
  assert.doesNotMatch(result.diagnostic, /SECRET_TOKEN=topsecret/);
  assert.doesNotMatch(result.diagnostic, /runtime exploded/);
});

test("runtime executable probe fails closed when runtime version probing times out", () => {
  const result = runRuntimeProbeHarness({
    runtime: "claude",
    runtimeScript: `#!/bin/sh
if [ "$1" = "--version" ]; then
  while :; do sleep 5; done
fi
exit 0
`,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.probeCode, 124, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.classification, "runtime_version_timeout");
  assert.match(result.diagnostic, /timed out after 2s/i);
});

test("runtime executable probe fails closed when --version succeeds with empty output", () => {
  const result = runRuntimeProbeHarness({
    runtime: "claude",
    runtimeScript: `#!/bin/sh
if [ "$1" = "--version" ]; then
  exit 0
fi
exit 0
`,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.probeCode, 78, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.classification, "runtime_version_empty");
  assert.match(result.diagnostic, /returned no version output/i);
});

test("runtime executable probe accepts a healthy semver-style version response", () => {
  const result = runRuntimeProbeHarness({
    runtime: "claude",
    runtimeScript: `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' '1.2.3-beta.4'
  exit 0
fi
exit 0
`,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.probeCode, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.classification, "runtime_ready");
  assert.equal(result.version, "1.2.3-beta.4");
});

test("runtime smoke check probes the selected executable before launching the smoke prompt", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /run_runtime_smoke_check\(\) \{[\s\S]*probe_selected_runtime_executable/);
});

async function loadAgentJobRunsModule() {
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/builder_blog_test";
  return import("../src/lib/agent-job-runs");
}

function agentJobRunFixture({
  instanceId,
  startedAt,
  expectedAt = null,
  scheduleJob = null,
}: {
  instanceId: string;
  startedAt: Date;
  expectedAt?: Date | null;
  scheduleJob?: string | null;
}) {
  return {
    id: `row-${instanceId}`,
    userId: "account-1",
    jobType: "library-fetch",
    trigger: scheduleJob ? "scheduled" : "one_time",
    scheduleJob,
    instanceId,
    expectedAt,
    startedAt,
    heartbeatAt: null,
    finishedAt: startedAt,
    status: "succeeded",
    exitCode: 0,
    signal: null,
    runtime: "codex",
    runnerPid: null,
    workerPid: null,
    hostname: null,
    platform: null,
    stage: "completed",
    summary: null,
    details: {},
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

test("Prisma schema stores local agent job runs separately from business logs", () => {
  const schema = source("prisma/schema.prisma");

  assert.match(schema, /agentJobRuns\s+AgentJobRun\[\]/);
  assert.match(schema, /model AgentJobRun \{/);
  for (const field of [
    "jobType",
    "trigger",
    "scheduleJob",
    "instanceId",
    "expectedAt",
    "startedAt",
    "heartbeatAt",
    "finishedAt",
    "status",
    "exitCode",
    "signal",
    "runtime",
    "runnerPid",
    "workerPid",
    "hostname",
    "platform",
    "stage",
    "summary",
    "details",
  ]) {
    assert.match(schema, new RegExp(`\\n\\s*${field}\\s+`), `AgentJobRun is missing ${field}`);
  }
  assert.match(schema, /@@unique\(\[userId, jobType, instanceId\]\)/);
  assert.match(schema, /@@index\(\[userId, instanceId\]\)/);
  assert.match(schema, /@@index\(\[userId, jobType, startedAt\(sort: Desc\)\]\)/);
  assert.match(schema, /@@index\(\[userId, scheduleJob, expectedAt\(sort: Desc\)\]\)/);

  assert.match(schema, /LibraryFetchRun \{[\s\S]*jobRunId\s+String\?/);
  assert.match(schema, /DigestRun \{[\s\S]*jobRunId\s+String\?/);
});

test("agent job run API accepts lifecycle updates for scheduled and one-time runs", () => {
  const route = source("src/app/api/skill/job-runs/route.ts");
  const cli = source("scripts/builder-digest.mjs");

  assert.match(route, /getUserFromBearer\(request\)/);
  assert.match(route, /z\.enum\(\["library-fetch", "cloud-library-fetch", "digest-build"\]\)/);
  assert.match(route, /z\.enum\(\["scheduled", "one_time", "manual_cli"\]\)/);
  assert.match(
    route,
    /z\.enum\(\["starting", "running", "succeeded", "failed", "timed_out", "killed", "replaced", "stale"\]\)/,
  );
  assert.match(route, /agentJobRun\.findFirst/);
  assert.match(route, /userId: user\.id,[\s\S]*jobType: parsed\.data\.jobType,[\s\S]*instanceId: parsed\.data\.instanceId/);
  assert.match(route, /mergeAgentJobRunLifecycle/);
  assert.match(route, /isTerminalAgentJobStatus/);
  assert.match(route, /select: \{ id: true, details: true, status: true, finishedAt: true, exitCode: true, signal: true, stage: true, summary: true, createdAt: true \}/);
  assert.match(route, /agentJobRun\.update/);
  assert.match(route, /agentJobRun\.create/);
  assert.match(route, /parsed\.data\.status !== "starting"/);
  assert.match(route, /parsed\.data\.jobType === "cloud-library-fetch"[\s\S]*GLOBAL_RESET_FENCE_ID[\s\S]*userResetFenceId\(user\.id\)/);
  assert.match(route, /lockResetFenceForNewWorker\(tx, resetFenceId\)/);
  assert.match(route, /lockResetFenceForNewWorker\(tx, resetFenceId\)[\s\S]*newRunCreatedAt = await databaseClockNow\(tx\)/);
  assert.match(route, /createdAt: newRunCreatedAt!/);
  assert.match(route, /lockResetFenceForWorker\(tx, existingRun\.createdAt, resetFenceId\)/);
  assert.match(
    route,
    /if \(error instanceof StaleWorkerWriteError\) \{[\s\S]*NextResponse\.json\(\s*\{ error: error\.message, code: error\.responseCode, retryable: error\.retryable \},[\s\S]*\{ status: error\.statusCode \},/,
  );
  assert.doesNotMatch(route, /lockResetFenceForWorker\(tx, startedAt\)/);
  assert.doesNotMatch(route, /userId_instanceId/);
  assert.match(route, /MAX_DETAILS_BYTES = 50_000/);

  assert.match(cli, /job-run-start/);
  assert.match(cli, /job-run-update/);
  assert.match(cli, /\/api\/skill\/job-runs/);
  assert.match(cli, /function exitCodeOrNull/);
  assert.match(cli, /exitCode: exitCodeOrNull\(argValue\(args, "--exit-code", ""\)\)/);
  assert.match(cli, /runtimeUsageFromFile\(argValue\(args, "--usage-file", null\)\)/);
  assert.match(cli, /const runtimeVersion = stringOrNull\(argValue\(args, "--runtime-version", null\)\)/);
  assert.match(cli, /\.\.\.\(runtimeVersion \? \{ runtimeVersion \} : \{\}\)/);
  assert.match(cli, /BUILDER_BLOG_JOB_RUN_ID/);
  assert.doesNotMatch(cli, /Hermes|HERMES_|detectedHermesModel/);
  assert.doesNotMatch(cli, /Gemini CLI|detectedGeminiModel|GEMINI_MODEL/);

  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /LAST_AGENT_OUTPUT_FILE/);
  assert.match(runner, /JOB_UPDATE_RESET_FENCED=78/);
  assert.match(
    runner,
    /job_update_error_is_reset_fenced\(\) \{[\s\S]*grep -Fqx \\\n\s+'FOLLOWBRIEF_ERROR \{"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false\}'/,
  );
  assert.match(
    runner,
    /if \[ -n "\$\{BUILDER_BLOG_JOB_UPDATE_ERROR_FILE:-\}" \]; then[\s\S]*job-run-update[\s\S]*>\s*\/dev\/null 2>"\$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"[\s\S]*else[\s\S]*job-run-update[\s\S]*>\s*\/dev\/null 2>&1[\s\S]*fi/,
  );
  assert.match(
    runner,
    /strict_job_run_update_for_instance\(\) \{[\s\S]*BUILDER_BLOG_JOB_UPDATE_ERROR_FILE="\$_sjrui_error_file"[\s\S]*job_update_error_is_reset_fenced "\$_sjrui_error_file"[\s\S]*_sjrui_code="\$JOB_UPDATE_RESET_FENCED"/,
  );
  assert.match(runner, /job_run_update failed "Runtime exited with code \$_code\." "runtime_finished" \\\n\s+--exit-code "\$_code"/);
  assert.match(runner, /job_run_update timed_out "Runtime reported a timeout\." "runtime_reported_timeout" \\\n\s+--exit-code "\$_code"/);
  assert.match(runner, /job_run_update succeeded "Runtime completed successfully\." "runtime_finished" \\\n\s+--stage "completed" \\\n\s+--exit-code "\$_code"/);
  assert.match(runner, /DEFAULT_CODEX_MODEL="gpt-5\.6-luna"/);
  assert.match(runner, /DEFAULT_CODEX_FALLBACK_MODEL="gpt-5\.4-mini"/);
  assert.match(runner, /DEFAULT_CODEX_REASONING_EFFORT="medium"/);
  assert.match(
    runner,
    /run_with_codex\(\) \{[\s\S]*_codex_model="\$\{BUILDER_BLOG_CODEX_MODEL:-\$DEFAULT_CODEX_MODEL\}"[\s\S]*_codex_reasoning_effort="\$\{BUILDER_BLOG_CODEX_REASONING_EFFORT:-\$DEFAULT_CODEX_REASONING_EFFORT\}"[\s\S]*codex exec --json --model "\$_codex_model"[\s\S]*-c "model_reasoning_effort=\$_codex_reasoning_effort"[\s\S]*codex exec --model "\$_codex_model"[\s\S]*-c "model_reasoning_effort=\$_codex_reasoning_effort"/,
  );
  assert.match(
    runner,
    /run_with_codex_unattended\(\) \{[\s\S]*_codex_model="\$\{BUILDER_BLOG_CODEX_MODEL:-\$DEFAULT_CODEX_MODEL\}"[\s\S]*_codex_reasoning_effort="\$\{BUILDER_BLOG_CODEX_REASONING_EFFORT:-\$DEFAULT_CODEX_REASONING_EFFORT\}"[\s\S]*run_codex_exec_unattended "\$_codex_model" "\$_codex_reasoning_effort" --json[\s\S]*run_codex_exec_unattended "\$_codex_model" "\$_codex_reasoning_effort"/,
  );
  assert.match(runner, /BUILDER_BLOG_RUNTIME_VERSION=""/);
  assert.match(runner, /if \[ "\$BUILDER_BLOG_RUNTIME" = "codex" \]/);
  assert.match(runner, /codex --version 2>\/dev\/null \|\| true/);
  assert.match(runner, /export BUILDER_BLOG_RUNTIME_VERSION/);
  assert.match(runner, /--runtime-version "\$\{BUILDER_BLOG_RUNTIME_VERSION:-\}"/);
  assert.match(
    runner,
    /BUILDER_BLOG_AGENT_MODEL="\$\{BUILDER_BLOG_CODEX_MODEL:-\$DEFAULT_CODEX_MODEL\}"/,
  );
  assert.match(runner, /resolve_codex_model_for_job\(\)[\s\S]*DEFAULT_CODEX_FALLBACK_MODEL/);
  assert.doesNotMatch(runner, /download[^\n]*codex|managed[^\n]*codex[^\n]*(?:binary|cli)/i);
  assert.match(
    runner,
    /runtime-model-incompatible\.txt[\s\S]*runtime_model_incompatible/,
  );
  assert.match(
    runner,
    /elif \[ "\$_code" -eq 78 \] && \[ -s "\$JOB_TMP_DIR\/runtime-model-incompatible\.txt" \]; then[\s\S]*report_runtime_model_failure/,
  );
  assert.match(
    runner,
    /report_runtime_model_failure\(\) \{[\s\S]*runtime_model_incompatible\|runtime_model_preflight_failed[\s\S]*job_run_update failed "\$_rrmf_summary" "\$_rrmf_reason"/,
  );
  assert.match(runner, /BUILDER_BLOG_AGENT_MODEL="\$\{BUILDER_BLOG_CLAUDE_MODEL:-sonnet\}"/);
  assert.match(runner, /export BUILDER_BLOG_AGENT_MODEL/);
  assert.match(runner, /--usage-file/);
  assert.match(runner, /if node "\$AGENT_DIR\/builder-digest\.mjs" job-run-update[\s\S]*if \[ "\$_status" = "starting" \]; then[\s\S]*refusing to start stale work[\s\S]*return 1/);
  assert.match(runner, /if ! job_run_update starting "Runtime job accepted by local runner\." "runtime_job_started"; then[\s\S]*return 1[\s\S]*fi[\s\S]*run_job_payload &/);
  assert.match(runner, /if ! job_run_update starting "Worker host accepted by local runner\." "worker_host_started"[\s\S]*clear_current_file[\s\S]*cleanup_job_tmp_dir killed "worker_host_lease_rejected"[\s\S]*return 1/);
});

test("server-issued job leases fence fetch writes without trusting runner clocks", () => {
  const fetchRuns = source("src/app/api/skill/fetch-runs/route.ts");
  const fetchRunPatch = source("src/app/api/skill/fetch-runs/[id]/route.ts");
  const builders = source("src/app/api/skill/builders/route.ts");

  assert.match(fetchRuns, /jobRunId[^\n]*required/i);
  assert.match(fetchRuns, /jobType: "library-fetch"/);
  assert.match(fetchRuns, /const jobRunId = parsed\.data\.jobRunId/);
  assert.match(fetchRuns, /instanceId: jobRunId/);
  assert.match(fetchRuns, /lockResetFenceForWorker\(tx, jobRun\.createdAt, userResetFenceId\(user\.id\)\)/);
  assert.doesNotMatch(fetchRuns, /lockResetFenceForWorker\(tx, startedAt\)/);
  assert.match(fetchRunPatch, /select: \{[\s\S]*createdAt: true/);
  assert.match(fetchRunPatch, /lockResetFenceForWorker\(tx, run\.createdAt, userResetFenceId\(user\.id\)\)/);
  assert.match(builders, /select: \{ id: true, details: true, createdAt: true \}/);
  assert.match(builders, /lockResetFenceForWorker\(tx, run\.createdAt, userResetFenceId\(user\.id\)\)/);
});

test("agent job run floor helper keeps the visible window and linked older instances", async () => {
  const { agentJobRunFloorFilter } = await loadAgentJobRunsModule();
  assert.equal(typeof agentJobRunFloorFilter, "function");

  const before = new Date("2026-07-20T12:00:00.000Z");
  const runFloor = new Date("2026-07-19T12:00:00.000Z");

  assert.deepEqual(
    agentJobRunFloorFilter({
      before,
      runFloor,
      linkedInstanceIds: ["", " job-older ", "job-older", "job-window"],
    }),
    {
      AND: [
        { startedAt: { lt: before } },
        {
          OR: [
            { startedAt: { gte: runFloor } },
            { instanceId: { in: ["job-older", "job-window"] } },
          ],
        },
      ],
    },
  );
});

test("agent job run floor helper keeps the plain floor when no linked instances are visible", async () => {
  const { agentJobRunFloorFilter } = await loadAgentJobRunsModule();
  assert.equal(typeof agentJobRunFloorFilter, "function");

  const runFloor = new Date("2026-07-19T12:00:00.000Z");

  assert.deepEqual(
    agentJobRunFloorFilter({
      before: null,
      runFloor,
      linkedInstanceIds: ["", "   "],
    }),
    { startedAt: { gte: runFloor } },
  );
});

test("scheduled job run floor helper applies before to every result and links older scheduled instances", async () => {
  const { scheduledAgentJobRunFloorFilter } = await loadAgentJobRunsModule();
  assert.equal(typeof scheduledAgentJobRunFloorFilter, "function");

  const before = new Date("2026-07-20T12:00:00.000Z");
  const runFloor = new Date("2026-07-19T12:00:00.000Z");

  assert.deepEqual(
    scheduledAgentJobRunFloorFilter({
      before,
      runFloor,
      linkedInstanceIds: ["", " cron-old ", "cron-old"],
    }),
    {
      AND: [
        {
          OR: [
            { expectedAt: { lt: before } },
            { expectedAt: null, startedAt: { lt: before } },
          ],
        },
        {
          OR: [
            { expectedAt: { gte: runFloor } },
            { expectedAt: null, startedAt: { gte: runFloor } },
            { instanceId: { in: ["cron-old"] } },
          ],
        },
      ],
    },
  );
});

test("fetch history query plan collects linked ids from visible runs and keeps the shared floor semantics", async () => {
  const { buildFetchRunHistoryAgentJobQueryPlan } = await loadAgentJobRunsModule();
  assert.equal(typeof buildFetchRunHistoryAgentJobQueryPlan, "function");

  const before = new Date("2026-07-20T12:00:00.000Z");
  const newer = new Date("2026-07-20T11:00:00.000Z");
  const floor = new Date("2026-07-20T09:00:00.000Z");
  const older = new Date("2026-07-20T07:00:00.000Z");

  assert.deepEqual(
    buildFetchRunHistoryAgentJobQueryPlan({
      rows: [
        { startedAt: newer, jobRunId: null },
        { startedAt: floor, jobRunId: " regular-linked " },
        { startedAt: older, jobRunId: "ignored-below-visible-page" },
      ],
      cronRows: [
        { startedAt: newer, jobRunId: "scheduled-linked" },
        { startedAt: floor, jobRunId: "regular-linked" },
      ],
      before,
      pageSize: 2,
    }),
    {
      linkedInstanceIds: ["regular-linked", "scheduled-linked"],
      runFloor: floor,
      regularJobRunWhere: {
        AND: [
          { startedAt: { lt: before } },
          {
            OR: [
              { startedAt: { gte: floor } },
              { instanceId: { in: ["regular-linked", "scheduled-linked"] } },
            ],
          },
        ],
      },
      scheduledJobRunWhere: {
        AND: [
          {
            OR: [
              { expectedAt: { lt: before } },
              { expectedAt: null, startedAt: { lt: before } },
            ],
          },
          {
            OR: [
              { expectedAt: { gte: floor } },
              { expectedAt: null, startedAt: { gte: floor } },
              { instanceId: { in: ["regular-linked", "scheduled-linked"] } },
            ],
          },
        ],
      },
    },
  );
});

test("fetch history page finalizer preserves unsliced floor windows and existing hasMore behavior", async () => {
  const { finalizeFetchRunHistoryAgentJobPage } = await loadAgentJobRunsModule();
  assert.equal(typeof finalizeFetchRunHistoryAgentJobPage, "function");

  const floor = new Date("2026-07-20T09:00:00.000Z");
  const regularJobRuns = ["linked-older", "window-unlinked", "window-other"];
  const scheduledJobRuns = ["scheduled-linked", "scheduled-window"];

  assert.deepEqual(
    finalizeFetchRunHistoryAgentJobPage({
      runFloor: floor,
      rowCount: 2,
      cronRowCount: 1,
      pageSize: 2,
      jobRuns: regularJobRuns,
      scheduledJobRuns,
      moreJobRuns: false,
      moreScheduledJobRuns: true,
    }),
    {
      visibleJobRuns: regularJobRuns,
      visibleScheduledJobRuns: scheduledJobRuns,
      hasMore: true,
    },
  );

  assert.deepEqual(
    finalizeFetchRunHistoryAgentJobPage({
      runFloor: null,
      rowCount: 1,
      cronRowCount: 1,
      pageSize: 2,
      jobRuns: ["job-1", "job-2", "job-3"],
      scheduledJobRuns: ["sched-1", "sched-2", "sched-3"],
      moreJobRuns: false,
      moreScheduledJobRuns: false,
    }),
    {
      visibleJobRuns: ["job-1", "job-2"],
      visibleScheduledJobRuns: ["sched-1", "sched-2"],
      hasMore: true,
    },
  );
});

test("shared fetch history loader keeps linked older runtimes and account-scoped floor queries", async () => {
  const { loadFetchRunHistoryAgentJobs } = await loadAgentJobRunsModule();
  assert.equal(typeof loadFetchRunHistoryAgentJobs, "function");

  const before = new Date("2026-07-20T12:00:00.000Z");
  const newer = new Date("2026-07-20T11:00:00.000Z");
  const floor = new Date("2026-07-20T09:00:00.000Z");
  const linkedOlder = new Date("2026-07-20T08:00:00.000Z");
  const manyCalls: unknown[] = [];
  const firstCalls: unknown[] = [];

  const result = await loadFetchRunHistoryAgentJobs({
    userId: "account-1",
    rows: [
      { startedAt: newer, jobRunId: "linked-regular" },
      { startedAt: floor, jobRunId: "linked-scheduled" },
    ],
    cronRows: [
      { startedAt: floor, jobRunId: "linked-scheduled" },
    ],
    before,
    pageSize: 2,
    querySize: 3,
    query: {
      findMany: async (args) => {
        manyCalls.push(args);
        if ("scheduleJob" in args.where) {
          return [
            agentJobRunFixture({
              instanceId: "scheduled-window",
              startedAt: floor,
              expectedAt: floor,
              scheduleJob: "library-cron",
            }),
            agentJobRunFixture({
              instanceId: "linked-scheduled",
              startedAt: linkedOlder,
              expectedAt: linkedOlder,
              scheduleJob: "library-cron",
            }),
          ];
        }
        return [
          agentJobRunFixture({ instanceId: "window-unlinked", startedAt: newer }),
          agentJobRunFixture({ instanceId: "linked-regular", startedAt: linkedOlder }),
        ];
      },
      findFirst: async (args) => {
        firstCalls.push(args);
        return "scheduleJob" in args.where ? { id: "older-scheduled" } : null;
      },
    },
  });

  assert.deepEqual(
    result.jobRuns.map((run) => run.instanceId),
    ["window-unlinked", "linked-regular"],
  );
  assert.deepEqual(
    result.scheduledJobRuns.map((run) => run.instanceId),
    ["scheduled-window", "linked-scheduled"],
  );
  assert.equal(result.jobRuns[1].startedAt, linkedOlder.toISOString());
  assert.equal(result.scheduledJobRuns[1].expectedAt, linkedOlder.toISOString());
  assert.equal(result.hasMore, true);
  assert.deepEqual(manyCalls, [
    {
      where: {
        userId: "account-1",
        jobType: "library-fetch",
        AND: [
          { startedAt: { lt: before } },
          {
            OR: [
              { startedAt: { gte: floor } },
              { instanceId: { in: ["linked-regular", "linked-scheduled"] } },
            ],
          },
        ],
      },
      orderBy: { startedAt: "desc" },
    },
    {
      where: {
        userId: "account-1",
        scheduleJob: "library-cron",
        trigger: "scheduled",
        AND: [
          {
            OR: [
              { expectedAt: { lt: before } },
              { expectedAt: null, startedAt: { lt: before } },
            ],
          },
          {
            OR: [
              { expectedAt: { gte: floor } },
              { expectedAt: null, startedAt: { gte: floor } },
              { instanceId: { in: ["linked-regular", "linked-scheduled"] } },
            ],
          },
        ],
      },
      orderBy: [{ expectedAt: "desc" }, { startedAt: "desc" }],
    },
  ]);
  assert.deepEqual(firstCalls, [
    {
      where: {
        userId: "account-1",
        jobType: "library-fetch",
        startedAt: { lt: floor },
      },
      select: { id: true },
    },
    {
      where: {
        userId: "account-1",
        scheduleJob: "library-cron",
        trigger: "scheduled",
        OR: [
          { expectedAt: { lt: floor } },
          { expectedAt: null, startedAt: { lt: floor } },
        ],
      },
      select: { id: true },
    },
  ]);
});

test("shared fetch history loader falls back to count-capped cursor paging without a fetch floor", async () => {
  const { loadFetchRunHistoryAgentJobs } = await loadAgentJobRunsModule();
  assert.equal(typeof loadFetchRunHistoryAgentJobs, "function");

  const before = new Date("2026-07-20T12:00:00.000Z");
  const regularRuns = [
    agentJobRunFixture({ instanceId: "regular-1", startedAt: new Date("2026-07-20T11:00:00.000Z") }),
    agentJobRunFixture({ instanceId: "regular-2", startedAt: new Date("2026-07-20T10:00:00.000Z") }),
    agentJobRunFixture({ instanceId: "regular-3", startedAt: new Date("2026-07-20T09:00:00.000Z") }),
  ];
  const scheduledRuns = regularRuns.map((run) => ({
    ...run,
    id: `scheduled-${run.id}`,
    instanceId: `scheduled-${run.instanceId}`,
    trigger: "scheduled",
    scheduleJob: "library-cron",
    expectedAt: run.startedAt,
  }));
  const manyCalls: unknown[] = [];

  const result = await loadFetchRunHistoryAgentJobs({
    userId: "account-2",
    rows: [],
    cronRows: [],
    before,
    pageSize: 2,
    querySize: 3,
    query: {
      findMany: async (args) => {
        manyCalls.push(args);
        return "scheduleJob" in args.where ? scheduledRuns : regularRuns;
      },
      findFirst: async () => {
        assert.fail("fallback paging must not query older-floor flags");
      },
    },
  });

  assert.deepEqual(result.jobRuns.map((run) => run.instanceId), ["regular-1", "regular-2"]);
  assert.deepEqual(
    result.scheduledJobRuns.map((run) => run.instanceId),
    ["scheduled-regular-1", "scheduled-regular-2"],
  );
  assert.equal(result.hasMore, true);
  assert.deepEqual(manyCalls, [
    {
      where: {
        userId: "account-2",
        jobType: "library-fetch",
        startedAt: { lt: before },
      },
      orderBy: { startedAt: "desc" },
      take: 3,
    },
    {
      where: {
        userId: "account-2",
        scheduleJob: "library-cron",
        trigger: "scheduled",
        OR: [
          { expectedAt: { lt: before } },
          { expectedAt: null, startedAt: { lt: before } },
        ],
      },
      orderBy: [{ expectedAt: "desc" }, { startedAt: "desc" }],
      take: 3,
    },
  ]);
});

test("terminal agent job runs cannot be regressed by late runtime updates", () => {
  const route = source("src/app/api/skill/job-runs/route.ts");

  assert.match(route, /TERMINAL_AGENT_JOB_STATUSES/);
  assert.match(route, /existingRun && isTerminalAgentJobStatus\(existingRun\.status\)/);
  assert.match(route, /status: existingRun\.status/);
  assert.match(route, /finishedAt: existingRun\.finishedAt/);
  assert.match(route, /exitCode: existingRun\.exitCode/);
  assert.match(route, /signal: existingRun\.signal/);
  // Conversely, a terminal record's summary/stage (the failure/timeout reason)
  // must replace an earlier in-progress summary even though the runner posts it
  // without a ranked stage — otherwise a failed run keeps showing stale
  // mid-sync text instead of "Runtime exited with code N.".
  assert.match(route, /const incomingTerminal = isTerminalAgentJobStatus\(parsed\.data\.status\)/);
  assert.match(route, /if \(incomingTerminal\) return nextSummary;/);
  assert.match(route, /if \(incomingTerminal\) return incomingStage;/);
});

test("library fetch job runs carry bounded live progress without schema churn", () => {
  const cli = source("scripts/builder-digest.mjs");
  const panel = source("src/components/FetchLogPanel.tsx");
  const route = source("src/app/api/skill/job-runs/route.ts");

  assert.match(cli, /FETCH_PROGRESS_VERSION = 1/);
  assert.match(cli, /FETCH_PROGRESS_RECENT_EVENT_LIMIT = 60/);
  assert.match(cli, /FETCH_PROGRESS_SOURCE_LIMIT = 120/);
  assert.match(cli, /FETCH_PROGRESS_TASK_LIMIT = 120/);
  assert.match(cli, /FETCH_PROGRESS_WEB_RECENT_EVENT_LIMIT = 20/);
  assert.match(cli, /FETCH_PROGRESS_WEB_SOURCE_LIMIT = 32/);
  assert.match(cli, /FETCH_PROGRESS_WEB_TASK_LIMIT = 24/);
  assert.match(cli, /function createFetchProgressState/);
  assert.match(cli, /async function emitFetchJobProgress/);
  assert.match(cli, /async function emitCheckpointProgress/);
  assert.match(cli, /async function readShardProgressFiles/);
  assert.match(cli, /function applyFetchProgressTaskOutcomes/);
  assert.match(cli, /const alreadyCompleted = completed\.has\(id\)/);
  assert.match(cli, /if \(!alreadyCompleted\) \{/);
  assert.match(cli, /workerId: outcome\.workerId/);
  assert.match(cli, /summaryChars: outcome\.summaryChars/);
  assert.match(cli, /upsertFetchProgressTask/);
  assert.match(cli, /--completed-only/);
  assert.match(cli, /filterFetchResultToTasks/);
  assert.match(cli, /filterSyncPayloadToTasks/);
  assert.match(cli, /backfillMissing: !completedOnly/);
  assert.match(cli, /completedTaskIds/);
  assert.match(cli, /includeInternal/);
  assert.match(cli, /fetchProgressSnapshot\(progress, \{ web: true \}\)/);
  assert.match(cli, /progress: fetchProgressSnapshotValue/);
  assert.match(cli, /agentModel: DEFAULT_AGENT_MODEL \|\| null/);
  assert.match(cli, /tasks: Array\.isArray\(progress\.tasks\)/);
  assert.match(cli, /reason: compactProgressText\(task\.reason \?\? task\.failureReason/);
  assert.match(cli, /reason: outcome\.failureReason/);
  assert.match(cli, /checkpoint-progress/);
  assert.match(cli, /stage: "scanning_sources"/);
  assert.match(cli, /stage: "tasks_planned"/);
  assert.match(cli, /stage: partialOutcomes \? "checkpoint_syncing" : "syncing"/);
  assert.match(cli, /stage: "reconciled"/);
  assert.match(cli, /type: "source_checked"/);
  assert.match(cli, /type: "task_completed"/);
  assert.match(
    cli,
    /async function fetchCloudLibrary[\s\S]*createFetchProgressState[\s\S]*onSourceProgress[\s\S]*seedFetchProgressPlannedTasks/,
  );
  assert.match(
    cli,
    /async function fetchCloudLibrary[\s\S]*stage: "leasing_cloud_sources"[\s\S]*stage: "scanning_sources"[\s\S]*stage: "tasks_planned"/,
  );
  assert.doesNotMatch(cli, /model LibraryFetchProgress/);

  assert.match(panel, /type FetchJobProgress/);
  assert.match(panel, /type FetchTaskProgress/);
  assert.match(panel, /decodeHtmlEntities/);
  assert.match(panel, /function displayText/);
  assert.match(panel, /function readFetchJobProgress/);
  assert.match(panel, /function fetchTaskProgressMap/);
  assert.match(panel, /function JobLifecycle/);
  assert.match(panel, /function LifecyclePipeline/);
  assert.match(panel, /liveTask=\{task\.id \? liveTasks\.get\(canonicalFetchTaskId\(task\.id\)\) \?\? null : null\}/);
  assert.match(panel, /function liveFetchOutcome/);
  assert.match(panel, /function liveSummarizeOutcome/);
  assert.match(panel, /jobRun\.details[\s\S]*progress/);
  assert.match(panel, /tasksDone/);
  assert.match(panel, /recentEvents/);
  assert.match(panel, /actionNeeded/);
  assert.match(panel, /function jobRunStageLabel/);
  assert.match(panel, /normalized === "heartbeat"/);
  assert.match(panel, /showRuntimeState && runtimeStageLabel/);
  assert.doesNotMatch(panel, /\{jobRun\.stage \|\| "runtime"\} ·/);
  assert.match(route, /function mergeAgentJobRunDetails/);
  assert.match(route, /function mergeAgentJobRunProgress/);
  assert.match(route, /function mergeAgentJobRunStage/);
  assert.match(route, /run_fetch_workers: 30,[\s\S]*workers_running: 30,[\s\S]*checkpoint_syncing: 30/);
  assert.match(route, /completed: 70/);
  assert.match(route, /canonicalFetchTaskId/);
  assert.match(route, /function finalizeAgentJobRunProgress/);
  assert.match(route, /type: "job_completed"/);
  assert.match(route, /compactAgentJobRunDetails/);
  assert.match(route, /existingRun\?\.details/);
  assert.match(route, /mergeAgentJobRunProgress\(current\.progress, next\.progress\)/);
  assert.match(route, /dedupeFetchProgressEvents/);
  assert.match(route, /mergeFetchProgressTask/);
  assert.match(route, /function mergeProgressTasks/);
});

test("runner supervises cron workers instead of skipping active old instances", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  const workerPrompt = source("skills/builder-blog-digest/jobs/library-worker.md");

  assert.match(runner, /run_cron_supervisor/);
  assert.match(runner, /run_cron_scheduler_tick/);
  assert.match(runner, /run_cron_worker/);
  assert.match(runner, /payload_prompt_file/);
  assert.match(runner, /digest-once\)[\s\S]*jobs\/digest-cron\.md/);
  assert.match(runner, /BUILDER_BLOG_WORKER_MODE=1/);
  assert.match(runner, /BUILDER_BLOG_SCHEDULER_TICK/);
  assert.match(runner, /due_expected_at/);
  assert.match(runner, /scheduler_last_fired_file/);
  assert.match(runner, /schedule-anchor-\$JOB_NAME-\$ACCOUNT_SLUG/);
  assert.match(runner, /INSTANCE_ID=/);
  assert.match(runner, /JOB_STATE_DIR=/);
  assert.match(runner, /RUNS_DIR="\$JOB_STATE_DIR\/runs"/);
  assert.match(runner, /prepare_run_tmp_dir/);
  assert.match(runner, /write_run_owner_file/);
  assert.match(runner, /validate_run_tmp_dir/);
  assert.match(runner, /terminate_job_tmp_processes/);
  assert.match(runner, /job_tmp_process_pids/);
  assert.match(runner, /cleanup_job_tmp_dir/);
  assert.match(runner, /cleanup_old_job_runs/);
  assert.match(runner, /tracked_job_signal_cleanup\(\)[\s\S]*terminate_process_tree "\$RUNTIME_PID" TERM 10[\s\S]*terminate_job_tmp_processes TERM 3/);
  assert.match(runner, /CURRENT_FILE="\$JOB_STATE_DIR\/current\.json"/);
  assert.match(runner, /clear_current_file/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$BUILDER_BLOG_WORKER_PID"/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$WORKER_PID"/);
  assert.match(runner, /run_one_time_with_lock/);
  assert.match(runner, /BUILDER_BLOG_REPLACE_ACTIVE_ONETIME/);
  assert.match(runner, /A one-time FollowBrief \$JOB_NAME run is already active/);
  assert.match(runner, /Replaced by a newer one-time run/);
  assert.match(runner, /one_time_replace_requested/);
  assert.match(runner, /stale_pid_one_time/);
  assert.match(runner, /WORKER_PID="\$\$"/);
  assert.match(runner, /BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH/);
  assert.match(runner, /worker_bootstrap_failed/);
  assert.match(runner, /worker_prompt_missing/);
  assert.match(runner, /refresh_skill_files[\s\S]*worker_bootstrap_failed[\s\S]*write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$WORKER_PID"/);
  assert.match(runner, /Scheduled worker running in launchd foreground/);
  assert.match(runner, /Running scheduled window \$EXPECTED_AT as pid \$WORKER_PID/);
  assert.match(runner, /exec "\$0" "\$JOB_NAME"/);
  assert.match(runner, /set \+e[\s\S]*run_cron_worker[\s\S]*_code="\$\?"/);
  assert.match(runner, /schedule_status_file\(\)/);
  assert.match(runner, /schedule_timezone_file\(\)/);
  assert.match(runner, /--schedule "\$_schedule_value"/);
  assert.match(runner, /--time-zone "\$_schedule_time_zone"/);
  assert.match(runner, /builder-digest\.mjs" schedule-due/);
  assert.match(runner, /daily\|weekly/);
  assert.match(
    runner,
    /if \[ -n "\$_schedule_value" \] && \[ -n "\$_schedule_time_zone" \]; then[\s\S]*schedule-due[\s\S]*return \$\?[\s\S]*fi[\s\S]*node - "\$_anchor_file" "\$_interval_seconds"/,
  );
  assert.match(runner, /node - "\$_anchor_file" "\$_interval_seconds"/);
  assert.match(runner, /verify_followbrief_pid/);
  assert.match(runner, /terminate_process_tree/);
  assert.match(runner, /process_tree_pids/);
  assert.match(runner, /still_alive_after_kill/);
  assert.match(runner, /skipped-wait-pids/);
  assert.match(runner, /job_run_update_for_instance/);
  assert.match(runner, /reconcile_current_file/);
  assert.match(runner, /stale_pid_after_scheduler_tick/);
  assert.match(runner, /stale_pid_next_schedule_arrived/);
  assert.match(runner, /Recorded worker exited before reporting a terminal state/);
  assert.match(runner, /Previous scheduled worker exited before reporting a terminal state/);
  assert.match(runner, /\[ "\$\(cat "\$LAST_FIRED_FILE" 2>\/dev\/null \|\| true\)" = "\$EXPECTED_AT" \][\s\S]*reconcile_current_file "\$CURRENT_FILE"[\s\S]*return 0/);
  assert.match(runner, /OLD_STARTED="\$\(json_get_string startedAt "\$CURRENT_FILE"\)"/);
  assert.match(runner, /OLD_EXPECTED="\$\(json_get_string expectedAt "\$CURRENT_FILE"\)"/);
  assert.match(runner, /next_schedule_arrived/);
  assert.match(runner, /status replaced/);
  assert.match(runner, /status killed/);
  assert.match(runner, /HEARTBEAT_INTERVAL_SECONDS=60/);
  assert.match(runner, /timeout_seconds_for_job/);
  assert.match(runner, /worker_window_deadline_epoch_file\(\)/);
  assert.match(runner, /current_outer_deadline_epoch_seconds\(\)/);
  assert.match(runner, /_deadline_epoch="\$\(current_outer_deadline_epoch_seconds\)"/);
  assert.match(runner, /library-cron\)[\s\S]*120 \* 60/);
  assert.match(runner, /digest-cron\)[\s\S]*45 \* 60/);
  assert.match(runner, /20 \* 60/);
  assert.match(runner, /agent_output_has_timeout/);
  assert.match(runner, /agent_output_file\(\)/);
  assert.match(runner, /mktemp "\$JOB_TMP_DIR\/\$_runtime-agent-output\.XXXXXX"/);
  assert.doesNotMatch(runner, /mktemp "\$JOB_TMP_DIR\/\$_runtime-agent-output\.XXXXXX\.log"/);
  assert.match(runner, /_codex_output="\$\(agent_output_file codex\)"/);
  assert.match(runner, /_claude_output="\$\(agent_output_file claude\)"/);
  assert.match(runner, /_openclaw_output="\$\(agent_output_file openclaw\)"/);
  assert.doesNotMatch(runner, /Hermes|HERMES_|run_with_hermes|agent_output_file hermes|hermes chat/);
  assert.doesNotMatch(runner, /agent-output-\$\$\.log/);
  assert.match(runner, /Request timed out before a response was generated/);
  assert.match(runner, /codex app-server turn idle timed out/);
  assert.match(runner, /DEADLINE_EXCEEDED/);
  assert.doesNotMatch(runner, /skipping duplicate cron launch/);
  assert.doesNotMatch(runner, /\)\s*>> "\$LOG_FILE" 2>&1 &/);
  assert.match(runner, /copy_recovery_file\(\)/);
  assert.match(runner, /_debug_dir\/recovery/);
  assert.match(runner, /library-fetch-result\.json/);
  assert.match(runner, /shards\/shard-\*\.json/);
  assert.match(runner, /shards\/results\/shard-\*-result\.json/);
  assert.match(runner, /_flir_recovery_dir="\$JOB_TMP_DIR\/debug\/recovery"/);
  assert.match(runner, /_flir_result_file="\$_flir_recovery_dir\/library-fetch-result\.json"/);
  assert.match(runner, /flush_remaining_library_results\(\)/);
  assert.match(runner, /_frlr_sync_failures="\$\{_sps_failures:-1\}"/);
  assert.doesNotMatch(
    runner,
    /if ! sync_payload_slices[^]*?then\s+_frlr_sync_failures=1\s+fi/,
  );
  assert.match(runner, /merge-task-results[\s\S]*tee "\$_frlr_merge_result_file"/);
  assert.match(runner, /checkpoint-progress[\s\S]*--results-dir "\$_results_dir"/);
  assert.match(runner, /sync_completed_checkpoints/);
  assert.match(runner, /completed-checkpoint-synced-task-ids\.txt/);
  assert.match(runner, /merge-task-results[\s\S]*--completed-only/);
  assert.match(runner, /Best-effort syncing \$_scc_count completed library task/);
  assert.match(runner, /flush_library_interrupted_results\(\)/);
  assert.match(
    runner,
    /finalize_library_timeout_results\(\)[\s\S]*flush_library_interrupted_results "runtime-timeout" "runtime_timeout"/,
  );
  assert.match(runner, /finalize_library_timeout_results\(\)/);
  assert.match(runner, /runtime_timeout_flush_started/);
  assert.match(runner, /job_run_update running "Runtime timed out; syncing terminal library results\." "runtime_timeout_flush_started"/);
  assert.match(runner, /runtime_timeout_no_fetch_result/);
  assert.match(
    runner,
    /tracked_job_signal_cleanup\(\)[\s\S]*terminate_process_tree "\$RUNTIME_PID" TERM 10 \|\| true\s+wait "\$RUNTIME_PID" 2>\/dev\/null \|\| true[\s\S]*cleanup_job_tmp_dir killed/,
  );
  assert.match(
    runner,
    /tracked_job_signal_cleanup\(\)[\s\S]*TRACKED_JOB_FINALIZED=1[\s\S]*trap '' TERM INT[\s\S]*clear_current_file "\$BUILDER_BLOG_CURRENT_FILE" "\$\{BUILDER_BLOG_JOB_RUN_ID:-\}"[\s\S]*library-once\|library-cron\)[\s\S]*flush_library_interrupted_results "runtime-interrupted" "runtime_interrupted"/,
  );
  assert.match(runner, /runner_interrupted_flush_finished/);
  assert.match(runner, /runner_interrupted_flush_failed/);
  assert.match(runner, /job_run_update running "Runtime exceeded timeout and will be terminated\." "timeout_seconds_for_job"/);
  assert.match(runner, /job_run_update running "Runtime timed out; cleanup started\." "timeout_seconds_for_job"/);
  assert.doesNotMatch(runner, /job_run_update timed_out "Runtime exceeded timeout and will be terminated\." "timeout_seconds_for_job"/);
  assert.match(runner, /mkdir -p "\$_flir_results_dir"/);
  assert.doesNotMatch(runner, /\[ -d "\$_flir_results_dir" \] \|\| return 0/);
  assert.match(runner, /flush_remaining_library_results "\$_flir_result_file"/);
  assert.match(runner, /"runtime-timeout" "runtime_timeout"/);
  assert.match(runner, /--default-missing-reason \$_frlr_missing_reason/);
  assert.match(runner, /_frlr_sync_command="\$\{SYNC_BUILDERS_COMMAND:-\}"/);
  assert.match(runner, /append-fetch-run-terminal-task-ids[\s\S]*--out "\$_frlr_synced_ids_file"/);
  const finalFlush = runner.slice(
    runner.indexOf("flush_remaining_library_results()"),
    runner.indexOf("cloud_fetch_heartbeat()"),
  );
  const receiptRefreshes = finalFlush.match(/append-fetch-run-terminal-task-ids/g) ?? [];
  assert.equal(receiptRefreshes.length, 2);
  const finalSync = finalFlush.indexOf(
    'sync_payload_slices "$_frlr_remaining_tasks" "$_frlr_remaining_payload"',
  );
  assert.ok(finalSync > 0);
  assert.ok(finalFlush.lastIndexOf("append-fetch-run-terminal-task-ids") > finalSync);
  assert.doesNotMatch(runner, /if \[ "\$_sync_command" = "sync-cloud-builders" \] && \[ "\$_frlr_sync_failures"/);
  assert.match(runner, /worker_no_progress_timeout/);
  assert.match(runner, /worker_no_progress_timeout_seconds/);
  assert.match(runner, /worker_stalled_timeout/);
  assert.match(runner, /worker_stall_timeout_seconds/);
  assert.match(runner, /worker_progress_mtime_seconds/);
  assert.match(
    runner,
    /if ! terminate_process_tree "\$_pid" TERM 5; then\s+terminate_process_tree "\$_pid" KILL 3 \|\| true\s+fi\s+wait "\$_pid" 2>\/dev\/null \|\| true/,
  );
  assert.doesNotMatch(runner, /hermes auth|hermes model/);
  assert.match(
    runner,
    /if \[ "\$INCOMING_RUNTIME_SET" = "1" \]; then\s+RAW_PINNED_RUNTIME="\$INCOMING_RUNTIME"\s+else\s+RAW_PINNED_RUNTIME="\$\(read_runtime_pin\)"\s+fi/,
  );
  assert.match(runner, /validate_runtime "\$RAW_PINNED_RUNTIME"/);
  assert.match(
    runner,
    /validate_runtime\(\) \{[\s\S]*claude\|codex\|openclaw[\s\S]*Unsupported FollowBrief runtime '\$1'\.[\s\S]*exit 78/,
  );
  assert.match(runner, /_claude_allowed_tools="Bash,Edit,Read,Write,Grep,Glob,WebFetch"/);
  assert.match(
    runner,
    /\[ "\$INCOMING_RUNTIME_SET" = "1" \][\s\S]*Selected runtime '\$PINNED_RUNTIME' is not on PATH for this one-time run\.[\s\S]*exit 78/,
  );
  assert.doesNotMatch(
    runner,
    /Pinned runtime '\$PINNED_RUNTIME' not on PATH for this one-time run — falling back to the discovery chain\./,
  );
  assert.match(runner, /_claude_disallowed_tools="Task,TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate"/);
  assert.match(runner, /claude_unattended_command\(\)/);
  assert.match(runner, /\[ "\$\{BUILDER_BLOG_LIBRARY_AGENT_STAGE:-\}" = "worker" \][\s\S]*--safe-mode --allowedTools "\$_claude_allowed_tools" --disallowedTools "\$_claude_disallowed_tools"/);
  assert.match(runner, /else[\s\S]*--allowedTools "\$_claude_allowed_tools"/);
  assert.match(runner, /--disallowedTools "\$_claude_disallowed_tools"/);
  assert.match(runner, /user-level Claude hooks cannot/);
  assert.doesNotMatch(runner, /--tools "\$_claude_allowed_tools"/);
  assert.match(runner, /BUILDER_BLOG_WORKER_NO_PROGRESS_SECONDS:-600/);
  assert.match(runner, /shards\/results\/shard-\*-agent-output\.log/);
  assert.match(runner, /shards\/results\/shard-\*-checkpoints\/progress\/\*\.json/);
  assert.match(runner, /agent-output-tails/);
  assert.match(runner, /backfilledOutcomes/);
  assert.match(runner, /worker\/result issue\(s\)/);
  assert.doesNotMatch(runner, /WORKER_PID="\$!"/);
  assert.doesNotMatch(runner, /rm -rf "\$JOB_STATE_DIR"/);
  assert.doesNotMatch(runner, /rm -rf "\$AGENT_DIR\/tmp"/);
  assert.doesNotMatch(runner, /rm -rf "\$AGENT_DIR\/tmp\/accounts"/);

  assert.match(workerPrompt, /Live progress checkpoints/);
  assert.match(workerPrompt, /\$BUILDER_BLOG_SHARD_CHECKPOINT_DIR\/progress\/<hash>\.json/);
  assert.match(workerPrompt, /under the `progress\/`[\s\S]*subdirectory/);
  assert.match(workerPrompt, /BUILDER_BLOG_SHARD_TIMEOUT_SECONDS/);
  assert.match(workerPrompt, /Managed long-media extraction is owned by the FollowBrief runner/);
  assert.match(workerPrompt, /Never start audio\/video download or speech-to-text work/);
  assert.doesNotMatch(workerPrompt, /extract-long-media|extraction_exceeds_shard_timeout/);
  assert.match(workerPrompt, /Do NOT use any subagent, nested agent, secondary session, or delegation/);
  assert.match(workerPrompt, /including Claude Task\/subagent tools,[\s\S]*`codex exec`, `claude -p`, `openclaw agent`/);
});

test("runner writes declared library setup verdicts before per-run cleanup without changing exit codes", () => {
  const runner = source("scripts/builder-agent-runner.sh");

  assert.match(
    runner,
    /write_initial_setup_verdict\(\) \{[\s\S]*BUILDER_BLOG_SETUP_INITIAL:-0[\s\S]*JOB_NAME" = "library-cron"[\s\S]*BUILDER_BLOG_SETUP_VERDICT_FILE/,
  );
  assert.match(
    runner,
    /classify-library-setup-verdict[\s\S]*--job-state-dir "\$JOB_STATE_DIR"[\s\S]*--run-dir "\$JOB_TMP_DIR"[\s\S]*--out "\$BUILDER_BLOG_SETUP_VERDICT_FILE"[\s\S]*--runner-exit-code "\$_wisv_code"[\s\S]*--instance-id "\$BUILDER_BLOG_JOB_RUN_ID"[\s\S]*--account-slug "\$ACCOUNT_SLUG"[\s\S]*--job-name "\$JOB_NAME"/,
  );
  assert.match(
    runner,
    /finalize_library_timeout_results \|\| true[\s\S]*write_initial_setup_verdict 124 \|\| true[\s\S]*cleanup_job_tmp_dir timed_out/,
  );
  assert.match(
    runner,
    /job_run_update failed "Runtime exited with code \$_code\."[\s\S]*write_initial_setup_verdict "\$_code" \|\| true[\s\S]*cleanup_job_tmp_dir "\$_cleanup_status"[\s\S]*return "\$_code"/,
  );
  const verdictStart = runner.indexOf("write_initial_setup_verdict() {");
  const verdictEnd = runner.indexOf("\n}\n\nrun_with_job_tracking()", verdictStart);
  assert.ok(verdictStart >= 0 && verdictEnd > verdictStart);
  const verdictFunction = runner.slice(verdictStart, verdictEnd);
  assert.doesNotMatch(verdictFunction, /digest-cron|cloud-library/);
});

test("runner cleans cloud host temp files and orphaned fetch tools", () => {
  const runner = source("scripts/builder-agent-runner.sh");

  assert.match(runner, /job_tmp_process_pids\(\)/);
  assert.match(runner, /index\(\$0, dir\)/);
  assert.match(runner, /terminate_job_tmp_processes\(\)/);
  assert.match(runner, /validate_run_tmp_dir/);
  assert.match(runner, /kill -s "\$_tjtp_signal" "\$_tjtp_pid"/);
  assert.match(runner, /kill -KILL "\$_tjtp_pid"/);
  assert.match(runner, /cleanup_transient_job_artifacts\(\)/);
  assert.match(runner, /cleanup_completed_managed_media_artifacts\(\)/);
  assert.match(runner, /-name 'fetch-\*'/);
  assert.match(runner, /-name 'youtube-asr'/);
  assert.match(runner, /cloud_host_signal_cleanup\(\)[\s\S]*terminate_job_tmp_processes TERM 3[\s\S]*cleanup_job_tmp_dir killed "worker_host_interrupted"/);
  assert.match(runner, /run_cloud_worker_host\(\)[\s\S]*cleanup_job_tmp_dir "\$_cleanup_status" "\$_cleanup_reason"[\s\S]*cleanup_old_job_runs/);
  assert.match(runner, /cloud_host_sleep_with_heartbeat[\s\S]*cleanup_transient_job_artifacts/);
  assert.match(
    runner,
    /flush_remaining_library_results[\s\S]*else[\s\S]*cleanup_completed_managed_media_artifacts[\s\S]*cleanup_transient_job_artifacts/,
  );
});

test("runner records worker roots so cleanup can kill children without a run path in argv", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  const helpersStart = runner.indexOf("process_start_epoch() {");
  const helpersEnd = runner.indexOf("\nwrite_worker_control_event() {", helpersStart);
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
  const helpers = runner.slice(helpersStart, helpersEnd);
  const tempDir = mkdtempSync(join(tmpdir(), "followbrief-process-roots-"));
  const scriptPath = join(tempDir, "verify.sh");
  writeFileSync(scriptPath, `#!/bin/sh
set -eu
JOB_TMP_DIR=${JSON.stringify(tempDir)}
worker_pid=""
cleanup_test_worker() {
  [ -z "$worker_pid" ] || kill -KILL "$worker_pid" 2>/dev/null || true
}
trap cleanup_test_worker EXIT
validate_run_tmp_dir() { return 0; }
${helpers}
sleep 30 &
worker_pid="$!"
record_job_process_root "$worker_pid"
registered=" $(job_tmp_process_pids | tr '\n' ' ') "
case "$registered" in
  *" $worker_pid "*) ;;
  *) exit 41 ;;
esac
terminate_job_tmp_processes TERM 2
if kill -0 "$worker_pid" 2>/dev/null; then exit 42; fi
`, { mode: 0o755 });

  try {
    const result = spawnSync("sh", [scriptPath], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(readFileSync(join(tempDir, "process-roots.tsv"), "utf8"), /^\d+\t\d+$/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runner persists managed-media and model-worker process roots", () => {
  const runner = source("scripts/builder-agent-runner.sh");

  assert.match(runner, /_managed_media_pid="\$!"\s*\n\s*record_job_process_root "\$_managed_media_pid" \|\| true/);
  assert.match(runner, /_slw_worker_pid="\$!"\s*\n\s*record_job_process_root "\$_slw_worker_pid" \|\| true/);
});

test("runner exposes strict account-scoped cloud host lifecycle controls", () => {
  const runner = source("scripts/builder-agent-runner.sh");

  assert.match(runner, /BUILDER_BLOG_CLOUD_HOST_CONTROL/);
  assert.match(runner, /mark-replaced\|stop-current/);
  assert.match(runner, /cloud_host_control_current_file/);
  assert.match(runner, /cloud-library-host\/current\.json/);
  assert.match(runner, /cloud-library-cron\/current\.json/);
  assert.match(runner, /processStartEpoch/);
  assert.match(runner, /verify_followbrief_current_pid/);
  assert.match(runner, /BUILDER_BLOG_STRICT_JOB_UPDATE/);
  assert.match(runner, /_target_update_code=0[\s\S]*job_run_update "\$@" \|\| _target_update_code=\$\?/);
  assert.match(runner, /parse_cloud_worker_release_result\(\) \{/);
  assert.match(runner, /release_cloud_worker_leases_for_instance\(\) \{/);
  assert.match(
    runner,
    /parse_cloud_worker_release_result\(\) \{[\s\S]*node - "\$_pcwrr_file"/,
  );
  assert.match(
    runner,
    /parse_cloud_worker_release_result\(\) \{[\s\S]*2147483647[\s\S]*JSON\.parse[\s\S]*Number\.isSafeInteger/,
  );
  assert.match(
    runner,
    /parse_cloud_worker_release_result\(\) \{[\s\S]*matchAll[\s\S]*releasedRuns[\s\S]*releasedSourceTasks[\s\S]*requeuedQueueItems/,
  );
  assert.match(
    runner,
    /parse_cloud_worker_release_result\(\) \{[\s\S]*REQUIRED_KEYS[\s\S]*Object\.keys\(parsed\)\.sort\(\)[\s\S]*outcomeKeyMatches/,
  );
  assert.match(
    runner,
    /release_cloud_worker_leases_for_instance\(\) \{[\s\S]*parse_cloud_worker_release_result "\$_rclfi_stdout"/,
  );
  assert.match(
    runner,
    /release_cloud_worker_leases_for_instance\(\) \{[\s\S]*release-cloud-fetch --job-run-id/,
  );
  assert.match(
    runner,
    /release_cloud_worker_leases_for_instance\(\) \{[\s\S]*release-cloud-fetch returned malformed response\./,
  );
  assert.match(
    runner,
    /parse_cloud_worker_release_result\(\) \{[\s\S]*releasedRuns[\s\S]*releasedSourceTasks[\s\S]*requeuedQueueItems/,
  );
  assert.match(
    runner,
    /cloud_host_control_current_file\(\) \{[\s\S]*verify_followbrief_current_pid[\s\S]*strict_job_run_update_for_instance[\s\S]*release_cloud_worker_leases_for_instance[\s\S]*clear_current_file/,
  );
  assert.match(
    runner,
    /if \[ "\$_chcc_update_code" -eq "\$JOB_UPDATE_RESET_FENCED" \]; then[\s\S]*clear_current_file "\$_chcc_file" "\$_chcc_instance"[\s\S]*return 0[\s\S]*fi[\s\S]*_chcc_release_code=0/,
  );
});

test("production app defaults use the FollowBrief domain", () => {
  const cli = source("scripts/builder-digest.mjs");
  const runner = source("scripts/builder-agent-runner.sh");
  const enrichment = source("src/lib/builder-enrichment.ts");

  assert.match(cli, /const DEFAULT_APP_URL = "https:\/\/followbrief\.worldstatelabs\.com"/);
  assert.match(runner, /APP_URL="\$\{BUILDER_BLOG_URL:-https:\/\/followbrief\.worldstatelabs\.com\}"/);
  assert.match(enrichment, /\+https:\/\/followbrief\.worldstatelabs\.com/);
  for (const path of [
    "scripts/builder-digest.mjs",
    "scripts/builder-agent-runner.sh",
    "src/lib/builder-enrichment.ts",
    "skills/builder-blog-digest/jobs/library-once.md",
    "skills/builder-blog-digest/jobs/library-cron-setup.md",
    "skills/builder-blog-digest/jobs/library-cron-stop.md",
    "skills/builder-blog-digest/jobs/digest-once.md",
    "skills/builder-blog-digest/jobs/digest-cron-setup.md",
    "skills/builder-blog-digest/jobs/digest-cron-stop.md",
    "skills/builder-blog-digest/jobs/cloud-library-cron-setup.md",
    "skills/builder-blog-digest/jobs/cloud-library-cron-stop.md",
    "README.md",
    "HANDOFF.md",
  ]) {
    assert.doesNotMatch(source(path), /builder-blog\.worldstatelabs\.com/, path);
  }
});

test("web status uses scheduled job instances while history can show one-time runs", () => {
  const fetchPanel = source("src/components/FetchLogPanel.tsx");
  const digestPanel = source("src/components/DigestLogPanel.tsx");
  const fetchRoute = source("src/app/api/skill/fetch-runs/route.ts");
  const digestRoute = source("src/app/api/digest-runs/route.ts");
  const agentJobRuns = source("src/lib/agent-job-runs.ts");
  const scheduledWindowUi = source("src/lib/scheduled-window-ui.ts");

  for (const panel of [fetchPanel, digestPanel]) {
    assert.match(panel, /AgentJobRunListItem/);
    assert.match(panel, /scheduledRunTriggerLabel/);
  }
  assert.match(scheduledWindowUi, /trigger === "scheduled"/);
  assert.match(scheduledWindowUi, /Scheduled/);
  assert.match(scheduledWindowUi, /Setup validation/);
  assert.match(scheduledWindowUi, /One-time/);
  assert.match(scheduledWindowUi, /Stalled/);
  assert.match(scheduledWindowUi, /timed_out|Timed out/);
  assert.doesNotMatch(fetchPanel, /Fetch sources run history/);
  assert.match(fetchPanel, /FetchLogDialog/);
  assert.match(digestPanel, /Build log/);
  assert.match(digestPanel, /DigestLogDialog/);
  assert.doesNotMatch(digestPanel, />\s*AI Brief build history\s*<\/h2>/);
  assert.doesNotMatch(digestPanel, /Build history/);

  assert.match(fetchRoute, /jobRuns/);
  assert.match(fetchRoute, /scheduledJobRuns/);
  assert.match(fetchRoute, /loadFetchRunHistoryAgentJobs/);
  assert.match(agentJobRuns, /agentJobRun\.findMany/);
  assert.match(digestRoute, /jobRuns/);
  assert.match(digestRoute, /scheduledJobRuns/);
  assert.match(digestRoute, /agentJobRun\.findMany/);
});

test("library runs that exit 65 with durably recorded partial failures report succeeded", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /library_partial_verdict_status\(\) \{/);
  assert.match(
    runner,
    /if \[ "\$_code" -eq 65 \]; then[\s\S]{0,200}library-cron\|library-once\)[\s\S]{0,120}library_partial_verdict_status "\$_code"/,
  );
  assert.match(
    runner,
    /job_run_update succeeded "Runtime completed; \$_partial_failure_count task\(s\) failed and are recorded in the fetch log\." "partial_task_failures" \\\n\s+--stage "completed" \\\n\s+--exit-code "\$_code"/,
  );
  assert.match(runner, /job_run_update failed "Runtime exited with code \$_code\." "runtime_finished" \\\n\s+--exit-code "\$_code"/);

  const cli = source("scripts/builder-digest.mjs");
  assert.match(cli, /expectedJobName !== "library-cron" && expectedJobName !== "library-once"/);
  assert.match(cli, /if \(outFile\) await writeSetupVerdictAtomically\(outFile, verdict\);/);
});
