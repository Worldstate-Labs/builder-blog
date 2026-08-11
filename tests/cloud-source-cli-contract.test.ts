import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const shellFunction = (text: string, name: string) => {
  const start = text.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing shell function ${name}`);
  const end = text.indexOf("\n}\n\n", start);
  assert.notEqual(end, -1, `missing end of shell function ${name}`);
  return text.slice(start, end + 3);
};

const markdownShellBlocks = (text: string) =>
  [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);

const regularLocalStopBlock = (text: string, job: string) => {
  const block = markdownShellBlocks(text).find(
    (candidate) => candidate.includes("legacy_account_slug()") && candidate.includes('launchd absent: $LABEL'),
  );
  assert.ok(block, `missing regular local launchd stop block for ${job}`);
  return block;
};

const cloudHostControlHarnessPrelude = (runner: string, dir: string) => `set -eu
JOB_STATE_DIR="${dir}/state"
mkdir -p "$JOB_STATE_DIR"
JOB_UPDATE_RESET_FENCED=78
${shellFunction(runner, "json_get_number")}
${shellFunction(runner, "json_get_string")}
${shellFunction(runner, "clear_current_file")}
${shellFunction(runner, "job_update_error_is_reset_fenced")}
${shellFunction(runner, "strict_job_run_update_for_instance")}
${shellFunction(runner, "verify_followbrief_current_pid")}
${shellFunction(runner, "parse_cloud_worker_release_result")}
release_cloud_worker_leases_for_instance() { return 0; }
${shellFunction(runner, "cloud_host_control_current_file")}
`;

test("cloud slice sync discards only explicit terminal lease conflicts", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const classifier = shellFunction(runner, "sync_error_is_obsolete_cloud_slice");
  const syncSlices = shellFunction(runner, "sync_payload_slices");
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-slice-conflicts-"));

  try {
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${classifier}
assert_obsolete() {
  printf '%s\\n' "$1" > "${dir}/error.log"
  sync_error_is_obsolete_cloud_slice "${dir}/error.log"
}
assert_retryable() {
  printf '%s\\n' "$1" > "${dir}/error.log"
  if sync_error_is_obsolete_cloud_slice "${dir}/error.log"; then
    exit 21
  fi
}
assert_obsolete 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"cloud_run_not_running","retryable":false}'
assert_obsolete 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"cloud_source_already_finalized","retryable":false}'
assert_retryable 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"reset_fenced","retryable":false}'
assert_retryable 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"cloud_source_result_incomplete","retryable":true}'
assert_retryable 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"cloud_source_finalize_race","retryable":true}'
assert_retryable 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":null,"syncCode":"network","responseCode":null,"retryable":null}'
assert_retryable 'HTTP POST failed with cloud_run_not_running but no structured marker'
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
    assert.match(
      syncSlices,
      /if sync_error_is_obsolete_cloud_slice "\$_slice_stderr"; then[\s\S]*append_task_ids_from_fetch_result "\$_slice_tasks" "\$_sps_synced_ids_file"[\s\S]*continue[\s\S]*fi[\s\S]*_sps_failures=/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assign-fetch-tasks stamps each cloud shard with its validated execution budget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-shard-budgets-"));
  try {
    const tasksFile = join(dir, "fetch-result.json");
    const outDir = join(dir, "shards");
    await writeFile(
      tasksFile,
      `${JSON.stringify({
        status: "ok",
        fetchTasks: [
          {
            id: "cloud-long",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_long",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "podcast",
            executionBudgetSeconds: 14_400,
            builderSync: { builderId: "b1", sourceUrl: "https://long.example/feed.xml" },
            item: { url: "https://long.example/posts/1" },
          },
          {
            id: "cloud-standard",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_standard",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "blog",
            executionBudgetSeconds: 3_600,
            builderSync: { builderId: "b2", sourceUrl: "https://standard.example/feed.xml" },
            item: { url: "https://standard.example/posts/1" },
          },
          {
            id: "cloud-invalid",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_invalid",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "blog",
            executionBudgetSeconds: 17_000,
            builderSync: { builderId: "b3", sourceUrl: "https://invalid.example/feed.xml" },
            item: { url: "https://invalid.example/posts/1" },
          },
        ],
      })}\n`,
      "utf8",
    );

    const result = await execFileAsync(
      process.execPath,
      [
        "scripts/builder-digest.mjs",
        "assign-fetch-tasks",
        "--tasks",
        tasksFile,
        "--out-dir",
        outDir,
        "--max-workers",
        "3",
      ],
      { cwd: process.cwd() },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.shards.length, 3);

    const shard0 = JSON.parse(await readFile(join(outDir, "shard-0.json"), "utf8"));
    const shard1 = JSON.parse(await readFile(join(outDir, "shard-1.json"), "utf8"));
    const shard2 = JSON.parse(await readFile(join(outDir, "shard-2.json"), "utf8"));

    assert.equal(shard0.fetchTasks.length, 1);
    assert.equal(shard1.fetchTasks.length, 1);
    assert.equal(shard2.fetchTasks.length, 1);
    assert.equal(shard0.executionBudgetSeconds, 14_400);
    assert.equal(shard1.executionBudgetSeconds, 3_600);
    assert.equal(shard2.executionBudgetSeconds, 3_600);
    assert.equal(shard0.fetchTasks[0].executionBudgetSeconds, 14_400);
    assert.equal(shard1.fetchTasks[0].executionBudgetSeconds, 3_600);
    assert.equal(shard2.fetchTasks[0].executionBudgetSeconds, 17_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("merge-task-results prefers shard budgets over the shared timeout fallback when backfilling cloud failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-shard-backfill-budget-"));
  try {
    const tasksFile = join(dir, "fetch-result.json");
    const resultsDir = join(dir, "results");
    const shardsDir = join(dir, "shards");
    const outFile = join(dir, "sync.json");
    const tasksOutFile = join(dir, "merged-fetch-result.json");
    await mkdir(resultsDir, { recursive: true });
    await mkdir(shardsDir, { recursive: true });
    await writeFile(
      tasksFile,
      `${JSON.stringify({
        status: "ok",
        fetchTasks: [
          {
            id: "cloud-long",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_long",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "podcast",
            executionBudgetSeconds: 14_400,
            builderSync: { builderId: "b1", sourceUrl: "https://long.example/feed.xml" },
            item: { url: "https://long.example/posts/1" },
          },
          {
            id: "cloud-fallback",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_fallback",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "blog",
            builderSync: { builderId: "b2", sourceUrl: "https://fallback.example/feed.xml" },
            item: { url: "https://fallback.example/posts/1" },
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(shardsDir, "shard-0.json"),
      `${JSON.stringify({
        status: "ok",
        shardIndex: 0,
        dynamicAssignment: true,
        workerId: "worker-0",
        executionBudgetSeconds: 14_400,
        fetchTasks: [
          {
            id: "cloud-long",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_long",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "podcast",
            executionBudgetSeconds: 14_400,
            workerId: "worker-0",
            builderSync: { builderId: "b1", sourceUrl: "https://long.example/feed.xml" },
            item: { url: "https://long.example/posts/1" },
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(shardsDir, "shard-1.json"),
      `${JSON.stringify({
        status: "ok",
        shardIndex: 1,
        dynamicAssignment: true,
        workerId: "worker-1",
        fetchTasks: [
          {
            id: "cloud-fallback",
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_fallback",
            agentWorkType: "fetch_post",
            contentStatus: "requires_agent",
            sourceType: "blog",
            workerId: "worker-1",
            builderSync: { builderId: "b2", sourceUrl: "https://fallback.example/feed.xml" },
            item: { url: "https://fallback.example/posts/1" },
          },
        ],
      })}\n`,
      "utf8",
    );

    await execFileAsync(
      process.execPath,
      [
        "scripts/builder-digest.mjs",
        "merge-task-results",
        "--tasks",
        tasksFile,
        "--results-dir",
        resultsDir,
        "--tasks-out",
        tasksOutFile,
        "--out",
        outFile,
        "--shard-timeout-seconds",
        "3600",
      ],
      { cwd: process.cwd(), env: { ...process.env, BUILDER_BLOG_DISABLE_WEB_SYNC: "1" } },
    );

    const merged = JSON.parse(await readFile(outFile, "utf8"));
    const outcomesById = new Map<string, {
      fetchTaskId: string;
      evidence?: { shardTimeoutSeconds?: number };
    }>(
      (Array.isArray(merged.taskOutcomes) ? merged.taskOutcomes : []).map((outcome: {
        fetchTaskId: string;
        evidence?: { shardTimeoutSeconds?: number };
      }) => [
        outcome.fetchTaskId,
        outcome,
      ]),
    );
    assert.equal(outcomesById.get("cloud-long")?.evidence?.shardTimeoutSeconds, 14_400);
    assert.equal(outcomesById.get("cloud-fallback")?.evidence?.shardTimeoutSeconds, 3_600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud fetch planning stamps leased task metadata onto normal fetch tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = cli.buildCloudFetchTaskForTest(
    {
      type: "fetch_post",
      contentStatus: "requires_agent",
      builder: "OpenAI News",
      builderId: "cloud_builder_zh",
      sourceType: "blog",
      builderSync: {
        builderId: "cloud_builder_zh",
        kind: "BLOG",
        sourceType: "blog",
        name: "OpenAI News",
        sourceUrl: "https://openai.com/news/rss.xml",
        fetchUrl: "https://openai.com/news/rss.xml",
      },
      item: {
        kind: "BLOG_POST",
        externalId: "openai-news-1",
        title: "OpenAI News",
        url: "https://openai.com/news/item",
      },
      summaryInstructions: { language: "en", prompt: "Write in English." },
      id: "fetch_post:cloud_builder_zh:BLOG_POST:openai-news-1",
    },
    {
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_1",
      summaryLanguage: "zh",
      mustSucceedBy: "2026-06-27T13:30:00.000Z",
      estimatedDurationSeconds: 4_200,
      provisionalExecutionBudgetSeconds: 6_900,
      executionBudgetSeconds: 7_200,
      workloadClass: "standard",
      budgetReason: "scaled_and_rounded",
      deadlineState: "at_risk",
      estimateEvidence: {
        backend: "faster_whisper",
        model: "large-v3",
        mediaDurationSeconds: 3_000,
      },
    },
  );

  assert.equal(task.cloudRunId, "cloud_run_1");
  assert.equal(task.cloudSourceTaskId, "cloud_task_1");
  assert.equal(task.summaryLanguage, "zh");
  assert.equal(task.mustSucceedBy, "2026-06-27T13:30:00.000Z");
  assert.equal(task.estimatedDurationSeconds, 4_200);
  assert.equal(task.provisionalExecutionBudgetSeconds, 6_900);
  assert.equal(task.executionBudgetSeconds, 7_200);
  assert.equal(task.workloadClass, "standard");
  assert.equal(task.budgetReason, "scaled_and_rounded");
  assert.equal(task.deadlineState, "at_risk");
  assert.equal(task.estimateEvidence.backend, "faster_whisper");
  assert.equal(task.estimateEvidence.model, "large-v3");
  assert.equal(task.estimateEvidence.mediaDurationSeconds, 3_000);
  assert.equal(task.builderSync.cloudSourceTaskId, "cloud_task_1");
  assert.equal(task.builderSync.builderId, "cloud_builder_zh");
  assert.equal(task.summaryInstructions.language, "zh");
  assert.match(task.summaryInstructions.prompt, /Chinese|zh|中文/);
  assert.equal(task.type, "fetch_post");
});

test("cloud fetch CLI contract keeps provisional execution plan metadata in both the lease map and planned tasks", async () => {
  const cliSource = await readFile("scripts/builder-digest.mjs", "utf8");

  for (const field of [
    "mustSucceedBy",
    "estimatedDurationSeconds",
    "provisionalExecutionBudgetSeconds",
  ]) {
    assert.match(
      cliSource,
      new RegExp(`cloudTaskMetadataByBuilderId\\.set\\(builder\\.id, \\{[\\s\\S]*${field}: task\\.${field}`),
    );
    assert.match(
      cliSource,
      new RegExp(
        `function buildCloudFetchTask\\(task, metadata\\) \\{[\\s\\S]*${field}:[\\s\\S]*metadata\\?\\.${field}[\\s\\S]*\\?\\?[\\s\\S]*task\\?\\.${field}`,
      ),
    );
  }

  for (const field of [
    "executionBudgetSeconds",
    "workloadClass",
    "budgetReason",
    "deadlineState",
    "estimateEvidence",
  ]) {
    assert.match(
      cliSource,
      new RegExp(`cloudTaskMetadataByBuilderId\\.set\\(builder\\.id, \\{[\\s\\S]*${field}: task\\.${field}`),
    );
    assert.match(
      cliSource,
      new RegExp(
        `function buildCloudFetchTask\\(task, metadata\\) \\{[\\s\\S]*${field}:[\\s\\S]*task\\?\\.${field}[\\s\\S]*\\?\\?[\\s\\S]*metadata\\?\\.${field}`,
      ),
    );
  }
});

test("cloud fetch command is exposed and keeps worker-facing task shape", async () => {
  const cliSource = await readFile("scripts/builder-digest.mjs", "utf8");
  const sharedBudgetSource = await readFile("scripts/cloud-shard-budget.mjs", "utf8");

  assert.match(cliSource, /fetch-cloud-library \[--limit 10\]/);
  assert.match(cliSource, /from "\.\/cloud-shard-budget\.mjs"/);
  assert.match(sharedBudgetSource, /export function normalizeCloudShardBudgetPolicy/);
  assert.match(sharedBudgetSource, /export function cloudShardExecutionBudget/);
  assert.match(sharedBudgetSource, /export function cloudDeadlineState/);
  assert.match(cliSource, /assign-fetch-tasks --tasks fetch-result\.json/);
  assert.match(cliSource, /merge-fetch-results --base fetch-result\.json/);
  assert.match(cliSource, /split-sync-slices --tasks fetch-result\.json[\s\S]*source\|task\|cloud-source\|cloud-run/);
  assert.match(cliSource, /heartbeat-cloud-fetch --cloud-run-id <id>/);
  assert.match(cliSource, /else if \(command === "fetch-cloud-library"\) await fetchCloudLibrary\(args\)/);
  assert.match(cliSource, /else if \(command === "assign-fetch-tasks"\) await assignFetchTasks\(args\)/);
  assert.match(cliSource, /else if \(command === "merge-fetch-results"\) await mergeFetchResultsCommand\(args\)/);
  assert.match(cliSource, /else if \(command === "heartbeat-cloud-fetch"\) await heartbeatCloudFetch\(args\)/);
  assert.match(cliSource, /buildFetchTasksForBuilders/);
  assert.match(cliSource, /applySharedPostReuseToFetchTasks/);
  assert.match(cliSource, /leasedCloudTaskFetchedItems/);
  assert.match(cliSource, /const cloudFetchedItems = \[\]/);
  assert.match(cliSource, /personalFetchedItems: force \? \[\] : cloudFetchedItems/);
  assert.match(cliSource, /taskOutcomes: planned\.taskOutcomes/);
  assert.doesNotMatch(cliSource, /user private-library builders are selected by cloud command/);
});

test("shared cloud budget module is shipped through the skill file and bootstrap surfaces", async () => {
  const fileRoute = await readFile("src/app/api/skill/files/[file]/route.ts", "utf8");
  const skillFiles = await readFile("src/lib/agent-skill-files.ts", "utf8");
  const bundleRoute = await readFile("src/app/api/skill/bundle/route.ts", "utf8");
  const bootstrapRoute = await readFile("src/app/api/skill/bootstrap/route.ts", "utf8");
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(fileRoute, /readAgentSkillFile/);
  assert.match(skillFiles, /"cloud-shard-budget\.mjs"/);
  assert.match(skillFiles, /sourcePath: "scripts\/cloud-shard-budget\.mjs"/);
  assert.match(skillFiles, /target: "cloud-shard-budget\.mjs"/);
  assert.match(bundleRoute, /buildAgentSkillBundle/);
  assert.match(bootstrapRoute, /api\/skill\/bundle/);
  assert.match(runner, /api\/skill\/bundle/);
});

test("cloud library runner reuses the library worker pipeline with cloud fetch and sync commands", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const skillFiles = await readFile("src/lib/agent-skill-files.ts", "utf8");

  assert.match(runner, /cloud-library-cron/);
  assert.match(runner, /fetch-cloud-library/);
  assert.match(runner, /sync-cloud-builders/);
  assert.match(runner, /PROMPT_FILE="\$AGENT_DIR\/jobs\/library-worker\.md"/);
  assert.match(runner, /BUILDER_BLOG_CLOUD_FETCH_LIMIT/);
  assert.match(runner, /cloud_fetch_source_limit\(\)/);
  assert.match(runner, /_cloud_fetch_source_limit="\$\(cloud_fetch_source_limit\)"/);
  assert.match(runner, /--limit "\$_cloud_fetch_source_limit"/);
  assert.match(runner, /assign_dynamic_fetch_workers\(\)/);
  assert.match(runner, /assign-fetch-tasks/);
  assert.match(runner, /fetch_more_cloud_sources\(\)/);
  assert.match(runner, /BUILDER_BLOG_CLOUD_REFILL_LIMIT:-100/);
  assert.match(runner, /_crl_value=100/);
  assert.match(runner, /_crl_value" -gt 1000/);
  assert.match(runner, /merge-fetch-results/);
  assert.match(runner, /patch-cloud-fetch-plan/);
  assert.match(runner, /SYNC_PAYLOAD_SLICE_GRANULARITY="cloud-source"/);
  assert.match(
    runner,
    /sync_completed_checkpoints\(\) \{[\s\S]*if \[ "\$\{SYNC_BUILDERS_COMMAND:-\}" = "sync-cloud-builders" \]; then[\s\S]*SYNC_PAYLOAD_SLICE_GRANULARITY="cloud-source"[\s\S]*else[\s\S]*SYNC_PAYLOAD_SLICE_GRANULARITY="task"[\s\S]*sync_payload_slices "\$_scc_tasks" "\$_scc_payload"/,
  );
  assert.match(
    runner,
    /sync_completed_checkpoints\(\) \{[\s\S]*if \[ "\$_scc_had_granularity" -eq 1 \]; then[\s\S]*SYNC_PAYLOAD_SLICE_GRANULARITY="\$_scc_previous_granularity"[\s\S]*else[\s\S]*unset SYNC_PAYLOAD_SLICE_GRANULARITY/,
  );
  assert.match(runner, /cloud_fetch_heartbeat_all\(\)/);
  assert.match(runner, /_assigned_fetch_task_ids_file="\$JOB_TMP_DIR\/assigned-fetch-task-ids\.txt"/);
  assert.match(runner, /_active_fetch_group_keys_file="\$JOB_TMP_DIR\/active-fetch-group-keys\.txt"/);
  assert.match(runner, /sync_cloud_terminal_outcomes\(\)/);
  assert.match(runner, /sync_cloud_terminal_outcomes "\$_result_file" "\$_cloud_run_id"/);
  assert.match(runner, /sync_cloud_terminal_outcomes "\$_fmcs_file" "\$_fmcs_run_id"/);
  assert.match(runner, /for _wafg_entry in \$\{_worker_entries:-\}/);
  assert.match(runner, /shard_timeout_seconds_for_file\(\)/);
  assert.match(runner, /set_initial_worker_window_deadline\(\)/);
  assert.match(runner, /current_outer_deadline_epoch_seconds\(\)/);
  assert.match(runner, /_slw_worker_pid="\$!"[\s\S]*_worker_entries="\$\{_worker_entries:-\} \$_slw_worker_pid:\$\(date \+%s\):\$_slw_shard_name:\$_slw_lane_id"/);
  assert.doesNotMatch(runner, /_worker_entries=.*_slw_shard_file/);
  assert.match(runner, /for _entry in \$\{_worker_entries:-\}/);
  assert.match(runner, /case " \$\{_timed_out_worker_pids:-\} " in/);
  assert.match(runner, />> "\$_results_dir\/\$_name-worker\.log"/);
  assert.match(runner, /start_pending_library_workers/);
  assert.match(runner, /cloud_fetch_heartbeat/);
  assert.match(runner, /heartbeat-cloud-fetch --cloud-run-id/);
  assert.match(runner, /cloud-library-host/);
  assert.match(runner, /run_cloud_worker_host\(\)/);
  assert.match(runner, /cloud_host_sleep_with_heartbeat/);
  assert.match(runner, /BUILDER_BLOG_CLOUD_PERSISTENT_HOST=1/);
  assert.match(runner, /run_library_job fetch-cloud-library sync-cloud-builders cloud-fetch-result\.json "cloud library host"/);
  assert.match(skillFiles, /"builder-blog-cloud-library-host\.md"/);
  assert.match(skillFiles, /target: "jobs\/cloud-library-host\.md"/);
  assert.doesNotMatch(runner, /BUILDER_BLOG_CLOUD_HOST_CHILD/);
});

test("cloud library runner emits bounded summaries instead of full fetch and assignment artifacts", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /print_compact_json_artifact_summary\(\)/);
  assert.match(runner, /print_compact_json_artifact_summary "fetch_sources" "\$_result_file"/);
  assert.match(runner, /print_compact_json_artifact_summary "expand_discovery" "\$_nlfb_file"/);
  assert.match(
    runner,
    /phase=assign_fetch_tasks status=%s round=%s assignedWorkers=%s pendingWork=%s artifact=%s\\n/,
  );
  assert.doesNotMatch(runner, /cat "\$_result_file"/);
  assert.doesNotMatch(runner, /cat "\$_adfw_out"/);
});

test("cloud-library-cron fixes the worker window deadline after planning so the initial 4h shard gets the full buffer", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("timeout_seconds_for_job() {");
  const end = runner.indexOf("\nrun_library_job() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-worker-window-"));
  try {
    const fakeBin = join(dir, "bin");
    const agentDir = join(dir, "agent");
    const tmpDir = join(dir, "tmp");
    const shardPath = join(dir, "shard.json");
    await mkdir(fakeBin, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(agentDir, "local-agent-timeouts.json"),
      JSON.stringify({
        defaultIntervalMinutes: 60,
        baseMultiplierSecondsPerMinute: 48,
        minSeconds: 1200,
        defaultMaxSeconds: 2700,
        jobDefaultSeconds: {
          "cloud-library-cron": 15_300,
        },
        jobMaxSeconds: {
          "cloud-library-cron": 15_300,
          "cloud-library-host": 7_200,
        },
        shardFraction: {
          numerator: 3,
          denominator: 4,
        },
      }),
      "utf8",
    );
    await writeFile(
      shardPath,
      JSON.stringify({
        executionBudgetSeconds: 14_400,
        cloudRunId: "run_1",
        cloudSourceTaskId: "source_1",
        fetchTasks: [
          {
            id: "cloud-1",
            executionBudgetSeconds: 14_400,
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_1",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(fakeBin, "date"),
      `#!/bin/sh
if [ "$1" = "+%s" ]; then
  printf '%s\\n' "\${FAKE_NOW:?}"
  exit 0
fi
exec /bin/date "$@"
`,
      "utf8",
    );
    await execFileAsync("chmod", ["+x", join(fakeBin, "date")]);

    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
JOB_NAME=cloud-library-cron
AGENT_DIR="${agentDir}"
JOB_TMP_DIR="${tmpDir}"
RESOLVED_INTERVAL_MINUTES=60
_sync_command=sync-cloud-builders
_cloud_persistent_host=0
_run_started_epoch_seconds=0
${runner.slice(start, end)}
_whole_timeout="$(job_timeout_seconds)"
_shard_timeout="$(shard_timeout_seconds "$_whole_timeout")"
before="$(current_outer_deadline_epoch_seconds)"
export FAKE_NOW=1000
set_initial_worker_window_deadline
after="$(current_outer_deadline_epoch_seconds)"
reset_cloud_refill_window
stop_at_first="$_cloud_refill_stop_at"
fit_initial=0
if worker_fits_remaining_outer_window "${shardPath}"; then
  fit_initial=1
fi
export FAKE_NOW=1001
fit_late=0
if worker_fits_remaining_outer_window "${shardPath}"; then
  fit_late=1
fi
reset_cloud_refill_window
stop_at_second="$_cloud_refill_stop_at"
deadline_file="$(worker_window_deadline_epoch_file)"
deadline_value="$(cat "$deadline_file")"
[ "$before" = "15300" ] || exit 11
[ "$after" = "16300" ] || exit 12
[ "$deadline_value" = "16300" ] || exit 13
[ "$fit_initial" = "1" ] || exit 14
[ "$fit_late" = "0" ] || exit 15
[ "$stop_at_first" = "15400" ] || exit 16
[ "$stop_at_second" = "15400" ] || exit 17
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud fetch plan patch payload groups cloud tasks by source and ignores personal tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.buildCloudFetchPlanPatchPayloadForTest({
    cloudRunId: "cloud_run_1",
    fetchTasks: [
      {
        id: "cloud_post_1",
        workerId: "worker-0",
        cloudSourceTaskId: "source_a",
        estimatedWorkSeconds: 4_200,
        executionBudgetSeconds: 6_900,
        workloadClass: "standard",
        budgetReason: "scaled_and_rounded",
        deadlineState: "at_risk",
        mustSucceedBy: "2026-07-19T13:30:00.000Z",
        mediaDurationSeconds: 2_700,
        captionAvailability: "usable_captions",
        plannedExtractionMethod: "captions",
        estimateEvidence: { backend: "fallback", mediaDurationSeconds: 2_700 },
        item: {
          title: "A planned podcast episode",
          url: "https://example.com/podcast/one",
        },
      },
      {
        id: "cloud_post_2",
        builderId: "personal_only",
        estimatedWorkSeconds: 600,
        executionBudgetSeconds: 3_600,
        workloadClass: "standard",
        budgetReason: "minimum_budget",
        deadlineState: "on_time",
      },
    ],
    taskOutcomes: [
      {
        fetchTaskId: "cloud_post_3",
        plannedTask: {
          id: "cloud_post_3",
          cloudSourceTaskId: "source_a",
          estimatedWorkSeconds: 8_000,
          executionBudgetSeconds: 14_400,
          workloadClass: "long_media",
          budgetReason: "capped_long_media_maximum",
          deadlineState: "missed",
          estimateEvidence: { backend: "faster_whisper", mediaDurationSeconds: 19_800 },
        },
      },
    ],
  });

  assert.deepEqual(payload, {
    runId: "cloud_run_1",
    plans: [
      {
        cloudSourceTaskId: "source_a",
        posts: [
          {
            postTaskId: "cloud_post_1",
            title: "A planned podcast episode",
            url: "https://example.com/podcast/one",
            workerId: "worker-0",
            estimatedWorkSeconds: 4_200,
            executionBudgetSeconds: 6_900,
            workloadClass: "standard",
            budgetReason: "scaled_and_rounded",
            deadlineState: "at_risk",
            mustSucceedBy: "2026-07-19T13:30:00.000Z",
            mediaDurationSeconds: 2_700,
            captionAvailability: "usable_captions",
            plannedExtractionMethod: "captions",
            estimateEvidence: { backend: "fallback", mediaDurationSeconds: 2_700 },
          },
          {
            postTaskId: "cloud_post_3",
            estimatedWorkSeconds: 8_000,
            executionBudgetSeconds: 14_400,
            workloadClass: "long_media",
            budgetReason: "capped_long_media_maximum",
            deadlineState: "missed",
            estimateEvidence: { backend: "faster_whisper", mediaDurationSeconds: 19_800 },
          },
        ],
      },
    ],
  });
});

test("cloud fetch plan patch payload safely skips missing cloud plan context", async () => {
  const cli = await import("../scripts/builder-digest.mjs");

  assert.equal(cli.buildCloudFetchPlanPatchPayloadForTest({ fetchTasks: [], taskOutcomes: [] }), null);
  assert.equal(
    cli.buildCloudFetchPlanPatchPayloadForTest({
      cloudRunId: "cloud_run_1",
      fetchTasks: [{ id: "personal", estimatedWorkSeconds: 100 }],
      taskOutcomes: [],
    }),
    null,
  );
});

test("cloud fetch plan patch command retries bounded failures instead of silent best-effort", async () => {
  const cliSource = await readFile("scripts/builder-digest.mjs", "utf8");

  assert.match(
    cliSource,
    /label: "cloud fetch plan patch",[\s\S]*retries: 2/,
  );
  assert.match(cliSource, /throw error;/);
});

test("cloud library runner reports cloud plan patch failures instead of swallowing them silently", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("patch_current_fetch_plans() {");
  const end = runner.indexOf("\nlibrary_worker_was_started() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const patchFunction = runner.slice(start, end);

  assert.match(runner, /patch_current_fetch_plans\(\)/);
  assert.match(runner, /cloud_plan_patch_failed/);
  assert.match(runner, /Failed to patch cloud execution plans/);
  assert.doesNotMatch(
    patchFunction,
    /patch-cloud-fetch-plan[\s\S]*\|\| true/,
  );
});

test("cloud planned-only outcome sync detects valid work and preserves failure codes", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf("\ncloud_run_id_from_result() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-planned-only-helper-"));
  try {
    const valid = join(dir, "valid.json");
    const empty = join(dir, "empty.json");
    const zeroPostLease = join(dir, "zero-post-lease.json");
    const malformedZeroPostLease = join(dir, "malformed-zero-post-lease.json");
    const discoveryOnly = join(dir, "discovery-only.json");
    const mixedBatch = join(dir, "mixed-batch.json");
    const missingPlannedId = join(dir, "missing-planned-id.json");
    const missingOutcomeId = join(dir, "missing-outcome-id.json");
    const mismatchedId = join(dir, "mismatched-id.json");
    const validSibling = join(dir, "valid-sibling.json");
    const invalid = join(dir, "invalid.json");
    const syncLog = join(dir, "sync.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(valid, JSON.stringify({
      cloudRunId: "cloud_run_1",
      fetchTasks: [{ id: "discovery_fallback", agentWorkType: "candidate_discovery_fallback" }],
      taskOutcomes: [{
        fetchTaskId: "task_failed",
        status: "failed",
        reason: "workload_exceeds_max_budget",
        plannedTask: { id: "task_failed", cloudSourceTaskId: "source_1" },
      }],
    }));
    await writeFile(empty, JSON.stringify({ cloudRunId: "cloud_run_2", fetchTasks: [], taskOutcomes: [] }));
    await writeFile(zeroPostLease, JSON.stringify({
      cloudRunId: "cloud_run_zero",
      fetchTasks: [],
      taskOutcomes: [],
      cloudSourceTasks: [
        { cloudRunId: "cloud_run_zero", cloudSourceTaskId: "source_zero", builderId: "builder_zero" },
      ],
    }));
    await writeFile(malformedZeroPostLease, JSON.stringify({
      cloudRunId: "cloud_run_malformed",
      fetchTasks: null,
      taskOutcomes: [],
      cloudSourceTasks: [
        { cloudRunId: "cloud_run_malformed", cloudSourceTaskId: "source_malformed", builderId: "builder_malformed" },
      ],
    }));
    await writeFile(discoveryOnly, JSON.stringify({
      cloudRunId: "cloud_run_discovery",
      fetchTasks: [{ id: "discover_1", agentWorkType: "candidate_discovery_fallback" }],
      taskOutcomes: [],
      cloudSourceTasks: [
        { cloudRunId: "cloud_run_discovery", cloudSourceTaskId: "source_discovery", builderId: "builder_discovery" },
      ],
    }));
    await writeFile(mixedBatch, JSON.stringify({
      cloudRunId: "cloud_run_mixed",
      fetchTasks: [{ id: "fetch_1", agentWorkType: "fetch_post", cloudSourceTaskId: "source_mixed" }],
      taskOutcomes: [],
      cloudSourceTasks: [
        { cloudRunId: "cloud_run_mixed", cloudSourceTaskId: "source_mixed", builderId: "builder_mixed" },
      ],
    }));
    await writeFile(missingPlannedId, JSON.stringify({
      cloudRunId: "cloud_run_3",
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "task_failed",
        status: "failed",
        plannedTask: { cloudSourceTaskId: "source_1" },
      }],
    }));
    await writeFile(missingOutcomeId, JSON.stringify({
      cloudRunId: "cloud_run_4",
      fetchTasks: [],
      taskOutcomes: [{
        status: "failed",
        plannedTask: { id: "task_failed", cloudSourceTaskId: "source_1" },
      }],
    }));
    await writeFile(mismatchedId, JSON.stringify({
      cloudRunId: "cloud_run_5",
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "task_outcome",
        status: "failed",
        plannedTask: { id: "task_planned", cloudSourceTaskId: "source_1" },
      }],
    }));
    await writeFile(validSibling, JSON.stringify({
      cloudRunId: "cloud_run_6",
      fetchTasks: [],
      taskOutcomes: [
        {
          fetchTaskId: "task_outcome",
          status: "failed",
          plannedTask: { id: "task_planned", cloudSourceTaskId: "source_1" },
        },
        {
          fetchTaskId: "task_valid",
          status: "failed",
          plannedTask: { id: "task_valid", cloudSourceTaskId: "source_2" },
        },
      ],
    }));
    await writeFile(invalid, "{");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
_sync_command=sync-cloud-builders
AGENT_DIR="${dir}"
SYNC_LOG="${syncLog}"
SYNC_EXIT_CODE=0
: > "$SYNC_LOG"
append_cloud_run_id() { :; }
cloud_fetch_heartbeat() { :; }
node() {
  if [ "$1" = "-" ]; then command node "$@"; return "$?"; fi
  printf '%s\\n' "$*" >> "$SYNC_LOG"
  return "$SYNC_EXIT_CODE"
}
sync_cloud_terminal_outcomes "${valid}" cloud_run_1
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "1" ] || exit 21
sync_cloud_terminal_outcomes "${empty}" cloud_run_2
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "1" ] || exit 22
sync_cloud_terminal_outcomes "${zeroPostLease}" cloud_run_zero
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 31
sync_cloud_terminal_outcomes "${malformedZeroPostLease}" cloud_run_malformed
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 34
sync_cloud_terminal_outcomes "${discoveryOnly}" cloud_run_discovery
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 32
sync_cloud_terminal_outcomes "${mixedBatch}" cloud_run_mixed
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 33
sync_cloud_terminal_outcomes "${missingPlannedId}" cloud_run_3
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 27
sync_cloud_terminal_outcomes "${missingOutcomeId}" cloud_run_4
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 28
sync_cloud_terminal_outcomes "${mismatchedId}" cloud_run_5
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "2" ] || exit 29
sync_cloud_terminal_outcomes "${validSibling}" cloud_run_6
[ "$(grep -c 'sync-cloud-builders' "${syncLog}")" = "3" ] || exit 30
if sync_cloud_terminal_outcomes "${invalid}" cloud_run_3; then exit 23; else code="$?"; fi
[ "$code" = "2" ] || exit 24
SYNC_EXIT_CODE=17
if sync_cloud_terminal_outcomes "${valid}" cloud_run_1; then exit 25; else code="$?"; fi
[ "$code" = "17" ] || exit 26
`,
      "utf8",
    );
    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("personal planned-only outcome sync preserves runner-owned ASR blockers", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf("\nsync_cloud_terminal_outcomes() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-personal-planned-only-helper-"));
  try {
    const valid = join(dir, "valid.json");
    const empty = join(dir, "empty.json");
    const invalid = join(dir, "invalid.json");
    const syncLog = join(dir, "sync.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(valid, JSON.stringify({
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "podcast_task",
        status: "blocked",
        reason: "asr_capability_missing",
        plannedTask: {
          id: "podcast_task",
          builderId: "builder_podcast",
          sourceType: "podcast",
          item: { title: "Episode", url: "https://example.com/episode" },
        },
      }],
    }));
    await writeFile(empty, JSON.stringify({ fetchTasks: [], taskOutcomes: [] }));
    await writeFile(invalid, "{");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
_sync_command=sync-builders
AGENT_DIR="${dir}"
SYNC_LOG="${syncLog}"
SYNC_EXIT_CODE=0
: > "$SYNC_LOG"
node() {
  if [ "$1" = "-" ]; then command node "$@"; return "$?"; fi
  printf '%s\n' "$*" >> "$SYNC_LOG"
  return "$SYNC_EXIT_CODE"
}
sync_personal_terminal_outcomes "${valid}"
[ "$(grep -c 'sync-builders' "${syncLog}")" = "1" ] || exit 21
sync_personal_terminal_outcomes "${empty}"
[ "$(grep -c 'sync-builders' "${syncLog}")" = "1" ] || exit 22
if sync_personal_terminal_outcomes "${invalid}"; then exit 23; else code="$?"; fi
[ "$code" = "2" ] || exit 24
SYNC_EXIT_CODE=17
if sync_personal_terminal_outcomes "${valid}"; then exit 25; else code="$?"; fi
[ "$code" = "17" ] || exit 26
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
    assert.match(
      runner,
      /if sync_personal_terminal_outcomes "\$_result_file"; then[\s\S]*sync_cloud_terminal_outcomes "\$_result_file" "\$_cloud_run_id"/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("library interruption helper returns 2 without a fetch plan and does not start sync work", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("flush_library_interrupted_results() {");
  const end = runner.indexOf("\nfinalize_library_timeout_results() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-interrupted-helper-no-plan-"));
  try {
    const logPath = join(dir, "calls.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
CALL_LOG="${logPath}"
${runner.slice(start, end)}
sync_completed_checkpoints() { printf 'checkpoint\\n' >> "$CALL_LOG"; }
flush_remaining_library_results() { printf 'flush\\n' >> "$CALL_LOG"; return 0; }
JOB_TMP_DIR="${dir}"
mkdir -p "$JOB_TMP_DIR"
if flush_library_interrupted_results runtime-interrupted runtime_interrupted; then
  exit 21
else
  code="$?"
fi
[ "$code" = "2" ] || exit 22
[ ! -e "$JOB_TMP_DIR/completed-checkpoint-synced-task-ids.txt" ] || exit 23
[ ! -d "$JOB_TMP_DIR/shards/results" ] || exit 24
[ ! -e "$CALL_LOG" ] || [ ! -s "$CALL_LOG" ]
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("timeout finalization still checkpoint-syncs before the remaining flush and preserves timeout labels", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const helperStart = runner.indexOf("flush_library_interrupted_results() {");
  const helperEnd = runner.indexOf("\nfinalize_library_timeout_results() {", helperStart);
  const timeoutStart = runner.indexOf("finalize_library_timeout_results() {");
  const timeoutEnd = runner.indexOf("\nrun_with_job_tracking() {", timeoutStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  assert.notEqual(timeoutStart, -1);
  assert.notEqual(timeoutEnd, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-timeout-finalizer-"));
  try {
    const logPath = join(dir, "calls.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      join(dir, "library-fetch-result.json"),
      JSON.stringify({ status: "ok", fetchTasks: [{ id: "task-a" }] }),
      "utf8",
    );
    await writeFile(
      checkPath,
      `set -eu
CALL_LOG="${logPath}"
${runner.slice(helperStart, helperEnd)}
${runner.slice(timeoutStart, timeoutEnd)}
job_run_update() { printf 'update|%s|%s|%s|%s\\n' "$1" "$2" "$3" "\${*:4}" >> "$CALL_LOG"; }
sync_completed_checkpoints() { printf 'checkpoint|%s|%s|%s\\n' "$1" "$2" "$3" >> "$CALL_LOG"; }
flush_remaining_library_results() { printf 'flush|%s|%s|%s|%s|%s|%s\\n' "$1" "$2" "$3" "$4" "$5" "$6" >> "$CALL_LOG"; return 0; }
job_timeout_seconds() { printf '7200\\n'; }
shard_timeout_seconds() { printf '3600\\n'; }
JOB_NAME=library-cron
JOB_TMP_DIR="${dir}"
mkdir -p "$JOB_TMP_DIR/shards/results"
finalize_library_timeout_results
[ -e "$JOB_TMP_DIR/completed-checkpoint-synced-task-ids.txt" ] || exit 21
started_line="$(grep -n 'runtime_timeout_flush_started' "$CALL_LOG" | cut -d: -f1)"
checkpoint_line="$(grep -n '^checkpoint|' "$CALL_LOG" | cut -d: -f1)"
flush_line="$(grep -n '^flush|' "$CALL_LOG" | cut -d: -f1)"
finished_line="$(grep -n 'runtime_timeout_flush_finished' "$CALL_LOG" | cut -d: -f1)"
[ -n "$started_line" ] && [ -n "$checkpoint_line" ] && [ -n "$flush_line" ] && [ -n "$finished_line" ] || exit 22
[ "$started_line" -lt "$checkpoint_line" ] || exit 23
[ "$checkpoint_line" -lt "$flush_line" ] || exit 24
[ "$flush_line" -lt "$finished_line" ] || exit 25
grep '^flush|.*/library-fetch-result.json|.*/shards/results|.*/completed-checkpoint-synced-task-ids.txt|3600|runtime-timeout|runtime_timeout$' "$CALL_LOG" >/dev/null || exit 26
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("library signal cleanup clears the current marker before updates and cannot re-enter", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const helperStart = runner.indexOf("flush_library_interrupted_results() {");
  const helperEnd = runner.indexOf("\nfinalize_library_timeout_results() {", helperStart);
  const cleanupStart = runner.indexOf("tracked_job_signal_cleanup() {");
  const cleanupEnd = runner.indexOf("\naggregate_runtime_usage_files() {", cleanupStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-interrupted-cleanup-"));
  try {
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(helperStart, helperEnd)}
TRACKED_JOB_FINALIZED=0
${runner.slice(cleanupStart, cleanupEnd)}
run_case() {
  FLUSH_CODE="$1"
  EXPECT_SECOND_REASON="$2"
  CASE_LOG="${dir}/case-$1.log"
  CURRENT_FILE="${dir}/current-$1.json"
  CLEAR_MARKER="${dir}/clear-$1.marker"
  printf '{"instanceId":"run-$1"}\\n' > "$CURRENT_FILE"
  terminate_process_tree() { printf 'terminate\\n' >> "$CASE_LOG"; return 0; }
  terminate_job_tmp_processes() { printf 'tmp-stop\\n' >> "$CASE_LOG"; return 0; }
  aggregate_runtime_usage_files() { printf 'aggregate\\n' >> "$CASE_LOG"; return 0; }
  job_run_update() { printf 'update|%s|%s|%s|%s\\n' "$1" "$2" "$3" "\${*:4}" >> "$CASE_LOG"; return 0; }
  cleanup_job_tmp_dir() { printf 'cleanup|%s|%s\\n' "$1" "$2" >> "$CASE_LOG"; return 0; }
  clear_current_file() {
    rm -f "$1"
    printf 'clear\\n' >> "$CASE_LOG"
    : > "$CLEAR_MARKER"
    sleep 1
    printf 'clear-resume\\n' >> "$CASE_LOG"
  }
  flush_library_interrupted_results() {
    [ "$1" = "runtime-interrupted" ] || exit 41
    [ "$2" = "runtime_interrupted" ] || exit 42
    [ ! -e "$CURRENT_FILE" ] || exit 43
    printf 'finalizer|%s|%s\\n' "$1" "$2" >> "$CASE_LOG"
    return "$FLUSH_CODE"
  }
  JOB_NAME=library-cron
  BUILDER_BLOG_CURRENT_FILE="$CURRENT_FILE"
  BUILDER_BLOG_JOB_RUN_ID="run-$1"
  TRACKED_JOB_FINALIZED=0
  ( tracked_job_signal_cleanup TERM ) &
  cleanup_pid="$!"
  _wait_count=0
  while [ ! -e "$CLEAR_MARKER" ]; do
    _wait_count=$(( _wait_count + 1 ))
    [ "$_wait_count" -lt 50 ] || exit 44
    sleep 0.1
  done
  kill -TERM "$cleanup_pid"
  kill -INT "$cleanup_pid"
  if wait "$cleanup_pid"; then
    exit 45
  else
    code="$?"
  fi
  [ "$code" = "130" ] || exit 45
  clear_line="$(grep -n '^clear$' "$CASE_LOG" | cut -d: -f1)"
  update_line="$(grep -n '^update|killed|Runtime interrupted before normal cleanup completed\\.|runner_interrupted|' "$CASE_LOG" | cut -d: -f1)"
  [ -n "$clear_line" ] && [ -n "$update_line" ] && [ "$clear_line" -lt "$update_line" ] || exit 46
  [ "$(grep -c '^clear$' "$CASE_LOG")" = "1" ] || exit 47
  [ "$(grep -c '^clear-resume$' "$CASE_LOG")" = "1" ] || exit 48
  [ "$(grep -c '^update|killed|Runtime interrupted before normal cleanup completed\\.|runner_interrupted|' "$CASE_LOG")" = "1" ] || exit 49
  grep '^finalizer|runtime-interrupted|runtime_interrupted$' "$CASE_LOG" >/dev/null || exit 50
  [ "$(grep -c '^finalizer|' "$CASE_LOG")" = "1" ] || exit 51
  [ "$(grep -c '^cleanup|' "$CASE_LOG")" = "1" ] || exit 52
  case "$EXPECT_SECOND_REASON" in
    none)
      [ "$(grep -c 'runner_interrupted_flush_' "$CASE_LOG" || true)" = "0" ] || exit 53
      ;;
    *)
      [ "$(grep -c "^update|killed|.*|$EXPECT_SECOND_REASON|" "$CASE_LOG")" = "1" ] || exit 54
      ;;
  esac
}
run_case 0 runner_interrupted_flush_finished
run_case 2 none
run_case 17 runner_interrupted_flush_failed
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("digest signal cleanup keeps runner_interrupted and does not invoke the library finalizer", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const cleanupStart = runner.indexOf("tracked_job_signal_cleanup() {");
  const cleanupEnd = runner.indexOf("\naggregate_runtime_usage_files() {", cleanupStart);
  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-digest-interrupted-cleanup-"));
  try {
    const logPath = join(dir, "calls.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
TRACKED_JOB_FINALIZED=0
${runner.slice(cleanupStart, cleanupEnd)}
terminate_process_tree() { :; }
terminate_job_tmp_processes() { :; }
aggregate_runtime_usage_files() { :; }
job_run_update() { printf 'update|%s|%s|%s|%s\\n' "$1" "$2" "$3" "\${*:4}" >> "${logPath}"; return 0; }
cleanup_job_tmp_dir() { printf 'cleanup|%s|%s\\n' "$1" "$2" >> "${logPath}"; return 0; }
clear_current_file() { printf 'clear\\n' >> "${logPath}"; }
flush_library_interrupted_results() { printf 'finalizer\\n' >> "${logPath}"; return 0; }
JOB_NAME=digest-cron
BUILDER_BLOG_CURRENT_FILE="${join(dir, "current.json")}"
BUILDER_BLOG_JOB_RUN_ID="digest-run"
TRACKED_JOB_FINALIZED=0
if ( tracked_job_signal_cleanup INT ); then
  exit 21
else
  code="$?"
fi
[ "$code" = "130" ] || exit 22
grep '^update|killed|Runtime interrupted before normal cleanup completed\\.|runner_interrupted|' "${logPath}" >/dev/null || exit 23
grep '^cleanup|killed|runner_interrupted$' "${logPath}" >/dev/null || exit 24
[ "$(grep -c '^finalizer$' "${logPath}" || true)" = "0" ] || exit 25
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud library runner syncs discovery-failed zero-task outcomes once before returning no_update", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf('\nif [ "$IS_CRON_JOB" = 1 ]', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-zero-task-sync-"));
  try {
    const checkPath = join(dir, "check.sh");
    const syncLog = join(dir, "sync.log");
    const updatesLog = join(dir, "updates.log");
    const fakeResult = JSON.stringify({
      cloudRunId: "cloud_run_1",
      fetchTasks: [],
      taskOutcomes: [
        {
          fetchTaskId: "task_failed",
          status: "failed",
          reason: "workload_exceeds_max_budget",
          plannedTask: {
            id: "task_failed",
            cloudRunId: "cloud_run_1",
            cloudSourceTaskId: "source_1",
          },
        },
      ],
    });
    await writeFile(
      checkPath,
      `set -eu
SYNC_LOG="${syncLog}"
UPDATES_LOG="${updatesLog}"
${runner.slice(start, end)}
job_timeout_seconds() { printf '7200\\n'; }
shard_timeout_seconds() { printf '3600\\n'; }
cloud_refill_limit() { printf '100\\n'; }
cloud_fetch_source_limit() { printf '10\\n'; }
run_openclaw_library_preflight() { return 0; }
job_run_update() { printf '%s\\n' "$*" >> "$UPDATES_LOG"; }
cloud_run_id_from_result() { printf 'cloud_run_1\\n'; }
append_cloud_run_id() { :; }
cloud_fetch_heartbeat() { :; }
library_has_discovery_tasks() { return 1; }
normalize_library_fetch_batch() { _discovery_failed=1; }
library_fetch_task_count() { printf '0\\n'; }
patch_current_fetch_plans() { printf 'patch\\n' >> "$UPDATES_LOG"; }
reset_cloud_refill_window() { :; }
sync_cloud_terminal_outcomes() {
  printf '%s\\n' "$1" >> "$SYNC_LOG"
  printf 'sync\\n' >> "$UPDATES_LOG"
  return 0
}
node() { printf '%s\\n' '${fakeResult}'; }
AGENT_DIR="${dir}"
JOB_TMP_DIR="${dir}"
MAX_PARALLEL_WORKERS=1
PINNED_RUNTIME=codex
ACCOUNT_SLUG=test-account
JOB_NAME=cloud-library-cron
BUILDER_BLOG_FETCH_DAYS=30
BUILDER_BLOG_FETCH_FORCE=
BUILDER_BLOG_CLOUD_PERSISTENT_HOST=0
run_library_job fetch-cloud-library sync-cloud-builders cloud-fetch-result.json "cloud library"
[ "$(grep -c . "$SYNC_LOG")" = "1" ] || exit 21
patch_line="$(grep -n '^patch$' "$UPDATES_LOG" | cut -d: -f1)"
sync_line="$(grep -n '^sync$' "$UPDATES_LOG" | cut -d: -f1)"
[ -n "$patch_line" ] && [ -n "$sync_line" ] && [ "$patch_line" -lt "$sync_line" ] || exit 22
grep "no_update" "$UPDATES_LOG" >/dev/null
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regular library runner syncs source outcomes but keeps discovery runtime failures fatal", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf('\nif [ "$IS_CRON_JOB" = 1 ]', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-regular-discovery-runtime-failure-"));
  try {
    const checkPath = join(dir, "check.sh");
    const syncLog = join(dir, "sync.log");
    const updatesLog = join(dir, "updates.log");
    const fakeResult = JSON.stringify({
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "candidate_discovery:product_hunt",
        status: "blocked",
        reason: "product_hunt_discovery_blocked",
        evidence: { blocker: "Cloudflare challenge" },
      }],
    });
    await writeFile(
      checkPath,
      `set -eu
SYNC_LOG="${syncLog}"
UPDATES_LOG="${updatesLog}"
${runner.slice(start, end)}
job_timeout_seconds() { printf '7200\\n'; }
shard_timeout_seconds() { printf '3600\\n'; }
cloud_refill_limit() { printf '100\\n'; }
cloud_fetch_source_limit() { printf '10\\n'; }
run_openclaw_library_preflight() { return 0; }
job_run_update() { printf '%s\\n' "$*" >> "$UPDATES_LOG"; }
print_compact_json_artifact_summary() { :; }
normalize_library_fetch_batch() {
  _discovery_failed=1
  _discovery_runtime_failed=1
  _discovery_runtime_failure_code=19
}
library_fetch_task_count() { printf '0\\n'; }
patch_current_fetch_plans() { printf 'patch\\n' >> "$UPDATES_LOG"; }
sync_personal_terminal_outcomes() { printf 'personal-sync\\n' >> "$SYNC_LOG"; }
sync_cloud_terminal_outcomes() { :; }
node() { printf '%s\\n' '${fakeResult}'; }
AGENT_DIR="${dir}"
JOB_TMP_DIR="${dir}"
MAX_PARALLEL_WORKERS=1
PINNED_RUNTIME=codex
ACCOUNT_SLUG=test-account
JOB_NAME=library-cron
BUILDER_BLOG_FETCH_DAYS=30
BUILDER_BLOG_FETCH_LIMIT=3
BUILDER_BLOG_FETCH_FORCE=
if run_library_job fetch-personal sync-builders library-fetch-result.json "source library"; then
  run_code=0
else
  run_code="$?"
fi
[ "$run_code" -eq 19 ] || exit 31
[ "$(grep -c '^personal-sync$' "$SYNC_LOG")" -eq 1 ] || exit 32
grep 'discovery_runtime_failed' "$UPDATES_LOG" >/dev/null
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud library runner skips planned-only sync when zero-task result has no syncable outcomes", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf('\nif [ "$IS_CRON_JOB" = 1 ]', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-zero-task-idle-"));
  try {
    const checkPath = join(dir, "check.sh");
    const syncLog = join(dir, "sync.log");
    await writeFile(
      checkPath,
      `set -eu
SYNC_LOG="${syncLog}"
${runner.slice(start, end)}
job_timeout_seconds() { printf '7200\\n'; }
shard_timeout_seconds() { printf '3600\\n'; }
cloud_refill_limit() { printf '100\\n'; }
cloud_fetch_source_limit() { printf '10\\n'; }
run_openclaw_library_preflight() { return 0; }
job_run_update() { :; }
cloud_run_id_from_result() { printf 'cloud_run_1\\n'; }
append_cloud_run_id() { :; }
cloud_fetch_heartbeat() { :; }
library_has_discovery_tasks() { return 1; }
library_fetch_task_count() { printf '0\\n'; }
patch_current_fetch_plans() { :; }
reset_cloud_refill_window() { :; }
sync_cloud_terminal_outcomes() { return 0; }
node() { printf '%s\\n' '{"cloudRunId":"cloud_run_1","fetchTasks":[],"taskOutcomes":[{"fetchTaskId":"task_failed","status":"failed"}]}'; }
AGENT_DIR="${dir}"
JOB_TMP_DIR="${dir}"
MAX_PARALLEL_WORKERS=1
PINNED_RUNTIME=codex
ACCOUNT_SLUG=test-account
JOB_NAME=cloud-library-cron
BUILDER_BLOG_FETCH_DAYS=30
BUILDER_BLOG_FETCH_FORCE=
BUILDER_BLOG_CLOUD_PERSISTENT_HOST=0
run_library_job fetch-cloud-library sync-cloud-builders cloud-fetch-result.json "cloud library"
[ ! -e "$SYNC_LOG" ] || [ ! -s "$SYNC_LOG" ]
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud library runner surfaces planned-only sync failure in zero-task runs", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf('\nif [ "$IS_CRON_JOB" = 1 ]', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-zero-task-sync-fail-"));
  try {
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
job_timeout_seconds() { printf '7200\\n'; }
shard_timeout_seconds() { printf '3600\\n'; }
cloud_refill_limit() { printf '100\\n'; }
cloud_fetch_source_limit() { printf '10\\n'; }
run_openclaw_library_preflight() { return 0; }
job_run_update() { :; }
cloud_run_id_from_result() { printf 'cloud_run_1\\n'; }
append_cloud_run_id() { :; }
cloud_fetch_heartbeat() { :; }
library_has_discovery_tasks() { return 1; }
library_fetch_task_count() { printf '0\\n'; }
patch_current_fetch_plans() { :; }
reset_cloud_refill_window() { :; }
sync_cloud_terminal_outcomes() { return 17; }
node() { printf '%s\\n' '{"cloudRunId":"cloud_run_1","fetchTasks":[],"taskOutcomes":[{"fetchTaskId":"task_failed","status":"failed","plannedTask":{"id":"task_failed","cloudSourceTaskId":"source_1"}}]}'; }
AGENT_DIR="${dir}"
JOB_TMP_DIR="${dir}"
MAX_PARALLEL_WORKERS=1
PINNED_RUNTIME=codex
ACCOUNT_SLUG=test-account
JOB_NAME=cloud-library-cron
BUILDER_BLOG_FETCH_DAYS=30
BUILDER_BLOG_FETCH_FORCE=
BUILDER_BLOG_CLOUD_PERSISTENT_HOST=0
run_library_job fetch-cloud-library sync-cloud-builders cloud-fetch-result.json "cloud library"
`,
      "utf8",
    );

    await assert.rejects(
      execFileAsync("sh", [checkPath]),
      (error: NodeJS.ErrnoException & { code?: number }) => error.code === 17,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud refill syncs planned-only outcomes once and replaces stale zero-task state before later executable work", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_personal_terminal_outcomes() {");
  const end = runner.indexOf("\npatch_current_fetch_plans() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-refill-planned-only-"));
  try {
    const resultFile = join(dir, "cloud-fetch-result.json");
    const syncLog = join(dir, "sync.log");
    const fakeNode = join(dir, "fake-node.sh");
    const sequenceDir = join(dir, "sequence");
    await mkdir(sequenceDir, { recursive: true });
    await writeFile(
      resultFile,
      JSON.stringify({
        cloudRunId: "cloud_run_initial",
        fetchTasks: [],
        taskOutcomes: [
          {
            fetchTaskId: "initial_failed",
            status: "failed",
            reason: "workload_exceeds_max_budget",
            plannedTask: { id: "initial_failed", cloudRunId: "cloud_run_initial", cloudSourceTaskId: "source_initial" },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(sequenceDir, "1.json"),
      JSON.stringify({
        cloudRunId: "cloud_run_refill_planned",
        fetchTasks: [],
        taskOutcomes: [
          {
            fetchTaskId: "refill_failed",
            status: "failed",
            reason: "workload_exceeds_max_budget",
            plannedTask: { id: "refill_failed", cloudRunId: "cloud_run_refill_planned", cloudSourceTaskId: "source_refill" },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(sequenceDir, "2.json"),
      JSON.stringify({
        cloudRunId: "cloud_run_refill_ready",
        fetchTasks: [
          { id: "ready_task", cloudRunId: "cloud_run_refill_ready", cloudSourceTaskId: "source_ready" },
        ],
        taskOutcomes: [],
      }),
      "utf8",
    );
    await writeFile(
      fakeNode,
      `#!/bin/sh
set -eu
command="$2"
case "$command" in
  fetch-cloud-library)
    count_file="${dir}/fetch-count.txt"
    count=0
    if [ -f "$count_file" ]; then count="$(cat "$count_file")"; fi
    count=$((count + 1))
    printf '%s' "$count" > "$count_file"
    cat "${sequenceDir}/$count.json"
    ;;
  merge-fetch-results)
    echo "unexpected merge" >&2
    exit 41
    ;;
  sync-cloud-builders)
    printf '%s\\n' "$*" >> "${syncLog}"
    ;;
  *)
    echo "unexpected command: $command" >&2
    exit 42
    ;;
esac
`,
      "utf8",
    );
    await execFileAsync("chmod", ["+x", fakeNode]);
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
job_run_update() { :; }
cloud_fetch_source_limit() { printf '10\\n'; }
append_cloud_run_id() { :; }
cloud_fetch_heartbeat() { :; }
cloud_run_id_from_result() {
  command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(payload.cloudRunId||""));' "$1"
  printf '\\n'
}
library_fetch_task_count() {
  command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(Array.isArray(payload.fetchTasks)?payload.fetchTasks.length:0));' "$1"
  printf '\\n'
}
sync_cloud_terminal_outcomes() { printf '%s\\n' "$1" >> "${syncLog}"; }
AGENT_DIR="${dir}"
JOB_TMP_DIR="${dir}"
_sync_command=sync-cloud-builders
_cloud_refill_exhausted=0
_cloud_refill_count=0
_cloud_refill_limit=10
_cloud_refill_stop_at=9999999999
_dynamic_queue_drained=1
_result_file="${resultFile}"
PATH="${dir}:$PATH"
node() { "${fakeNode}" "$@"; }
fetch_more_cloud_sources
[ "$(grep -c . "${syncLog}")" = "1" ] || exit 51
_cloud_refill_exhausted=0
fetch_more_cloud_sources
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if((payload.taskOutcomes||[]).length!==0) process.exit(61); if((payload.fetchTasks||[]).length!==1) process.exit(62); if(payload.fetchTasks[0].id!=="ready_task") process.exit(63);' "${resultFile}"
[ "$(grep -c . "${syncLog}")" = "1" ] || exit 52
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud discovery-only refill normalizes before counting and replaces stale zero-task state", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_cloud_terminal_outcomes() {");
  const end = runner.indexOf("\npatch_current_fetch_plans() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-refill-discovery-"));
  try {
    const resultFile = join(dir, "cloud-fetch-result.json");
    const normalizeLog = join(dir, "normalize.log");
    const fakeNode = join(dir, "fake-node.sh");
    await writeFile(
      resultFile,
      JSON.stringify({
        cloudRunId: "cloud_run_initial",
        fetchTasks: [],
        taskOutcomes: [{ fetchTaskId: "already_synced", status: "failed" }],
      }),
      "utf8",
    );
    await writeFile(
      fakeNode,
      `#!/bin/sh
set -eu
command="$2"
case "$command" in
  fetch-cloud-library)
    printf '%s\\n' '{"cloudRunId":"cloud_run_refill","fetchTasks":[{"id":"candidate_discovery:product_hunt","agentWorkType":"candidate_discovery_fallback","cloudRunId":"cloud_run_refill","cloudSourceTaskId":"source_product_hunt"}],"taskOutcomes":[]}'
    ;;
  merge-fetch-results|sync-cloud-builders)
    echo "unexpected command: $command" >&2
    exit 41
    ;;
  *)
    echo "unexpected command: $command" >&2
    exit 42
    ;;
esac
`,
      "utf8",
    );
    await execFileAsync("chmod", ["+x", fakeNode]);
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
job_run_update() { :; }
cloud_fetch_source_limit() { printf '10\\n'; }
append_cloud_run_id() { :; }
cloud_fetch_heartbeat() { :; }
cloud_run_id_from_result() {
  command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(payload.cloudRunId||""));' "$1"
  printf '\\n'
}
library_fetch_task_count() {
  command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const tasks=Array.isArray(payload.fetchTasks)?payload.fetchTasks:[];process.stdout.write(String(tasks.filter((task)=>task.agentWorkType!=="candidate_discovery_fallback").length));' "$1"
  printf '\\n'
}
normalize_library_fetch_batch() {
  printf '%s|%s\\n' "$1" "$2" >> "${normalizeLog}"
  command node -e 'const fs=require("fs");const file=process.argv[1];const payload=JSON.parse(fs.readFileSync(file,"utf8"));payload.fetchTasks=[{id:"ready_product_hunt",cloudRunId:payload.cloudRunId,cloudSourceTaskId:"source_product_hunt"}];fs.writeFileSync(file,JSON.stringify(payload));' "$1"
}
sync_cloud_terminal_outcomes() { echo "unexpected terminal sync" >&2; return 43; }
AGENT_DIR="${dir}"
JOB_TMP_DIR="${dir}"
_sync_command=sync-cloud-builders
_cloud_refill_exhausted=0
_cloud_refill_count=0
_cloud_refill_limit=10
_cloud_refill_stop_at=9999999999
_dynamic_queue_drained=1
_result_file="${resultFile}"
PATH="${dir}:$PATH"
node() { "${fakeNode}" "$@"; }
fetch_more_cloud_sources
grep -F "${dir}/cloud-fetch-refill-1.json|refill-1" "${normalizeLog}" >/dev/null
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if((payload.taskOutcomes||[]).length!==0) process.exit(61);if(payload.fetchTasks?.[0]?.id!=="ready_product_hunt") process.exit(62);' "${resultFile}"
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discovery pre-pass uses explicit batch input and output paths", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const prompt = await readFile("skills/builder-blog-digest/jobs/library-discovery.md", "utf8");
  const discoveryContract = await readFile(
    "skills/builder-blog-digest/jobs/_fetch-task-discovery.md",
    "utf8",
  );

  assert.match(runner, /BUILDER_BLOG_DISCOVERY_TASKS_FILE/);
  assert.match(runner, /BUILDER_BLOG_DISCOVERY_RESULT_FILE/);
  assert.match(
    shellFunction(runner, "openclaw_discovery_prompt_file"),
    /export BUILDER_BLOG_DISCOVERY_TASKS_FILE=/,
  );
  assert.match(
    shellFunction(runner, "openclaw_discovery_prompt_file"),
    /export BUILDER_BLOG_DISCOVERY_RESULT_FILE=/,
  );
  assert.match(prompt, /BUILDER_BLOG_DISCOVERY_TASKS_FILE/);
  assert.match(prompt, /BUILDER_BLOG_DISCOVERY_RESULT_FILE/);
  assert.match(discoveryContract, /\$DISCOVERY_RESULT_FILE/);
});

test("batch discovery normalization settles blocked fallbacks with scoped artifacts", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const normalizeBatch = shellFunction(runner, "normalize_library_fetch_batch");
  const hasDiscovery = shellFunction(runner, "library_has_discovery_tasks");
  const dir = await mkdtemp(join(tmpdir(), "fb-normalize-discovery-batch-"));
  try {
    const tasksFile = join(dir, "cloud-fetch-refill-4.json");
    const failedTasksFile = join(dir, "cloud-fetch-refill-5.json");
    const expansionFailedTasksFile = join(dir, "cloud-fetch-refill-6.json");
    const validResultAfterRuntimeFailureTasksFile = join(dir, "cloud-fetch-refill-7.json");
    const personalBlockedTasksFile = join(dir, "personal-fetch-initial.json");
    const personalRuntimeFailureTasksFile = join(dir, "personal-fetch-runtime-failed.json");
    const personalMalformedPrefixTasksFile = join(dir, "personal-fetch-malformed-prefix.json");
    const envLog = join(dir, "discovery-env.log");
    const discoveryFetchResult = {
        status: "ok",
        cloudRunId: "cloud_run_refill",
        fetchTasks: [
          {
            id: "ready_existing",
            agentWorkType: "fetch_post",
            cloudRunId: "cloud_run_refill",
            cloudSourceTaskId: "source_existing",
          },
          {
            id: "candidate_discovery:product_hunt",
            type: "candidate_discovery",
            agentWorkType: "candidate_discovery_fallback",
            builder: "Product Hunt Top Products",
            builderId: "builder_product_hunt",
            sourceType: "product_hunt_top_products",
            cloudRunId: "cloud_run_refill",
            cloudSourceTaskId: "source_product_hunt",
            builderSync: {
              builderId: "builder_product_hunt",
              sourceType: "product_hunt_top_products",
              cloudRunId: "cloud_run_refill",
              cloudSourceTaskId: "source_product_hunt",
            },
            discovery: { sourceUrl: "https://www.producthunt.com/", limit: 5 },
          },
        ],
        taskOutcomes: [],
      };
    await writeFile(tasksFile, JSON.stringify(discoveryFetchResult), "utf8");
    await writeFile(failedTasksFile, JSON.stringify(discoveryFetchResult), "utf8");
    await writeFile(expansionFailedTasksFile, JSON.stringify(discoveryFetchResult), "utf8");
    await writeFile(
      validResultAfterRuntimeFailureTasksFile,
      JSON.stringify(discoveryFetchResult),
      "utf8",
    );
    await writeFile(personalBlockedTasksFile, JSON.stringify(discoveryFetchResult), "utf8");
    await writeFile(personalRuntimeFailureTasksFile, JSON.stringify(discoveryFetchResult), "utf8");
    await writeFile(personalMalformedPrefixTasksFile, JSON.stringify(discoveryFetchResult), "utf8");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${hasDiscovery}
${normalizeBatch}
job_run_update() { :; }
print_compact_json_artifact_summary() { :; }
run_selected_runtime() {
  printf '%s|%s\\n' "$BUILDER_BLOG_DISCOVERY_TASKS_FILE" "$BUILDER_BLOG_DISCOVERY_RESULT_FILE" > "${envLog}"
  if [ "$TEST_DISCOVERY_MODE" = "failed" ]; then
    return 19
  fi
  cat > "$BUILDER_BLOG_DISCOVERY_RESULT_FILE" <<'JSON'
{"candidateDiscoveries":[{"fetchTaskId":"candidate_discovery:product_hunt","status":"blocked","reason":"product_hunt_discovery_blocked","evidence":{"blocker":"Cloudflare challenge"}}]}
JSON
  if [ "$TEST_DISCOVERY_MODE" = "writes_then_fails" ]; then
    return 19
  fi
}
AGENT_DIR="${join(process.cwd(), "scripts")}"
JOB_TMP_DIR="${dir}"
PINNED_RUNTIME=codex
ACCOUNT_SLUG=test-account
JOB_NAME=cloud-library-cron
BUILDER_BLOG_ACCOUNT=test@example.com
_discovery_failed=0
_sync_command=sync-cloud-builders
TEST_DISCOVERY_MODE=blocked
export TEST_DISCOVERY_MODE
normalize_library_fetch_batch "${tasksFile}" "refill-4"
grep -F "${tasksFile}|${dir}/discovery/refill-4-result.json" "${envLog}" >/dev/null
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(payload.fetchTasks?.length!==1||payload.fetchTasks[0]?.id!=="ready_existing") process.exit(61);if(payload.taskOutcomes?.[0]?.status!=="blocked") process.exit(62);if(payload.taskOutcomes?.[0]?.plannedTask?.cloudSourceTaskId!=="source_product_hunt") process.exit(63);' "${tasksFile}"
TEST_DISCOVERY_MODE=failed
normalize_library_fetch_batch "${failedTasksFile}" "refill-5"
[ "$_discovery_failed" -eq 1 ] || exit 64
grep -F "${failedTasksFile}|${dir}/discovery/refill-5-result.json" "${envLog}" >/dev/null
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(payload.fetchTasks?.length!==1||payload.fetchTasks[0]?.id!=="ready_existing") process.exit(65);if(payload.taskOutcomes?.[0]?.status!=="failed") process.exit(66);if(payload.taskOutcomes?.[0]?.reason!=="candidate_discovery_result_missing") process.exit(67);if(payload.taskOutcomes?.[0]?.plannedTask?.cloudSourceTaskId!=="source_product_hunt") process.exit(68);' "${failedTasksFile}"
TEST_DISCOVERY_MODE=blocked
TEST_EXPANSION_MODE=failed
export TEST_EXPANSION_MODE
node() {
  if [ "$TEST_EXPANSION_MODE" = "failed" ] && [ "$1" = "$AGENT_DIR/builder-digest.mjs" ]; then
    return 23
  fi
  if [ "$TEST_EXPANSION_MODE" = "malformed_post_prefix" ] && [ "$1" = "$AGENT_DIR/builder-digest.mjs" ] && [ "$2" = "expand-discovery" ]; then
    cat > "$8" <<'JSON'
{"fetchTasks":[],"taskOutcomes":[{"fetchTaskId":"candidate_discovery:not-a-discovery","status":"blocked","reason":"post_fetch_blocked","evidence":{"blocker":"HTTP 403"},"plannedTask":{"id":"candidate_discovery:not-a-discovery","type":"fetch_post","agentWorkType":"fetch_post","builder":"Ordinary post","sourceType":"blog"}}]}
JSON
    return 0
  fi
  command node "$@"
}
set +e
normalize_library_fetch_batch "${expansionFailedTasksFile}" "refill-6"
normalization_code="$?"
set -e
[ "$normalization_code" -eq 23 ] || exit 69
TEST_EXPANSION_MODE=ok
TEST_DISCOVERY_MODE=writes_then_fails
_discovery_failed=0
normalize_library_fetch_batch "${validResultAfterRuntimeFailureTasksFile}" "refill-7"
[ "$_discovery_failed" -eq 0 ] || exit 70
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(payload.taskOutcomes?.[0]?.status!=="blocked") process.exit(71);if(payload.taskOutcomes?.[0]?.reason!=="product_hunt_discovery_blocked") process.exit(72);' "${validResultAfterRuntimeFailureTasksFile}"
_sync_command=sync-builders
TEST_DISCOVERY_MODE=blocked
_discovery_failed=0
_discovery_runtime_failed=0
_discovery_runtime_failure_code=0
normalize_library_fetch_batch "${personalBlockedTasksFile}" "initial"
[ "$_discovery_failed" -eq 1 ] || exit 73
[ "$_discovery_runtime_failed" -eq 0 ] || exit 74
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(payload.taskOutcomes?.[0]?.status!=="blocked") process.exit(74);if(payload.taskOutcomes?.[0]?.reason!=="product_hunt_discovery_blocked") process.exit(75);' "${personalBlockedTasksFile}"
TEST_DISCOVERY_MODE=writes_then_fails
_discovery_failed=0
_discovery_runtime_failed=0
_discovery_runtime_failure_code=0
normalize_library_fetch_batch "${personalRuntimeFailureTasksFile}" "runtime-failed"
[ "$_discovery_failed" -eq 1 ] || exit 76
[ "$_discovery_runtime_failed" -eq 1 ] || exit 77
[ "$_discovery_runtime_failure_code" -eq 19 ] || exit 78
command node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(payload.taskOutcomes?.[0]?.status!=="blocked") process.exit(79);if(payload.taskOutcomes?.[0]?.reason!=="product_hunt_discovery_blocked") process.exit(80);' "${personalRuntimeFailureTasksFile}"
TEST_DISCOVERY_MODE=blocked
TEST_EXPANSION_MODE=malformed_post_prefix
_discovery_failed=0
_discovery_runtime_failed=0
_discovery_runtime_failure_code=0
normalize_library_fetch_batch "${personalMalformedPrefixTasksFile}" "malformed-prefix"
[ "$_discovery_failed" -eq 0 ] || exit 81
[ "$_discovery_runtime_failed" -eq 0 ] || exit 82
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host keeps its job heartbeat fresh while fetch workers run", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /_last_job_run_heartbeat=0/);
  assert.match(
    runner,
    /job_run_update running "Running source fetch workers\." "heartbeat"[\s\S]*--stage "run_fetch_workers"/,
  );
  assert.match(runner, /_last_job_run_heartbeat="\$_now"/);
});

test("cloud worker launch exports an immutable shard start epoch for each worker", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("start_library_worker() {");
  const end = runner.indexOf("\nworker_fits_remaining_outer_window() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-start-epoch-"));
  try {
    const resultsDir = join(dir, "results");
    const shardPath = join(dir, "shard-0.json");
    const checkPath = join(dir, "check.sh");
    await mkdir(resultsDir, { recursive: true });
    await writeFile(
      shardPath,
      JSON.stringify({
        fetchTasks: [{ id: "task-1" }],
      }),
      "utf8",
    );
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
library_worker_was_started() { return 1; }
shard_timeout_seconds_for_file() { printf '%s\\n' 900; }
run_selected_runtime() {
  printf '%s\\n' "$BUILDER_BLOG_SHARD_STARTED_AT_EPOCH" > "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/started-at.txt"
  if ( BUILDER_BLOG_SHARD_STARTED_AT_EPOCH=1 ) 2>/dev/null; then
    printf 'mutable\\n' > "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/immutability.txt"
  else
    printf 'readonly\\n' > "$BUILDER_BLOG_SHARD_CHECKPOINT_DIR/immutability.txt"
  fi
}
_results_dir="${resultsDir}"
AGENT_DIR="${dir}"
ACCOUNT_SLUG=test-account
JOB_NAME=cloud-library-cron
PINNED_RUNTIME=codex
_worker_entries=
_started_shard_names=
_started_worker_count=0
start_library_worker "${shardPath}"
sleep 1
checkpoint_dir="${resultsDir}/shard-0-checkpoints"
[ -s "$checkpoint_dir/started-at.txt" ]
grep -E '^[0-9]+$' "$checkpoint_dir/started-at.txt" >/dev/null
[ "$(cat "$checkpoint_dir/immutability.txt")" = "readonly" ]
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker usage refresh never patches validation-failed task outcomes", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /_sps_failure_mode="\$\{SYNC_PAYLOAD_FAILURE_MODE:-patch\}"/);
  assert.match(
    runner,
    /if \[ "\$_sps_failure_mode" = "skip" \]; then[\s\S]*Skipping non-destructive sync/,
  );
  assert.match(
    runner,
    /SYNC_PAYLOAD_FAILURE_MODE=skip[\s\S]*"\$_frlr_label-usage-refresh"/,
  );
});

test("cloud worker host treats synced idle checkpoint issues as flushed", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /case "\$_frlr_label" in[\s\S]*cloud-host-idle\*/);
  assert.match(runner, /terminal outcomes were synced for \$_frlr_label/);
  assert.match(
    runner,
    /flush_remaining_library_results "\$_result_file" "\$_results_dir" "\$_checkpoint_synced_ids_file" "\$_shard_timeout" "cloud-host-idle" "" "assigned"/,
  );
  assert.match(runner, /_frlr_scope="\$\{7:-all\}"/);
  assert.match(
    runner,
    /assigned\)[\s\S]*_frlr_scope_args="--assigned-only --complete-sources-only"/,
  );
});

test("cloud worker host records failed Codex token refresh as runtime auth failure", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("worker_log_has_failed_turn() {");
  const end = runner.indexOf("\nworker_log_has_backgrounded_tool() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-auth-failure-"));
  try {
    const failedLog = join(dir, "failed.log");
    const benignLog = join(dir, "benign.log");
    await writeFile(
      failedLog,
      [
        "ERROR auth error code: token_expired",
        JSON.stringify({ type: "turn.failed", error: { message: "refresh failed" } }),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      benignLog,
      "Fetched documentation mentions token_expired but the worker continued.",
      "utf8",
    );
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}
worker_log_has_runtime_auth_failure "${failedLog}"
! worker_log_has_runtime_auth_failure "${benignLog}"
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host only stops a runtime after its shard result covers every task", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /worker_result_covers_shard_tasks\(\)/);
  assert.match(runner, /_result_path="\$_results_dir\/\$_name-result\.json"/);
  assert.match(runner, /_shard_path="\$_shards_dir\/\$_name\.json"/);
  assert.match(
    runner,
    /if worker_result_covers_shard_tasks "\$_result_path" "\$_shard_path"; then[\s\S]*result file is complete; terminating lingering runtime/,
  );
  assert.match(runner, /_completed_worker_pids=".*\$_pid/);
});

test("completed workers are reaped inside process-tree termination before the shell reports them", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("process_tree_pids() {");
  const end = runner.indexOf("\njob_tmp_process_pids() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-reap-"));
  try {
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu\n${runner.slice(start, end)}\n(sleep 30) &\nworker_pid=$!\nterminate_process_tree "$worker_pid" TERM 2\n`,
      "utf8",
    );
    const { stderr } = await execFileAsync("sh", [checkPath]);
    assert.doesNotMatch(stderr, /Terminated(?:: 15)?/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host does not reuse a lane whose previous shard exited incomplete", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("worker_entry_lane() {");
  const end = runner.indexOf("\nstart_library_worker() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-lane-reserve-"));
  try {
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    await execFileAsync("mkdir", ["-p", resultsDir]);
    await writeFile(
      join(shardsDir, "shard-2.json"),
      JSON.stringify({
        fetchTasks: [{ id: "ready-a" }, { id: "slow-b" }],
      }),
      "utf8",
    );
    await writeFile(
      join(resultsDir, "shard-2-result.json"),
      JSON.stringify({
        builders: [{ items: [{ rawJson: { fetchTaskId: "ready-a" } }] }],
        taskOutcomes: [],
      }),
      "utf8",
    );
    const availablePath = join(dir, "available.txt");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}
MAX_PARALLEL_WORKERS=3
_shards_dir="${shardsDir}"
_results_dir="${resultsDir}"
_worker_entries="999999:1700000000:shard-2:worker-2"
write_available_worker_ids "${availablePath}"
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
    const available = await readFile(availablePath, "utf8");
    assert.match(available, /worker-0/);
    assert.match(available, /worker-1/);
    assert.doesNotMatch(available, /worker-2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host reuses a dead lane immediately after terminalizing its shard", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("worker_entry_lane() {");
  const end = runner.indexOf("\nstart_library_worker() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-lane-terminalized-"));
  try {
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    await execFileAsync("mkdir", ["-p", resultsDir]);
    const shardFile = join(shardsDir, "shard-2.json");
    await writeFile(
      shardFile,
      JSON.stringify({
        workerId: "worker-2",
        fetchTasks: [
          { id: "task-a", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(resultsDir, "shard-2-worker.log"),
      `${JSON.stringify({
        type: "followbrief_worker_event",
        reason: "worker_runtime_failed",
        worker: "worker-2",
        shard: "shard-2",
        message: "Worker exited with code 1 before writing a complete result.",
      })}\n`,
      "utf8",
    );
    await execFileAsync(process.execPath, [
      "scripts/builder-digest.mjs",
      "finalize-worker-result",
      "--shard",
      shardFile,
      "--results-dir",
      resultsDir,
      "--out",
      join(resultsDir, "shard-2-result.json"),
    ]);

    const availablePath = join(dir, "available.txt");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}
MAX_PARALLEL_WORKERS=3
_shards_dir="${shardsDir}"
_results_dir="${resultsDir}"
_worker_entries="999999:1700000000:shard-2:worker-2"
write_available_worker_ids "${availablePath}"
`,
      "utf8",
    );
    await execFileAsync("sh", [checkPath]);
    const available = await readFile(availablePath, "utf8");
    assert.match(available, /worker-2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("worker model incompatibility detection trusts runtime errors, not fetched content", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const classifier = shellFunction(runner, "worker_log_has_runtime_model_incompatibility");
  const dir = await mkdtemp(join(tmpdir(), "fb-worker-model-error-classifier-"));
  try {
    const contentLog = join(dir, "content.log");
    const failedLog = join(dir, "failed.log");
    await writeFile(
      contentLog,
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "The article says its model is unavailable." },
      })}\n`,
      "utf8",
    );
    await writeFile(
      failedLog,
      `${JSON.stringify({
        type: "turn.failed",
        error: { message: "The gpt-5.6-luna model requires a newer version of Codex." },
      })}\n`,
      "utf8",
    );
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${classifier}
if worker_log_has_runtime_model_incompatibility "${contentLog}"; then exit 91; fi
worker_log_has_runtime_model_incompatibility "${failedLog}"
`,
      "utf8",
    );
    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("model incompatibility circuit terminalizes every assigned worker", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const workerLane = shellFunction(runner, "worker_entry_lane");
  const finalizeWorkers = shellFunction(runner, "finalize_model_incompatible_workers");
  const dir = await mkdtemp(join(tmpdir(), "fb-worker-model-circuit-"));
  try {
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    const eventsFile = join(dir, "events.txt");
    const finalizedFile = join(dir, "finalized.txt");
    await mkdir(resultsDir, { recursive: true });
    await writeFile(join(shardsDir, "shard-0.json"), '{"fetchTasks":[{"id":"a"}]}\n');
    await writeFile(join(shardsDir, "shard-1.json"), '{"fetchTasks":[{"id":"b"}]}\n');
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${workerLane}
${finalizeWorkers}
worker_result_covers_shard_tasks() { return 1; }
terminate_process_tree() { return 0; }
write_worker_control_event() { printf '%s:%s:%s\n' "$2" "$3" "$4" >> "${eventsFile}"; }
finalize_dead_library_worker() { printf '%s:%s\n' "$1" "$2" >> "${finalizedFile}"; return 78; }
_shards_dir="${shardsDir}"
_results_dir="${resultsDir}"
_worker_entries="999991:1700000000:shard-0:worker-0 999992:1700000000:shard-1:worker-1"
finalize_model_incompatible_workers
`,
      "utf8",
    );
    await execFileAsync("sh", [checkPath]);
    assert.deepEqual((await readFile(eventsFile, "utf8")).trim().split("\n"), [
      "runtime_model_incompatible:worker-0:shard-0",
      "runtime_model_incompatible:worker-1:shard-1",
    ]);
    assert.deepEqual((await readFile(finalizedFile, "utf8")).trim().split("\n"), [
      "shard-0:worker-0",
      "shard-1:worker-1",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("model incompatibility circuit fails closed when a worker cannot be terminalized", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const workerLane = shellFunction(runner, "worker_entry_lane");
  const finalizeWorkers = shellFunction(runner, "finalize_model_incompatible_workers");
  const dir = await mkdtemp(join(tmpdir(), "fb-worker-model-circuit-failed-"));
  try {
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    await mkdir(resultsDir, { recursive: true });
    await writeFile(join(shardsDir, "shard-0.json"), '{"fetchTasks":[{"id":"a"}]}\n');
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
${workerLane}
${finalizeWorkers}
worker_result_covers_shard_tasks() { return 1; }
write_worker_control_event() { return 0; }
finalize_dead_library_worker() { return 1; }
_shards_dir="${shardsDir}"
_results_dir="${resultsDir}"
_worker_entries="999991:1700000000:shard-0:worker-0"
code=0
finalize_model_incompatible_workers || code="$?"
test "$code" -eq 1
`,
      "utf8",
    );
    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shared library runner finalizes dead workers before assigning their lanes again", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const startWorker = shellFunction(runner, "start_library_worker");
  const library = shellFunction(runner, "run_library_job");
  const flush = shellFunction(runner, "flush_remaining_library_results");

  assert.match(startWorker, /worker-exit-code/);
  assert.match(startWorker, /run_selected_runtime[\s\S]*_slw_exit_code="\$\?"/);
  assert.match(library, /finalize_dead_library_worker "\$_name" "\$_lane"/);
  assert.ok(
    library.indexOf('finalize_dead_library_worker "$_name" "$_lane"') <
      library.indexOf('assign_dynamic_fetch_workers "$_free_slots"'),
  );
  assert.match(
    library,
    /runtime_model_incompatible[\s\S]*finalize_model_incompatible_workers[\s\S]*flush_remaining_library_results[\s\S]*release_cloud_worker_leases_for_instance/,
  );
  assert.match(
    library,
    /_circuit_terminalization_ok[\s\S]*_circuit_flush_ok[\s\S]*if \[ "\$_circuit_terminalization_ok" -eq 1 \] && \[ "\$_circuit_flush_ok" -eq 1 \]; then[\s\S]*release_cloud_worker_leases_for_instance/,
  );
  const circuit = library.slice(library.indexOf('if [ "$_runtime_circuit_reason" = "runtime_model_incompatible" ]; then'));
  assert.doesNotMatch(circuit, /job_run_update failed/);
  assert.match(flush, /cloud-host-idle\*\|runtime-timeout\*\|runtime-model-incompatible\*/);
});

test("cloud worker entry parsing and budget lookup ignore spaces and colons in JOB_TMP_DIR", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("shard_timeout_seconds() {");
  const end = runner.indexOf("\nfetch_more_cloud_sources() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const baseDir = await mkdtemp(join(tmpdir(), "fb-worker-entry-path-safe-"));
  const dir = join(baseDir, "tmp dir:with spaces");
  try {
    const agentDir = join(dir, "agent");
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    const shardPath = join(shardsDir, "shard-9.json");
    await mkdir(agentDir, { recursive: true });
    await mkdir(resultsDir, { recursive: true });
    await writeFile(
      join(agentDir, "local-agent-timeouts.json"),
      JSON.stringify({
        defaultIntervalMinutes: 60,
        baseMultiplierSecondsPerMinute: 48,
        minSeconds: 1200,
        defaultMaxSeconds: 2700,
        jobDefaultSeconds: {
          "cloud-library-cron": 15_300,
        },
        jobMaxSeconds: {
          "cloud-library-cron": 15_300,
        },
        shardFraction: {
          numerator: 3,
          denominator: 4,
        },
      }),
      "utf8",
    );
    await writeFile(
      shardPath,
      JSON.stringify({
        executionBudgetSeconds: 14_400,
        cloudRunId: "run_1",
        cloudSourceTaskId: "source_1",
        fetchTasks: [
          {
            id: "cloud-1",
            workerId: "worker-2",
            executionBudgetSeconds: 14_400,
            cloudRunId: "run_1",
            cloudSourceTaskId: "source_1",
          },
        ],
      }),
      "utf8",
    );
    const checkPath = join(baseDir, "check.sh");
    await writeFile(
      checkPath,
      `set -eu
AGENT_DIR="${agentDir}"
JOB_NAME=cloud-library-cron
JOB_TMP_DIR="${dir}"
_sync_command=sync-cloud-builders
_cloud_persistent_host=0
_shards_dir="${shardsDir}"
_results_dir="${resultsDir}"
_worker_entries="999999:1700000000:shard-9:worker-2"
${runner.slice(start, end)}
lane="$(worker_entry_lane "$_worker_entries")"
name="$(worker_entry_shard_name "$_worker_entries")"
timeout="$(shard_timeout_seconds_for_file "$_shards_dir/$name.json" 5400)"
[ "$lane" = "worker-2" ] || exit 21
[ "$name" = "shard-9" ] || exit 22
[ "$timeout" = "14400" ] || exit 23
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("cloud worker result coverage rejects partial shard results", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("worker_result_covers_shard_tasks() {");
  const end = runner.indexOf("\nstart_library_worker() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-result-"));
  try {
    const shardPath = join(dir, "shard.json");
    const partialResultPath = join(dir, "partial-result.json");
    const completeResultPath = join(dir, "complete-result.json");
    const checkpointCoveredResultPath = join(dir, "shard-9-result.json");
    const checkpointDir = join(dir, "shard-9-checkpoints");
    const checkPath = join(dir, "check.sh");

    await writeFile(
      shardPath,
      JSON.stringify({
        fetchTasks: [{ id: "ready-a" }, { id: "ready-b" }, { id: "requires-agent-c" }],
      }),
    );
    await writeFile(
      partialResultPath,
      JSON.stringify({
        builders: [{ items: [{ rawJson: { fetchTaskId: "ready-a" } }] }],
        taskOutcomes: [{ fetchTaskId: "ready-b", status: "failed" }],
      }),
    );
    await writeFile(
      completeResultPath,
      JSON.stringify({
        builders: [{ items: [{ rawJson: { fetchTaskId: "ready-a" } }] }],
        taskOutcomes: [
          { fetchTaskId: "ready-b", status: "failed" },
          { fetchTaskId: "requires-agent-c", status: "failed" },
        ],
      }),
    );
    await mkdir(join(checkpointDir, "progress"), { recursive: true });
    await writeFile(
      checkpointCoveredResultPath,
      JSON.stringify({
        builders: [{ items: [{ rawJson: { fetchTaskId: "ready-a" } }] }],
        taskOutcomes: [{ fetchTaskId: "ready-b", status: "failed" }],
      }),
    );
    await writeFile(
      join(checkpointDir, "requires-agent-c.json"),
      JSON.stringify({
        builders: [{ items: [{ rawJson: { fetchTaskId: "requires-agent-c" } }] }],
      }),
    );
    await writeFile(
      join(checkpointDir, "progress", "ready-b.json"),
      JSON.stringify({ fetchTaskId: "ready-b", status: "summarizing" }),
    );
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}\nworker_result_covers_shard_tasks "$1" "$2"\n`,
    );

    await assert.rejects(execFileAsync("sh", [checkPath, partialResultPath, shardPath]));
    await assert.rejects(execFileAsync("sh", [checkPath, join(dir, "missing-result.json"), shardPath]));
    await execFileAsync("sh", [checkPath, completeResultPath, shardPath]);
    await execFileAsync("sh", [checkPath, checkpointCoveredResultPath, shardPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker merge issue count ignores diagnostics when payloads cover shard", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const coverageStart = runner.indexOf("worker_result_covers_shard_tasks() {");
  const coverageEnd = runner.indexOf("\nmerge_result_issue_count() {", coverageStart);
  const countStart = runner.indexOf("merge_result_issue_count() {");
  const countEnd = runner.indexOf("\nstart_library_worker() {", countStart);
  assert.notEqual(coverageStart, -1);
  assert.notEqual(coverageEnd, -1);
  assert.notEqual(countStart, -1);
  assert.notEqual(countEnd, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-merge-issues-"));
  try {
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    const checkpointDir = join(resultsDir, "shard-1-checkpoints");
    const finalCoveredCheckpointDir = join(resultsDir, "shard-5-checkpoints");
    await mkdir(checkpointDir, { recursive: true });
    await mkdir(finalCoveredCheckpointDir, { recursive: true });
    await writeFile(
      join(shardsDir, "shard-1.json"),
      JSON.stringify({
        fetchTasks: [{ id: "nyt-a" }, { id: "nyt-b" }, { id: "nyt-c" }],
      }),
    );
    await writeFile(
      join(shardsDir, "shard-5.json"),
      JSON.stringify({
        fetchTasks: [{ id: "meta-a" }, { id: "meta-b" }, { id: "meta-c" }],
      }),
    );
    for (const id of ["nyt-a", "nyt-b", "nyt-c"]) {
      await writeFile(
        join(checkpointDir, `${id}.json`),
        JSON.stringify({
          builders: [],
          taskOutcomes: [{ fetchTaskId: id, status: "blocked", reason: "fetch_blocked_paywall_cloudflare" }],
        }),
      );
    }
    await writeFile(
      join(resultsDir, "shard-5-result.json"),
      JSON.stringify({
        builders: [
          {
            items: [
              { rawJson: { fetchTaskId: "meta-a" } },
              { rawJson: { fetchTaskId: "meta-b" } },
              { rawJson: { fetchTaskId: "meta-c" } },
            ],
          },
        ],
      }),
    );
    await writeFile(join(finalCoveredCheckpointDir, "broken.json"), '{"builders":[{"items":[{"summary":"bad "quote""}]}]}');
    const mergePath = join(dir, "merge-task-results.json");
    await writeFile(
      mergePath,
      JSON.stringify({
        backfilledOutcomes: 0,
        shards: [
          { shard: "shard-0-result.json", status: "ok" },
          { shard: "shard-1-result.json", status: "missing", error: "no result file", sourceShard: "shard-1" },
          {
            shard: "shard-5-checkpoints/broken.json",
            status: "missing",
            error: "Expected ',' or '}' after property value",
          },
        ],
      }),
    );
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `${runner.slice(coverageStart, coverageEnd)}\n${runner.slice(countStart, countEnd)}\nJOB_TMP_DIR="${dir}"\nmerge_result_issue_count "$1" "$2"\n`,
      "utf8",
    );

    const { stdout } = await execFileAsync("sh", [checkPath, mergePath, resultsDir]);
    assert.equal(stdout.trim(), "0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker merge issue count does not double count backfilled missing shards", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const coverageStart = runner.indexOf("worker_result_covers_shard_tasks() {");
  const coverageEnd = runner.indexOf("\nmerge_result_issue_count() {", coverageStart);
  const countStart = runner.indexOf("merge_result_issue_count() {");
  const countEnd = runner.indexOf("\nstart_library_worker() {", countStart);
  assert.notEqual(coverageStart, -1);
  assert.notEqual(coverageEnd, -1);
  assert.notEqual(countStart, -1);
  assert.notEqual(countEnd, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-backfill-count-"));
  try {
    const shardsDir = join(dir, "shards");
    const resultsDir = join(shardsDir, "results");
    await mkdir(resultsDir, { recursive: true });
    await writeFile(
      join(shardsDir, "shard-1.json"),
      JSON.stringify({
        fetchTasks: [{ id: "nyt-a" }, { id: "nyt-b" }, { id: "nyt-c" }],
      }),
    );
    const mergePath = join(dir, "merge-task-results.json");
    await writeFile(
      mergePath,
      JSON.stringify({
        backfilledOutcomes: 3,
        shards: [
          { shard: "shard-1-result.json", status: "missing", error: "no result file", sourceShard: "shard-1" },
        ],
      }),
    );
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `${runner.slice(coverageStart, coverageEnd)}\n${runner.slice(countStart, countEnd)}\nJOB_TMP_DIR="${dir}"\nmerge_result_issue_count "$1" "$2"\n`,
      "utf8",
    );

    const { stdout } = await execFileAsync("sh", [checkPath, mergePath, resultsDir]);
    assert.equal(stdout.trim(), "3");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host detects backgrounded tool calls in worker logs", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("worker_log_has_backgrounded_tool() {");
  const end = runner.indexOf("\njson_get_number() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-backgrounded-"));
  try {
    const logPath = join(dir, "worker.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      logPath,
      `{"type":"system","subtype":"task_updated","is_backgrounded":true,"tool_use_id":"toolu_123"}\n`,
      "utf8",
    );
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}\nworker_log_has_backgrounded_tool "$1"\n`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath, logPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host ignores backgrounded-tool text inside fetched content", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("worker_log_has_backgrounded_tool() {");
  const end = runner.indexOf("\njson_get_number() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-backgrounded-content-"));
  try {
    const logPath = join(dir, "worker.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      logPath,
      `${JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          aggregated_output:
            "Fetched repository docs include Bash({ run_in_background: true }) as an example.",
        },
      })}\n`,
      "utf8",
    );
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}
if worker_log_has_backgrounded_tool "$1"; then
  exit 7
fi
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath, logPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime timeout detection ignores fetched command output text", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("agent_output_has_runtime_pattern() {");
  const end = runner.indexOf("\nopenclaw_capacity_attempts() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-timeout-content-"));
  try {
    const logPath = join(dir, "agent-output.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      logPath,
      `${JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          aggregated_output:
            "Fetched repository docs mention DEADLINE_EXCEEDED as an API example.",
        },
      })}\n`,
      "utf8",
    );
    await writeFile(
      checkPath,
      `${runner.slice(start, end)}
if agent_output_has_timeout "$1"; then
  exit 7
fi
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath, logPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime timeout detection ignores raw stderr text", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("agent_output_has_runtime_pattern() {");
  const end = runner.indexOf("\nopenclaw_capacity_attempts() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-timeout-stderr-"));
  try {
    const logPath = join(dir, "agent-output.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(logPath, "DEADLINE_EXCEEDED: model request timed out\n", "utf8");
    await writeFile(
      checkPath,
`${runner.slice(start, end)}
if agent_output_has_timeout "$1"; then
  exit 7
fi
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath, logPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime timeout detection accepts structured runtime events", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("agent_output_has_runtime_pattern() {");
  const end = runner.indexOf("\nopenclaw_capacity_attempts() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-runtime-timeout-jsonl-"));
  try {
    const logPath = join(dir, "agent-output.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      logPath,
      `${JSON.stringify({
        type: "error",
        message: "DEADLINE_EXCEEDED: model request timed out",
      })}\n`,
      "utf8",
    );
    await writeFile(
      checkPath,
`${runner.slice(start, end)}
agent_output_has_timeout "$1"
`,
      "utf8",
    );

    await execFileAsync("sh", [checkPath, logPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud worker host monitors fixed per-shard agent output files", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const outputStart = runner.indexOf("agent_output_file() {");
  const outputEnd = runner.indexOf("\nagent_usage_file() {", outputStart);
  assert.notEqual(outputStart, -1);
  assert.notEqual(outputEnd, -1);
  assert.match(runner, /_slw_agent_output_file="\$_results_dir\/\$_slw_shard_name-agent-output\.log"/);
  assert.match(runner, /BUILDER_BLOG_AGENT_OUTPUT_FILE="\$_slw_agent_output_file"/);
  assert.match(
    runner,
    /_worker_agent_output_path="\$_results_dir\/\$_name-agent-output\.log"[\s\S]*worker_log_has_backgrounded_tool "\$_worker_agent_output_path"/,
  );

  const dir = await mkdtemp(join(tmpdir(), "fb-worker-output-file-"));
  try {
    const fixedPath = join(dir, "shard-5-agent-output.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(
      checkPath,
      `${runner.slice(outputStart, outputEnd)}
JOB_TMP_DIR="${dir}"
BUILDER_BLOG_AGENT_OUTPUT_FILE="${fixedPath}"
agent_output_file claude
`,
      "utf8",
    );

    const { stdout } = await execFileAsync("sh", [checkPath]);
    assert.equal(stdout.trim(), fixedPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("library worker prompt forbids background task work", async () => {
  const prompt = await readFile("skills/builder-blog-digest/jobs/library-worker.md", "utf8");

  assert.doesNotMatch(prompt, /Use the FollowBrief skill/);
  assert.match(prompt, /Do NOT start background commands or tool calls/);
  assert.match(prompt, /run_in_background/);
  assert.match(prompt, /managed long-media extraction[\s\S]*FollowBrief runner/i);
  assert.doesNotMatch(prompt, /extract-long-media/);
  assert.doesNotMatch(prompt, /yt-dlp|ffmpeg|whisper/i);
  assert.doesNotMatch(prompt, /extraction_exceeds_shard_timeout/);
  assert.doesNotMatch(prompt, /cat "\$BUILDER_BLOG_SHARD_FILE"/);
  assert.match(prompt, /compact task queue/);
  assert.match(prompt, /process one task at a time/);
  assert.match(prompt, /Started reading this task/);
  assert.match(prompt, /TASK_FILE="\$BUILDER_BLOG_SHARD_CHECKPOINT_DIR\/task-\$TASK_HASH\.json"/);
});

test("runner starts managed media without blocking ready worker assignment", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const runStart = runner.indexOf("run_library_job() {");
  const runEnd = runner.indexOf("\nrun_digest_job() {", runStart);
  const runLibraryJob = runner.slice(runStart, runEnd === -1 ? undefined : runEnd);

  assert.match(runLibraryJob, /start_managed_media_batch[\s\\]*"\$_result_file"[\s\\]*"initial"/);
  assert.ok(
    runLibraryJob.indexOf("start_managed_media_batch")
      < runLibraryJob.indexOf('assign_dynamic_fetch_workers "$MAX_PARALLEL_WORKERS"'),
  );
  assert.match(runLibraryJob, /poll_managed_media_batch/);
  assert.match(runLibraryJob, /managed_media_batch_running/);
  assert.match(
    runLibraryJob,
    /_cloud_refill_exhausted[^\n]*_managed_media_active[^\n]*-eq 0/,
  );
  const refillStart = runner.indexOf("fetch_more_cloud_sources() {");
  const refillEnd = runner.indexOf("\npatch_current_fetch_plans() {", refillStart);
  const refill = runner.slice(refillStart, refillEnd === -1 ? undefined : refillEnd);
  assert.match(refill, /start_managed_media_batch[\s\\]*"\$_result_file"[\s\\]*"refill-\$_cloud_refill_count"/);
  assert.doesNotMatch(refill, /prepare_managed_media_batch/);
  assert.ok(refill.indexOf("merge-fetch-results") < refill.indexOf("start_managed_media_batch"));
  assert.match(runner, /builder-digest\.mjs" prepare-managed-media/);
});

test("fetch setup prompts run the ASR doctor before unattended media work", async () => {
  const setup = await readFile(
    "skills/builder-blog-digest/jobs/_asr-capability-setup.md",
    "utf8",
  );
  for (const file of [
    "skills/builder-blog-digest/jobs/library-once.md",
    "skills/builder-blog-digest/jobs/library-cron-setup.md",
    "skills/builder-blog-digest/jobs/cloud-library-cron-setup.md",
  ]) {
    const prompt = (await readFile(file, "utf8")).replace(
      "{{INCLUDE:asr-capability-setup}}",
      setup,
    );
    assert.match(prompt, /builder-digest\.mjs" asr-doctor/);
    assert.match(prompt, /Do not install[\s\S]*unattended/i);
  }
  assert.match(setup, /yt-dlp\[default\]/);
  assert.match(setup, /JavaScript runtime/i);
});

test("cloud copy prompt settings flow into the local cloud runner command", async () => {
  const actions = await readFile("src/components/AdminCloudFetchRunActions.tsx", "utf8");
  const promptLinkInstruction = await readFile(
    "src/lib/agent-prompt-link-instruction.ts",
    "utf8",
  );
  const route = await readFile("src/app/api/skill/jobs/[job]/skill.md/route.ts", "utf8");
  const renderer = await readFile("src/lib/agent-prompt-renderer.ts", "utf8");
  const fileRoute = await readFile("src/app/api/skill/files/[file]/route.ts", "utf8");
  const skillFiles = await readFile("src/lib/agent-skill-files.ts", "utf8");
  const bootstrapRoute = await readFile("src/app/api/skill/bootstrap/route.ts", "utf8");
  const jobFiles = await readFile("src/lib/skill-job-files.ts", "utf8");
  const setupPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-setup.md", "utf8");
  const stopPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");
  const cronPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron.md", "utf8");
  const hostPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-host.md", "utf8");
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const cli = await readFile("scripts/builder-digest.mjs", "utf8");

  assert.doesNotMatch(actions, /cloud-library-once/);
  assert.doesNotMatch(actions, /FREQUENCY_OPTIONS/);
  assert.doesNotMatch(actions, /params\.set\("freq"/);
  assert.match(actions, /Copy worker host prompt/);
  assert.match(actions, /Copy stop cloud fetch prompt/);
  assert.doesNotMatch(actions, /cloud-run-cloud-limit/);
  assert.doesNotMatch(actions, /cloud-run-post-limit/);
  assert.match(actions, /cloud-run-fetch-days/);
  assert.match(actions, /cloud-run-parallel-workers/);
  assert.doesNotMatch(actions, /params\.set\("cloudLimit"/);
  assert.doesNotMatch(actions, /params\.set\("postLimit"/);
  assert.match(actions, /\/api\/settings\/tokens\/\$\{tokenId\}\/prompt-links/);
  assert.match(actions, /JSON\.stringify\(\{ job, options \}/);
  assert.match(actions, /const options: PromptLinkBody\["options"\] = \{ runtime \}/);
  assert.match(actions, /options\.fetchDays = fetchDaysValue/);
  assert.match(actions, /options\.parallelWorkers = parallelWorkersValue/);
  assert.match(actions, /buildAgentPromptLinkInstruction\(url\)/);
  assert.match(
    promptLinkInstruction,
    /If browser access is blocked, use Node\.js fetch instead of curl/,
  );
  assert.doesNotMatch(actions, /exchange-code/);
  assert.doesNotMatch(actions, /URLSearchParams/);
  assert.doesNotMatch(actions, /Read \$\{url\} and follow the instructions\./);
  assert.doesNotMatch(actions, /params\.set\("days"/);
  assert.doesNotMatch(actions, /params\.set\("parallel"/);
  assert.doesNotMatch(actions, /params\.set\("runtime"/);

  assert.doesNotMatch(route, /boundedIntegerParam\(url\.searchParams, "cloudLimit", 10, 1, 100\)/);
  assert.match(route, /boundedIntegerParam\(url\.searchParams, "postLimit", 3, 1, 20\)/);
  assert.match(route, /const parallelDefault = 10/);
  assert.match(route, /const parallelMax = 20/);
  assert.doesNotMatch(renderer, /\{\{CLOUD_FETCH_LIMIT\}\}/);
  assert.match(renderer, /\{\{FETCH_LIMIT\}\}/);
  assert.match(fileRoute, /readAgentSkillFile/);
  assert.match(skillFiles, /builder-blog-cloud-library-host\.md/);
  assert.match(skillFiles, /skills\/builder-blog-digest\/jobs\/cloud-library-host\.md/);
  assert.match(skillFiles, /replaceAll\("\{\{PARALLEL_WORKERS\}\}", "10"\)/);
  assert.doesNotMatch(skillFiles, /asset\.path\.includes\("cloud-library"\) \? "1"/);
  assert.match(bootstrapRoute, /api\/skill\/bundle/);
  assert.match(jobFiles, /"cloud-library-host":/);
  assert.match(jobFiles, /cloud-library-host\.md/);
  assert.match(jobFiles, /"cloud-library-cron-stop":/);
  assert.match(jobFiles, /cloud-library-cron-stop\.md/);

  for (const prompt of [setupPrompt, cronPrompt, hostPrompt]) {
    assert.doesNotMatch(prompt, /\{\{CLOUD_FETCH_LIMIT\}\}/);
    assert.doesNotMatch(prompt, /\{\{FETCH_LIMIT\}\}/);
    assert.doesNotMatch(prompt, /BUILDER_BLOG_FETCH_LIMIT/);
    assert.match(prompt, /\{\{FETCH_DAYS\}\}/);
    assert.match(prompt, /\{\{PARALLEL_WORKERS\}\}/);
  }

  assert.doesNotMatch(setupPrompt, /BUILDER_BLOG_CLOUD_FETCH_LIMIT/);
  assert.match(setupPrompt, /Check whether a local cloud worker host or active cloud worker is already running/);
  assert.match(setupPrompt, /ACTIVE_CLOUD_WORKER/);
  assert.match(setupPrompt, /NO_ACTIVE_CLOUD_WORKER/);
  assert.match(setupPrompt, /ask the user whether to replace that active/);
  assert.match(setupPrompt, /cloud-library-host\/current\.json/);
  assert.match(setupPrompt, /cloud-library-cron\/current\.json/);
  assert.doesNotMatch(setupPrompt, /CLOUD_LIMIT=/);
  assert.match(setupPrompt, /FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-\{\{FETCH_DAYS\}\}\}"/);
  assert.match(setupPrompt, /WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-\{\{PARALLEL_WORKERS\}\}\}"/);
  assert.match(
    setupPrompt,
    /BUILDER_BLOG_AGENT_DIR="\$AGENT_DIR" BUILDER_BLOG_AGENT_RUNTIME="\$RUNTIME" BUILDER_BLOG_RUN_SOURCE=cloud BUILDER_BLOG_FETCH_DAYS="\$FETCH_DAYS" BUILDER_BLOG_PARALLEL_WORKERS="\$WORKERS" BUILDER_BLOG_CLOUD_IDLE_SECONDS="\$IDLE_SECONDS" "\$AGENT_DIR\/builder-agent-runner\.sh" cloud-library-host/,
  );
  assert.match(runner, /fetch-cloud-library[\s\S]*--post-limit "5"/);
  assert.match(runner, /if \[ "\$_cfsl_workers" -gt 20 \]/);
  assert.doesNotMatch(runner, /if \[ "\$_cfsl_workers" -gt 8 \]/);
  assert.match(cli, /fetch-cloud-library \[--limit 10\][^\n]*\[--post-limit 5\]/);
  assert.match(cli, /argValue\(args, "--fetch-limit", "5"\)/);
  assert.match(cli, /argValue\(args, "--post-limit", argValue\(args, "--fetch-limit", "5"\)\)/);
  assert.match(setupPrompt, /launchctl bootstrap "gui\/\$\(id -u\)" "\$PLIST" \|\| \{/);
  assert.match(setupPrompt, /sleep 2/);
  assert.match(setupPrompt, /launchctl bootstrap "gui\/\$\(id -u\)" "\$PLIST" \|\| exit "\$BOOTSTRAP_CODE"/);
  assert.match(setupPrompt, /launchctl kickstart -k "gui\/\$\(id -u\)\/\$LABEL" \|\| exit "\$\?"/);
  assert.match(setupPrompt, /systemctl --user daemon-reload \|\| exit "\$\?"/);
  assert.match(setupPrompt, /systemctl --user enable --now followbrief-cloud-library-host\.service \|\| exit "\$\?"/);
  assert.match(setupPrompt, /systemctl --user restart followbrief-cloud-library-host\.service \|\| exit "\$\?"/);
  assert.match(setupPrompt, /Environment="BUILDER_BLOG_AGENT_DIR=\$AGENT_DIR"/);
  assert.match(
    setupPrompt,
    /ExecStart=\/bin\/sh -c 'exec "\$BUILDER_BLOG_AGENT_DIR\/builder-agent-runner\.sh" cloud-library-host >> "\$BUILDER_BLOG_AGENT_DIR\/logs\/cloud-library-host\.out\.log" 2>> "\$BUILDER_BLOG_AGENT_DIR\/logs\/cloud-library-host\.err\.log"'/,
  );
  assert.match(setupPrompt, /<key>KeepAlive<\/key><true\/>/);
  assert.match(setupPrompt, /<key>RunAtLoad<\/key><true\/>/);
  assert.doesNotMatch(setupPrompt, /<key>StartInterval<\/key>/);
  assert.match(setupPrompt, /followbrief-cloud-library-host\.service/);
  assert.match(cronPrompt, /Run the internal cloud source fetch command/);
  assert.match(cronPrompt, /cloud-library-host/);
  assert.match(hostPrompt, /Run the persistent cloud source worker host/);
  assert.match(hostPrompt, /builder-agent-runner\.sh" cloud-library-host/);
  assert.match(hostPrompt, /BUILDER_BLOG_AGENT_RUNTIME="\$\{BUILDER_BLOG_AGENT_RUNTIME-\{\{AGENT_RUNTIME\}\}\}"/);
  assert.match(hostPrompt, /BUILDER_BLOG_CLOUD_IDLE_SECONDS/);

  assert.match(stopPrompt, /Stop the FollowBrief Cloud worker host/);
  assert.match(stopPrompt, /com\.followbrief\.cloud-library-host/);
  assert.match(stopPrompt, /followbrief-cloud-library-host\.service/);
  assert.match(stopPrompt, /cloud-library-host\/current\.json/);
  assert.match(stopPrompt, /cloud-library-cron\/current\.json/);
  assert.match(stopPrompt, /runtime-cloud-library-host-\$ACCOUNT_SLUG/);
  assert.match(stopPrompt, /runtime-cloud-library-cron-\$ACCOUNT_SLUG/);
  assert.match(stopPrompt, /BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current/);
  assert.doesNotMatch(stopPrompt, /job-run-update/);
  assert.doesNotMatch(stopPrompt, /cron-status/);
  assert.doesNotMatch(stopPrompt, /--schedule-job cloud-library-cron/);
});

test("admin cloud host prompts coordinate account-safe replacement and stop before mutating pins", async () => {
  const setupPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-setup.md", "utf8");
  const stopPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");

  const setupInspect = setupPrompt.indexOf("ACTIVE_CLOUD_WORKER");
  const setupMark = setupPrompt.indexOf("BUILDER_BLOG_CLOUD_HOST_CONTROL=mark-replaced");
  const setupStop = setupPrompt.indexOf("BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current");
  const setupPin = setupPrompt.indexOf('runtime-cloud-library-host-$ACCOUNT_SLUG');
  assert.ok(setupInspect >= 0, "setup must inspect the existing host");
  assert.ok(setupMark > setupInspect, "setup must mark the old host only after inspection/confirmation");
  assert.ok(setupStop > setupMark, "setup must stop the confirmed old host after marking replacement");
  assert.ok(setupPin > setupStop, "setup must not write runtime pins before replacement succeeds");
  assert.match(setupPrompt, /loaded service owner cannot be proven/i);
  assert.match(setupPrompt, /BLOCKED_CLOUD_WORKER: systemctl is unavailable; service state cannot be proven/i);
  assert.match(setupPrompt, /BUILDER_BLOG_ACCOUNT="\$EXISTING_ACCT"[\s\S]*BUILDER_BLOG_CLOUD_HOST_CONTROL=mark-replaced/);
  assert.match(setupPrompt, /launchctl kickstart[\s\S]*launchctl print/);
  assert.match(setupPrompt, /systemctl --user restart[\s\S]*systemctl --user is-active --quiet/);
  assert.doesNotMatch(setupPrompt, /codex exec\|claude -p\|openclaw/);

  const stopOwnerCheck = stopPrompt.indexOf("SERVICE_ACCOUNT");
  const stopService = stopPrompt.indexOf("SERVICE_ABSENT");
  const stopCurrent = stopPrompt.indexOf("BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current");
  const stopPin = stopPrompt.indexOf('runtime-cloud-library-host-$ACCOUNT_SLUG');
  assert.ok(stopOwnerCheck >= 0, "stop must resolve the shared service owner");
  assert.ok(stopService > stopOwnerCheck, "stop must reject an ownership mismatch before unloading the service");
  assert.ok(stopCurrent > stopService, "stop must verify service absence before terminating the recorded worker");
  assert.ok(stopPin > stopCurrent, "stop must preserve runtime pins until worker cleanup succeeds");
  assert.match(stopPrompt, /service belongs to another FollowBrief account/i);
  assert.match(stopPrompt, /loaded service owner cannot be proven/i);
  assert.match(stopPrompt, /systemctl is unavailable; service state cannot be proven/i);
  assert.doesNotMatch(stopPrompt, /codex exec\|claude -p\|openclaw/);
  assert.doesNotMatch(stopPrompt, /disable --now[^\n]*\|\| true/);
  assert.doesNotMatch(stopPrompt, /stop followbrief-cloud-library-host\.service[^\n]*\|\| true/);
});

test("cloud stop pin cleanup removes broken symlinks and fails when a target remains", async () => {
  const stopPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");
  const cleanupBlock = markdownShellBlocks(stopPrompt).find(
    (candidate) =>
      candidate.includes("for PIN_FILE in") &&
      candidate.includes('runtime-cloud-library-host-$ACCOUNT_SLUG'),
  );
  assert.ok(cleanupBlock, "missing cloud runtime pin cleanup block");

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-pin-cleanup-"));
  const account = "cleanup@example.com";
  const base = account
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || "default";
  const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
  const accountSlug = `${base}_${hash}`;
  const hostPin = join(dir, `runtime-cloud-library-host-${accountSlug}`);
  const cronPin = join(dir, `runtime-cloud-library-cron-${accountSlug}`);
  const runCleanup = () =>
    execFileAsync("/bin/sh", ["-eu", "-c", cleanupBlock], {
      env: {
        ...process.env,
        BUILDER_BLOG_ACCOUNT: account,
        BUILDER_BLOG_AGENT_DIR: dir,
      },
    });

  try {
    await symlink(join(dir, "missing-target"), hostPin);
    await runCleanup();
    await assert.rejects(lstat(hostPin), /ENOENT/);

    await mkdir(cronPin);
    await assert.rejects(
      runCleanup(),
      (error: unknown) => {
        assert.match(String((error as { stderr?: string }).stderr), /Failed to remove file:/);
        return true;
      },
    );
    assert.ok((await lstat(cronPin)).isDirectory(), "cleanup must not recursively remove directories");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("admin cloud setup launchd replacement paths wait for absence after bootout", async () => {
  const setupPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-setup.md", "utf8");
  const replacementBlock = markdownShellBlocks(setupPrompt).find((candidate) => candidate.includes("OLD_CLOUD_WORKER_STOPPED"));
  const installBlock = markdownShellBlocks(setupPrompt).find((candidate) => candidate.includes("Installed launchd worker host"));

  assert.ok(replacementBlock, "missing launchd replacement block");
  assert.ok(installBlock, "missing launchd install block");

  assert.match(replacementBlock, /wait_for_launchd_absent\(\) \{/);
  assert.match(
    replacementBlock,
    /launchctl bootout "gui\/\$\(id -u\)\/\$LABEL" \|\| exit "\$\?"[\s\S]*wait_for_launchd_absent "\$LABEL"[\s\S]*if ! rm -- "\$PLIST" 2>\/dev\/null &&[\s\S]*\{ \[ -e "\$PLIST" \] \|\| \[ -L "\$PLIST" \]; \}; then[\s\S]*echo "Failed to remove file: \$PLIST" >&2[\s\S]*exit 1[\s\S]*fi/,
  );
  assert.match(replacementBlock, /timed out/i);
  assert.doesNotMatch(
    replacementBlock,
    /launchctl bootout "gui\/\$\(id -u\)\/\$LABEL" \|\| exit "\$\?"[\s\S]*launchctl print "gui\/\$\(id -u\)\/\$LABEL" >/,
  );

  assert.match(installBlock, /wait_for_launchd_absent\(\) \{/);
  assert.match(
    installBlock,
    /launchctl bootout "gui\/\$\(id -u\)\/\$LABEL" 2>\/dev\/null \|\| true[\s\S]*wait_for_launchd_absent "\$LABEL"[\s\S]*launchctl enable "gui\/\$\(id -u\)\/\$LABEL"[\s\S]*launchctl bootstrap "gui\/\$\(id -u\)" "\$PLIST"/,
  );
});

test("cloud host control wrapper cannot mask a primary marker failure with an absent compatibility marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-wrapper-"));
  try {
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `set -u
${shellFunction(runner, "run_cloud_host_control")}
AGENT_DIR="${dir}"
ACCOUNT_SLUG=account
BUILDER_BLOG_CLOUD_HOST_CONTROL=stop-current
calls=0
cloud_host_control_current_file() {
  calls=$((calls + 1))
  printf '%s\\n' "$3" >> "${dir}/calls"
  [ "$calls" -ne 1 ]
}
run_cloud_host_control
`,
      "utf8",
    );
    await assert.rejects(execFileAsync("sh", [script]));
    assert.equal((await readFile(join(dir, "calls"), "utf8")).trim(), "cloud-library-host");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("admin cloud stop refuses to unload a loaded launchd service owned by another account", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-stop-owner-"));
  try {
    const plistDir = join(dir, "Library", "LaunchAgents");
    const plist = join(plistDir, "com.followbrief.cloud-library-host.plist");
    await mkdir(plistDir, { recursive: true });
    await writeFile(
      plist,
      '<string>BUILDER_BLOG_ACCOUNT="other@example.com" builder-agent-runner.sh cloud-library-host</string>\n',
      "utf8",
    );
    const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");
    const block = markdownShellBlocks(prompt).find((candidate) => candidate.includes("SERVICE_ABSENT launchd"));
    assert.ok(block, "missing launchd stop block");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `set -eu
launchctl() { printf '%s\\n' "$*" >> "${dir}/launchctl.log"; return 0; }
${block}`,
      "utf8",
    );
    await assert.rejects(
      execFileAsync("sh", [script], {
        env: { ...process.env, HOME: dir, BUILDER_BLOG_ACCOUNT: "target@example.com" },
      }),
    );
    assert.match(await readFile(plist, "utf8"), /other@example\.com/);
    assert.doesNotMatch(await readFile(join(dir, "launchctl.log"), "utf8"), /bootout/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("admin cloud stop waits for launchd absence before removing this account's plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-stop-wait-"));
  try {
    const plistDir = join(dir, "Library", "LaunchAgents");
    const plist = join(plistDir, "com.followbrief.cloud-library-host.plist");
    await mkdir(plistDir, { recursive: true });
    await writeFile(
      plist,
      '<string>BUILDER_BLOG_ACCOUNT="target@example.com" builder-agent-runner.sh cloud-library-host</string>\n',
      "utf8",
    );
    const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");
    const block = markdownShellBlocks(prompt).find((candidate) => candidate.includes("SERVICE_ABSENT launchd"));
    assert.ok(block, "missing launchd stop block");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `set -eu
SLEEP_CALLS=0
BOOTOUT_DONE=0
launchctl() {
  printf '%s\\n' "$*" >> "${dir}/launchctl.log"
  case "$1" in
    print)
      if [ "$BOOTOUT_DONE" -eq 1 ] && [ "$SLEEP_CALLS" -ge 2 ]; then
        return 1
      fi
      return 0
      ;;
    bootout)
      BOOTOUT_DONE=1
      return 0
      ;;
  esac
  return 0
}
sleep() {
  SLEEP_CALLS=$((SLEEP_CALLS + 1))
  printf 'sleep %s\\n' "$1" >> "${dir}/launchctl.log"
  return 0
}
${block}`,
      "utf8",
    );
    const result = await execFileAsync("sh", [script], {
      env: { ...process.env, HOME: dir, BUILDER_BLOG_ACCOUNT: "target@example.com" },
    }).catch((error: unknown) => {
      assert.equal((error as { code?: number }).code, 75);
      assert.match(String((error as { stderr?: string }).stderr), /service is still loaded/i);
      throw error;
    });
    assert.match(result.stdout, /SERVICE_ABSENT launchd com\.followbrief\.cloud-library-host/);
    await assert.rejects(readFile(plist, "utf8"), /ENOENT/);
    const launchctlLog = await readFile(join(dir, "launchctl.log"), "utf8");
    assert.match(launchctlLog, /^bootout gui\//m);
    assert.match(launchctlLog, /^sleep 1$/m);
    assert.match(launchctlLog, /^print gui\//m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("admin cloud stop fails closed when Linux service state cannot be inspected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-stop-no-systemctl-"));
  try {
    const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");
    const block = markdownShellBlocks(prompt).find((candidate) => candidate.includes("SERVICE_ABSENT systemd"));
    assert.ok(block, "missing systemd stop block");
    const script = join(dir, "check.sh");
    await writeFile(script, `set -eu\n${block}`, "utf8");
    await assert.rejects(
      execFileAsync("/bin/sh", [script], {
        env: {
          ...process.env,
          HOME: dir,
          PATH: dir,
          BUILDER_BLOG_ACCOUNT: "target@example.com",
        },
      }),
      (error: unknown) => {
        assert.match(String((error as { stderr?: string }).stderr), /systemctl is unavailable; service state cannot be proven/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regular local launchd stop accepts a plist removed concurrently after launchd is absent", async () => {
  for (const [job, promptPath, label] of [
    ["library-cron", "skills/builder-blog-digest/jobs/library-cron-stop.md", "com.followbrief.library.test_local"],
    ["digest-cron", "skills/builder-blog-digest/jobs/digest-cron-stop.md", "com.followbrief.digest.test_local"],
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), `fb-${job}-stop-wait-`));
    try {
      const plistDir = join(dir, "Library", "LaunchAgents");
      const fakeBin = join(dir, "fake-bin");
      const agentDir = join(dir, ".builder-blog");
      const plist = join(plistDir, `${label}.plist`);
      await mkdir(plistDir, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(plist, "<plist />\n", "utf8");
      await writeFile(join(agentDir, "builder-digest.mjs"), "// stub\n", "utf8");
      await writeFile(
        join(fakeBin, "node"),
        `#!/bin/sh
if [ "$#" -ge 2 ] && [ "$2" = "cron-audit" ]; then
  case "$1" in
    */builder-digest.mjs)
      printf '%s\\n' "$*" >> "${dir}/node.log"
      exit 0
      ;;
  esac
fi
echo "unexpected node call: $*" >&2
exit 91
`,
        "utf8",
      );
      await execFileAsync("chmod", ["+x", join(fakeBin, "node")]);
      const prompt = await readFile(promptPath, "utf8");
      const block = regularLocalStopBlock(prompt, job);
      const script = join(dir, "check.sh");
      await writeFile(
        script,
        `set -eu
SLEEP_CALLS=0
BOOTOUT_DONE=0
LAUNCHD_GONE=0
launchctl() {
  printf '%s\\n' "$*" >> "${dir}/launchctl.log"
  case "$1" in
    print)
      if [ "$BOOTOUT_DONE" -eq 1 ] && [ "$SLEEP_CALLS" -ge 2 ]; then
        LAUNCHD_GONE=1
        return 1
      fi
      return 0
      ;;
    bootout)
      BOOTOUT_DONE=1
      return 0
      ;;
  esac
  return 0
}
sleep() {
  SLEEP_CALLS=$((SLEEP_CALLS + 1))
  printf 'sleep %s\\n' "$1" >> "${dir}/launchctl.log"
  return 0
}
rm() {
  printf 'rm %s gone=%s sleeps=%s\\n' "$*" "$LAUNCHD_GONE" "$SLEEP_CALLS" >> "${dir}/ops.log"
  command rm -- "$2"
  command rm "$@"
}
${block}
`,
        "utf8",
      );
      const result = await execFileAsync("/bin/sh", [script], {
        env: {
          ...process.env,
          HOME: dir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          BUILDER_BLOG_ACCOUNT: "",
          BUILDER_BLOG_AGENT_DIR: agentDir,
          LABEL: label,
        },
      });
      assert.match(result.stdout, new RegExp(`launchd absent: ${label}`));
      assert.match(result.stdout, new RegExp(`plist absent: ${plist.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));
      assert.doesNotMatch(result.stdout, /STILL LOADED|STILL PLIST/);
      await assert.rejects(readFile(plist, "utf8"), /ENOENT/);
      const launchctlLog = await readFile(join(dir, "launchctl.log"), "utf8");
      assert.match(launchctlLog, /^bootout gui\//m);
      assert.equal((launchctlLog.match(/^sleep 1$/gm) ?? []).length, 2);
      const opsLog = await readFile(join(dir, "ops.log"), "utf8");
      assert.match(opsLog, /^rm -- .* gone=1 sleeps=2$/m);
      const nodeLog = await readFile(join(dir, "node.log"), "utf8");
      assert.match(nodeLog, /launchd_bootout_start/);
      assert.match(nodeLog, /launchd_bootout_finished/);
      assert.match(nodeLog, /--launchctl-loaded 0/);
      assert.match(nodeLog, /launchd_remove_plist/);
      assert.ok(nodeLog.indexOf("launchd_bootout_finished") < nodeLog.indexOf("launchd_remove_plist"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("regular local launchd stop waits for absence before removing plist after nonzero bootout", async () => {
  for (const [job, promptPath, label] of [
    ["library-cron", "skills/builder-blog-digest/jobs/library-cron-stop.md", "com.followbrief.library.test_bootout_nonzero"],
    ["digest-cron", "skills/builder-blog-digest/jobs/digest-cron-stop.md", "com.followbrief.digest.test_bootout_nonzero"],
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), `fb-${job}-stop-nonzero-wait-`));
    try {
      const plistDir = join(dir, "Library", "LaunchAgents");
      const fakeBin = join(dir, "fake-bin");
      const agentDir = join(dir, ".builder-blog");
      const plist = join(plistDir, `${label}.plist`);
      await mkdir(plistDir, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(plist, "<plist />\n", "utf8");
      await writeFile(join(agentDir, "builder-digest.mjs"), "// stub\n", "utf8");
      await writeFile(
        join(fakeBin, "node"),
        `#!/bin/sh
if [ "$#" -ge 2 ] && [ "$2" = "cron-audit" ]; then
  case "$1" in
    */builder-digest.mjs)
      printf '%s\\n' "$*" >> "${dir}/node.log"
      exit 0
      ;;
  esac
fi
echo "unexpected node call: $*" >&2
exit 91
`,
        "utf8",
      );
      await execFileAsync("chmod", ["+x", join(fakeBin, "node")]);
      const prompt = await readFile(promptPath, "utf8");
      const block = regularLocalStopBlock(prompt, job);
      const script = join(dir, "check.sh");
      await writeFile(
        script,
        `set -eu
SLEEP_CALLS=0
BOOTOUT_DONE=0
LAUNCHD_GONE=0
launchctl() {
  printf '%s\\n' "$*" >> "${dir}/launchctl.log"
  case "$1" in
    print)
      if [ "$BOOTOUT_DONE" -eq 1 ] && [ "$SLEEP_CALLS" -ge 2 ]; then
        LAUNCHD_GONE=1
        return 1
      fi
      return 0
      ;;
    bootout)
      BOOTOUT_DONE=1
      return 42
      ;;
  esac
  return 0
}
sleep() {
  SLEEP_CALLS=$((SLEEP_CALLS + 1))
  printf 'sleep %s\\n' "$1" >> "${dir}/launchctl.log"
  return 0
}
rm() {
  printf 'rm %s gone=%s sleeps=%s\\n' "$*" "$LAUNCHD_GONE" "$SLEEP_CALLS" >> "${dir}/ops.log"
  command rm "$@"
}
${block}
`,
        "utf8",
      );
      const result = await execFileAsync("/bin/sh", [script], {
        env: {
          ...process.env,
          HOME: dir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          BUILDER_BLOG_ACCOUNT: "",
          BUILDER_BLOG_AGENT_DIR: agentDir,
          LABEL: label,
        },
      });
      assert.match(result.stdout, new RegExp(`launchd absent: ${label}`));
      assert.doesNotMatch(result.stdout, /STILL LOADED|STILL PLIST/);
      await assert.rejects(readFile(plist, "utf8"), /ENOENT/);
      const launchctlLog = await readFile(join(dir, "launchctl.log"), "utf8");
      assert.match(launchctlLog, /^bootout gui\//m);
      assert.equal((launchctlLog.match(/^sleep 1$/gm) ?? []).length, 2);
      const opsLog = await readFile(join(dir, "ops.log"), "utf8");
      assert.match(opsLog, /^rm -- .* gone=1 sleeps=2$/m);
      const nodeLog = await readFile(join(dir, "node.log"), "utf8");
      assert.match(nodeLog, /launchd_bootout_start/);
      assert.match(nodeLog, /launchd_bootout_finished/);
      assert.match(nodeLog, /--reason exit_42/);
      assert.match(nodeLog, /--launchctl-loaded 0/);
      assert.match(nodeLog, /launchd_remove_plist/);
      assert.ok(nodeLog.indexOf("launchd_bootout_finished") < nodeLog.indexOf("launchd_remove_plist"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("regular local launchd stop times out before cleanup", async () => {
  for (const [job, promptPath, label] of [
    ["library-cron", "skills/builder-blog-digest/jobs/library-cron-stop.md", "com.followbrief.library.test_timeout"],
    ["digest-cron", "skills/builder-blog-digest/jobs/digest-cron-stop.md", "com.followbrief.digest.test_timeout"],
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), `fb-${job}-stop-timeout-`));
    try {
      const plistDir = join(dir, "Library", "LaunchAgents");
      const fakeBin = join(dir, "fake-bin");
      const agentDir = join(dir, ".builder-blog");
      const plist = join(plistDir, `${label}.plist`);
      await mkdir(plistDir, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(plist, "<plist />\n", "utf8");
      await writeFile(join(agentDir, "builder-digest.mjs"), "// stub\n", "utf8");
      await writeFile(
        join(fakeBin, "node"),
        `#!/bin/sh
if [ "$#" -ge 2 ] && [ "$2" = "cron-audit" ]; then
  case "$1" in
    */builder-digest.mjs)
      printf '%s\\n' "$*" >> "${dir}/node.log"
      exit 0
      ;;
  esac
fi
echo "unexpected node call: $*" >&2
exit 91
`,
        "utf8",
      );
      await execFileAsync("chmod", ["+x", join(fakeBin, "node")]);
      const prompt = await readFile(promptPath, "utf8");
      const block = regularLocalStopBlock(prompt, job);
      const script = join(dir, "check.sh");
      await writeFile(
        script,
        `set -eu
SLEEP_CALLS=0
launchctl() {
  printf '%s\\n' "$*" >> "${dir}/launchctl.log"
  case "$1" in
    print) return 0 ;;
    bootout) return 0 ;;
  esac
  return 0
}
sleep() {
  SLEEP_CALLS=$((SLEEP_CALLS + 1))
  printf 'sleep %s\\n' "$1" >> "${dir}/launchctl.log"
  return 0
}
rm() {
  printf 'rm %s\\n' "$*" >> "${dir}/ops.log"
  command rm "$@"
}
${block}
`,
        "utf8",
      );
      await assert.rejects(
        execFileAsync("/bin/sh", [script], {
          env: {
            ...process.env,
            HOME: dir,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            BUILDER_BLOG_ACCOUNT: "",
            BUILDER_BLOG_AGENT_DIR: agentDir,
            LABEL: label,
          },
        }),
        (error: unknown) => {
          const failure = error as { code?: number; stdout?: string; stderr?: string };
          assert.equal(failure.code, 75);
          assert.match(`${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, /timed out waiting for launchd to go absent/i);
          assert.doesNotMatch(`${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, /launchd absent:|STILL LOADED:|plist absent:|STILL PLIST:/);
          return true;
        },
      );
      assert.equal(await readFile(plist, "utf8"), "<plist />\n");
      const launchctlLog = await readFile(join(dir, "launchctl.log"), "utf8");
      assert.match(launchctlLog, /^bootout gui\//m);
      assert.equal((launchctlLog.match(/^sleep 1$/gm) ?? []).length, 30);
      await assert.rejects(readFile(join(dir, "ops.log"), "utf8"), /ENOENT/);
      const nodeLog = await readFile(join(dir, "node.log"), "utf8");
      assert.match(nodeLog, /launchd_bootout_start/);
      assert.match(nodeLog, /launchd_bootout_finished/);
      assert.match(nodeLog, /--launchctl-loaded 1/);
      assert.doesNotMatch(nodeLog, /launchd_remove_plist/);
      assert.ok(nodeLog.indexOf("launchd_bootout_start") < nodeLog.indexOf("launchd_bootout_finished"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("regular local launchd stop times out before cleanup after nonzero bootout", async () => {
  for (const [job, promptPath, label] of [
    ["library-cron", "skills/builder-blog-digest/jobs/library-cron-stop.md", "com.followbrief.library.test_timeout_nonzero"],
    ["digest-cron", "skills/builder-blog-digest/jobs/digest-cron-stop.md", "com.followbrief.digest.test_timeout_nonzero"],
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), `fb-${job}-stop-timeout-nonzero-`));
    try {
      const plistDir = join(dir, "Library", "LaunchAgents");
      const fakeBin = join(dir, "fake-bin");
      const agentDir = join(dir, ".builder-blog");
      const plist = join(plistDir, `${label}.plist`);
      await mkdir(plistDir, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(plist, "<plist />\n", "utf8");
      await writeFile(join(agentDir, "builder-digest.mjs"), "// stub\n", "utf8");
      await writeFile(
        join(fakeBin, "node"),
        `#!/bin/sh
if [ "$#" -ge 2 ] && [ "$2" = "cron-audit" ]; then
  case "$1" in
    */builder-digest.mjs)
      printf '%s\\n' "$*" >> "${dir}/node.log"
      exit 0
      ;;
  esac
fi
echo "unexpected node call: $*" >&2
exit 91
`,
        "utf8",
      );
      await execFileAsync("chmod", ["+x", join(fakeBin, "node")]);
      const prompt = await readFile(promptPath, "utf8");
      const block = regularLocalStopBlock(prompt, job);
      const script = join(dir, "check.sh");
      await writeFile(
        script,
        `set -eu
SLEEP_CALLS=0
launchctl() {
  printf '%s\\n' "$*" >> "${dir}/launchctl.log"
  case "$1" in
    print) return 0 ;;
    bootout) return 42 ;;
  esac
  return 0
}
sleep() {
  SLEEP_CALLS=$((SLEEP_CALLS + 1))
  printf 'sleep %s\\n' "$1" >> "${dir}/launchctl.log"
  return 0
}
rm() {
  printf 'rm %s\\n' "$*" >> "${dir}/ops.log"
  command rm "$@"
}
${block}
`,
        "utf8",
      );
      await assert.rejects(
        execFileAsync("/bin/sh", [script], {
          env: {
            ...process.env,
            HOME: dir,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            BUILDER_BLOG_ACCOUNT: "",
            BUILDER_BLOG_AGENT_DIR: agentDir,
            LABEL: label,
          },
        }),
        (error: unknown) => {
          const failure = error as { code?: number; stdout?: string; stderr?: string };
          assert.equal(failure.code, 75);
          assert.match(`${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, /timed out waiting for launchd to go absent/i);
          return true;
        },
      );
      assert.equal(await readFile(plist, "utf8"), "<plist />\n");
      const launchctlLog = await readFile(join(dir, "launchctl.log"), "utf8");
      assert.match(launchctlLog, /^bootout gui\//m);
      assert.equal((launchctlLog.match(/^sleep 1$/gm) ?? []).length, 30);
      await assert.rejects(readFile(join(dir, "ops.log"), "utf8"), /ENOENT/);
      const nodeLog = await readFile(join(dir, "node.log"), "utf8");
      assert.match(nodeLog, /launchd_bootout_start/);
      assert.match(nodeLog, /launchd_bootout_finished/);
      assert.match(nodeLog, /--reason exit_42/);
      assert.match(nodeLog, /--launchctl-loaded 1/);
      assert.doesNotMatch(nodeLog, /launchd_remove_plist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("cloud host control keeps the marker when an exact worker cannot be terminated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-terminate-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-1", workerPid: 4242, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 0; }
terminate_process_tree() { return 1; }
job_run_update_for_instance() { printf '%s\\n' "$4" >> "${dir}/updates"; return 0; }
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await assert.rejects(execFileAsync("sh", [script]));
    assert.equal(JSON.parse(await readFile(currentFile, "utf8")).instanceId, "host-1");
    await assert.rejects(readFile(join(dir, "updates"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("strict job updates classify only the exact reset-fenced diagnostic and clean up capture files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-strict-job-update-reset-fenced-"));
  try {
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `set -eu
JOB_STATE_DIR="${dir}/state"
mkdir -p "$JOB_STATE_DIR"
JOB_UPDATE_RESET_FENCED=78
${shellFunction(runner, "job_update_error_is_reset_fenced")}
${shellFunction(runner, "strict_job_run_update_for_instance")}
case_name=""
stub_code=0
stub_diagnostic=""
job_run_update_for_instance() {
  printf '%s\\n' "\${BUILDER_BLOG_JOB_UPDATE_ERROR_FILE:-}" > "${dir}/capture-path"
  if [ -n "\${BUILDER_BLOG_JOB_UPDATE_ERROR_FILE:-}" ] && [ -n "$stub_diagnostic" ]; then
    printf '%s\\n' "$stub_diagnostic" > "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"
  fi
  return "$stub_code"
}
assert_case() {
  case_name="$1"
  stub_code="$2"
  stub_diagnostic="$3"
  expected_code="$4"
  prior_error_file="$5"
  if [ "$prior_error_file" = "__unset__" ]; then
    unset BUILDER_BLOG_JOB_UPDATE_ERROR_FILE
  else
    BUILDER_BLOG_JOB_UPDATE_ERROR_FILE="$prior_error_file"
    export BUILDER_BLOG_JOB_UPDATE_ERROR_FILE
  fi
  set +e
  strict_job_run_update_for_instance host-1 2026-07-20T00:00:00Z 2026-07-20T00:00:00Z stale summary reason --stage stopped
  actual_code=$?
  set -e
  [ "$actual_code" -eq "$expected_code" ] || {
    echo "$case_name returned $actual_code instead of $expected_code" >&2
    exit 21
  }
  if [ "$prior_error_file" = "__unset__" ]; then
    if [ "\${BUILDER_BLOG_JOB_UPDATE_ERROR_FILE+x}" = "x" ]; then
      echo "$case_name unexpectedly left BUILDER_BLOG_JOB_UPDATE_ERROR_FILE set" >&2
      exit 22
    fi
  else
    [ "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE" = "$prior_error_file" ] || {
      echo "$case_name did not restore BUILDER_BLOG_JOB_UPDATE_ERROR_FILE" >&2
      exit 23
    }
  fi
  capture_path="$(cat "${dir}/capture-path")"
  [ -n "$capture_path" ] || {
    echo "$case_name did not receive a per-call capture path" >&2
    exit 24
  }
  [ ! -e "$capture_path" ] || {
    echo "$case_name left capture file behind: $capture_path" >&2
    exit 25
  }
}
assert_case \
  exact-reset-fenced \
  1 \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' \
  78 \
  "${dir}/existing-error.log"
assert_case \
  retryable-conflict \
  17 \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":true}' \
  17 \
  "__unset__"
assert_case \
  malformed-line \
  19 \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409}' \
  19 \
  "${dir}/second-error.log"
assert_case \
  missing-diagnostic \
  23 \
  "" \
  23 \
  "__unset__"
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release helper accepts only released outcomes, classifies exact reset fences, and cleans temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-release-helper-cases-"));
  try {
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `set -eu
JOB_STATE_DIR="${dir}/state"
AGENT_DIR="${dir}/agent"
mkdir -p "$JOB_STATE_DIR" "$AGENT_DIR"
JOB_UPDATE_RESET_FENCED=78
${shellFunction(runner, "json_get_number")}
${shellFunction(runner, "json_get_string")}
${shellFunction(runner, "job_update_error_is_reset_fenced")}
${shellFunction(runner, "parse_cloud_worker_release_result")}
${shellFunction(runner, "release_cloud_worker_leases_for_instance")}
stub_code=0
stub_stdout=""
stub_stderr=""
node() {
  if [ "$1" = "-" ]; then command node "$@"; return "$?"; fi
  printf '%s\\n' "$*" > "${dir}/args.log"
  if [ -n "$stub_stdout" ]; then
    printf '%s\\n' "$stub_stdout"
  fi
  if [ -n "$stub_stderr" ]; then
    printf '%s\\n' "$stub_stderr" >&2
  fi
  return "$stub_code"
}
assert_case() {
  case_name="$1"
  stub_code="$2"
  stub_stdout="$3"
  stub_stderr="$4"
  expected_code="$5"
  expected_stdout_pattern="$6"
  expected_stderr_pattern="$7"
  rm -f "${dir}/args.log" "${dir}/case.out" "${dir}/case.err"
  before_count="$(find "$JOB_STATE_DIR" -type f | wc -l | tr -d ' ')"
  set +e
  release_cloud_worker_leases_for_instance host-1 > "${dir}/case.out" 2> "${dir}/case.err"
  actual_code="$?"
  set -e
  [ "$actual_code" = "$expected_code" ] || {
    echo "$case_name returned $actual_code instead of $expected_code" >&2
    exit 31
  }
  grep -F 'builder-digest.mjs release-cloud-fetch --job-run-id host-1' "${dir}/args.log" >/dev/null || exit 32
  after_count="$(find "$JOB_STATE_DIR" -type f | wc -l | tr -d ' ')"
  [ "$before_count" = "$after_count" ] || exit 33
  if [ -n "$expected_stdout_pattern" ]; then
    grep -E "$expected_stdout_pattern" "${dir}/case.out" >/dev/null || exit 34
  elif [ -s "${dir}/case.out" ]; then
    exit 35
  fi
  if [ -n "$expected_stderr_pattern" ]; then
    grep -E "$expected_stderr_pattern" "${dir}/case.err" >/dev/null || exit 36
  elif [ -s "${dir}/case.err" ]; then
    exit 37
  fi
}
assert_case \
  released \
  0 \
  '{"outcome":"released","releasedRuns":1,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  0 \
  '1.*2.*3' \
  ''
assert_case \
  already-released \
  0 \
  '{"outcome":"already_released","releasedRuns":0,"releasedSourceTasks":0,"requeuedQueueItems":0}' \
  '' \
  0 \
  '0.*0.*0' \
  ''
assert_case \
  reset-fenced \
  1 \
  '' \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' \
  78 \
  '' \
  ''
assert_case \
  job-not-found \
  1 \
  '' \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"cloud_release_job_not_found","retryable":false}' \
  1 \
  '' \
  'cloud_release_job_not_found'
assert_case \
  auth \
  1 \
  '' \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":401,"syncCode":"http_status","responseCode":"unauthorized","retryable":false}' \
  1 \
  '' \
  'unauthorized'
assert_case \
  malformed-response \
  0 \
  '{"outcome":"released","releasedRuns":1,"releasedSourceTasks":2,"requeuedQueueItems":3' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  exponent-count \
  0 \
  '{"outcome":"released","releasedRuns":1e2,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  negative-count \
  0 \
  '{"outcome":"released","releasedRuns":-1,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  fractional-count \
  0 \
  '{"outcome":"released","releasedRuns":1.5,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  string-count \
  0 \
  '{"outcome":"released","releasedRuns":"1","releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  out-of-bound-count \
  0 \
  '{"outcome":"released","releasedRuns":2147483648,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  extra-top-level-key \
  0 \
  '{"outcome":"released","releasedRuns":1,"releasedSourceTasks":2,"requeuedQueueItems":3,"extra":4}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  duplicate-count \
  0 \
  '{"outcome":"released","releasedRuns":1,"releasedRuns":2,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  duplicate-outcome \
  0 \
  '{"outcome":"released","outcome":"already_released","releasedRuns":1,"releasedSourceTasks":2,"requeuedQueueItems":3}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  unsupported-outcome \
  0 \
  '{"outcome":"unexpected","releasedRuns":1,"releasedSourceTasks":1,"requeuedQueueItems":1}' \
  '' \
  1 \
  '' \
  'malformed response'
assert_case \
  generic-409 \
  1 \
  '' \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"other_conflict","retryable":false}' \
  1 \
  '' \
  'other_conflict'
assert_case \
  retryable-reset-fence \
  1 \
  '' \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":true}' \
  1 \
  '' \
  'retryable'
assert_case \
  network \
  1 \
  '' \
  'FOLLOWBRIEF_ERROR {"type":"http_sync","status":null,"syncCode":"network","responseCode":null,"retryable":null}' \
  1 \
  '' \
  'network'
if release_cloud_worker_leases_for_instance "" >/dev/null 2>"${dir}/missing.err"; then
  exit 38
fi
grep -E 'job run id|instance' "${dir}/missing.err" >/dev/null || exit 39
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release helper restores umask and cleans partial temp files when the second mktemp fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-release-helper-mktemp-"));
  try {
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `set -eu
JOB_STATE_DIR="${dir}/state"
AGENT_DIR="${dir}/agent"
mkdir -p "$JOB_STATE_DIR" "$AGENT_DIR"
${shellFunction(runner, "job_update_error_is_reset_fenced")}
${shellFunction(runner, "parse_cloud_worker_release_result")}
${shellFunction(runner, "release_cloud_worker_leases_for_instance")}
node() {
  printf 'called\\n' >> "${dir}/node.log"
  return 0
}
mktemp() {
  if [ ! -e "${dir}/mktemp-first.done" ]; then
    : > "${dir}/mktemp-first.done"
    _path="${dir}/state/first-temp"
    : > "$_path"
    printf '%s\\n' "$_path"
    return 0
  fi
  printf 'mktemp failed\\n' >&2
  return 1
}
umask 022
before_umask="$(umask)"
set +e
release_cloud_worker_leases_for_instance host-1 > "${dir}/case.out" 2> "${dir}/case.err"
code="$?"
set -e
[ "$code" -ne 0 ] || exit 41
[ "$(umask)" = "$before_umask" ] || exit 42
[ ! -e "${dir}/state/first-temp" ] || exit 43
[ -z "$(find "$JOB_STATE_DIR" -type f -print)" ] || exit 44
[ ! -e "${dir}/node.log" ] || exit 45
grep -E 'mktemp|temp|release' "${dir}/case.err" >/dev/null || exit 46
[ ! -s "${dir}/case.out" ] || exit 47
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control escalates the cached descendant set after the runner root exits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-descendants-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-tree", workerPid: 4242, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
${shellFunction(runner, "terminate_recorded_process_ids")}
verify_calls=0
verify_followbrief_pid() { verify_calls=$((verify_calls + 1)); [ "$verify_calls" -eq 1 ]; }
process_tree_pids() { printf '4242\\n4343\\n'; }
terminate_process_tree() { return 1; }
terminate_recorded_process_ids() { printf '%s\\n' "$1" > "${dir}/killed"; return 0; }
job_run_update_for_instance() { printf '%s\\n' "$4" >> "${dir}/updates"; return 0; }
release_cloud_worker_leases_for_instance() {
  [ -r "${currentFile}" ] || exit 41
  printf 'release\\n' >> "${dir}/updates"
  return 0
}
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    assert.equal((await readFile(join(dir, "updates"), "utf8")).trim(), "killed\nrelease");
    assert.equal((await readFile(join(dir, "killed"), "utf8")).trim(), "4242 4343");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control never kills a live pid that is not the recorded FollowBrief runner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-recycled-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-2", workerPid: 5252, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 1; }
kill() { return 0; }
terminate_process_tree() { touch "${dir}/terminated"; return 0; }
job_run_update_for_instance() { printf '%s\\n' "$4" >> "${dir}/updates"; return 0; }
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    await assert.rejects(readFile(join(dir, "terminated"), "utf8"));
    assert.equal((await readFile(join(dir, "updates"), "utf8")).trim(), "stale");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control treats a matching runner argv with a different process start as pid reuse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-runner-reuse-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-reused", workerPid: 5353, processStartEpoch: 100, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 0; }
process_start_epoch() { printf '200\\n'; }
kill() { return 0; }
terminate_process_tree() { touch "${dir}/terminated"; return 0; }
job_run_update_for_instance() { printf '%s\\n' "$4" >> "${dir}/updates"; return 0; }
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    await assert.rejects(readFile(join(dir, "terminated"), "utf8"));
    assert.equal((await readFile(join(dir, "updates"), "utf8")).trim(), "stale");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control reconciles a dead worker after an exact reset-fenced stop-current update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-dead-reset-fenced-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-dead", workerPid: 5454, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 1; }
kill() { [ "$1" = "-0" ] && return 1; return 1; }
terminate_process_tree() { printf 'terminated\\n' >> "${dir}/signals"; return 0; }
job_run_update_for_instance() {
  printf 'stale\\n' >> "${dir}/updates"
  printf '%s\\n' 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' > "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"
  return 1
}
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    const result = await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    await assert.rejects(readFile(join(dir, "signals"), "utf8"));
    assert.equal((await readFile(join(dir, "updates"), "utf8")).trim(), "stale");
    assert.match(result.stdout, /reset-fenced stale cloud-library-host worker host-dead/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control reconciles an exact live worker after reset-fenced stop-current cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-live-reset-fenced-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-live", workerPid: 6464, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_calls=0
verify_followbrief_pid() {
  verify_calls=$((verify_calls + 1))
  [ "$verify_calls" -eq 1 ]
}
process_tree_pids() { printf '6464\\n'; }
terminate_process_tree() { printf 'terminate\\n' >> "${dir}/order"; return 0; }
job_run_update_for_instance() {
  printf 'update\\n' >> "${dir}/order"
  printf '%s\\n' 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' > "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"
  return 1
}
release_cloud_worker_leases_for_instance() { printf 'release\\n' >> "${dir}/order"; return 0; }
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    const result = await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    assert.equal((await readFile(join(dir, "order"), "utf8")).trim(), "terminate\nupdate");
    assert.match(result.stdout, /reset-fenced cloud-library-host worker host-live/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control releases only after an exact live worker reaches terminal status and clears last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-live-release-order-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-live-release", workerPid: 6767, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_calls=0
verify_followbrief_pid() {
  verify_calls=$((verify_calls + 1))
  [ "$verify_calls" -eq 1 ]
}
process_tree_pids() { printf '6767\\n'; }
terminate_process_tree() { printf 'terminate\\n' >> "${dir}/order"; return 0; }
job_run_update_for_instance() {
  [ -r "${currentFile}" ] || exit 41
  printf 'update\\n' >> "${dir}/order"
  return 0
}
release_cloud_worker_leases_for_instance() {
  [ -r "${currentFile}" ] || exit 42
  printf 'release\\n' >> "${dir}/order"
  return 0
}
clear_current_file() {
  [ "$(json_get_string instanceId "$1")" = "$2" ] || exit 43
  printf 'clear\\n' >> "${dir}/order"
  rm -f "$1"
}
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    assert.equal((await readFile(join(dir, "order"), "utf8")).trim(), "terminate\nupdate\nrelease\nclear");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control reconciles a reused pid only after an exact reset-fenced stop-current update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-reused-reset-fenced-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-reused-reset", workerPid: 6565, processStartEpoch: 100, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 0; }
process_start_epoch() { printf '200\\n'; }
kill() {
  if [ "$1" = "-0" ] && [ "$2" = "6565" ]; then
    return 0
  fi
  printf '%s\\n' "$*" >> "${dir}/signals"
  return 1
}
terminate_process_tree() { printf 'terminated\\n' >> "${dir}/signals"; return 0; }
job_run_update_for_instance() {
  printf 'stale\\n' >> "${dir}/updates"
  printf '%s\\n' 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' > "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"
  return 1
}
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    const result = await execFileAsync("sh", [script]);
    await assert.rejects(readFile(currentFile, "utf8"));
    await assert.rejects(readFile(join(dir, "signals"), "utf8"));
    assert.equal((await readFile(join(dir, "updates"), "utf8")).trim(), "stale");
    assert.match(result.stdout, /reset-fenced stale cloud-library-host worker host-reused-reset/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control preserves current.json when the terminal status update fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-status-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-3", workerPid: 6262, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 1; }
kill() { return 1; }
terminate_process_tree() { return 0; }
job_run_update_for_instance() { return 1; }
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await assert.rejects(execFileAsync("sh", [script]));
    assert.equal(JSON.parse(await readFile(currentFile, "utf8")).instanceId, "host-3");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control keeps current.json when release fails after a successful terminal update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-release-failure-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-release-fail", workerPid: 6868, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 1; }
kill() { [ "$1" = "-0" ] && return 1; return 1; }
job_run_update_for_instance() { printf 'update\\n' >> "${dir}/order"; return 0; }
release_cloud_worker_leases_for_instance() { printf 'release\\n' >> "${dir}/order"; return 19; }
cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await assert.rejects(execFileAsync("sh", [script]));
    assert.equal(JSON.parse(await readFile(currentFile, "utf8")).instanceId, "host-release-fail");
    assert.equal((await readFile(join(dir, "order"), "utf8")).trim(), "update\nrelease");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control keeps the marker for non-reset-fenced stop-current update failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-stop-current-failures-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-failure", workerPid: 6666, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 1; }
kill() { [ "$1" = "-0" ] && return 1; return 1; }
stub_code=1
stub_diagnostic=""
assert_case() {
  case_name="$1"
  stub_code="$2"
  stub_diagnostic="$3"
  rm -f "${currentFile}"
  printf '%s\\n' '${JSON.stringify({ instanceId: "host-failure", workerPid: 6666, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}' > "${currentFile}"
  set +e
  cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host >/dev/null 2>> "${dir}/errors"
  actual_code=$?
  set -e
  [ "$actual_code" -ne 0 ] || {
    echo "$case_name unexpectedly succeeded" >&2
    exit 31
  }
  [ -r "${currentFile}" ] || {
    echo "$case_name removed the marker" >&2
    exit 32
  }
}
job_run_update_for_instance() {
  if [ -n "$stub_diagnostic" ]; then
    printf '%s\\n' "$stub_diagnostic" > "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"
  fi
  return "$stub_code"
}
assert_case generic-409 17 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"other_conflict","retryable":false}'
assert_case auth-401 18 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":401,"syncCode":"http_status","responseCode":"unauthorized","retryable":false}'
assert_case missing-diagnostic 23 ''
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud host control reconciles dead and reused workers before release, and clears only if the marker still matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-stale-release-order-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_case=""
verify_followbrief_pid() {
  [ "$verify_case" = "reused" ]
}
process_start_epoch() {
  if [ "$verify_case" = "reused" ]; then
    printf '200\\n'
    return 0
  fi
  printf '100\\n'
}
kill() {
  if [ "$1" = "-0" ] && [ "$2" = "6969" ]; then
    [ "$verify_case" = "reused" ]
    return $?
  fi
  printf '%s\\n' "$*" >> "${dir}/signals"
  return 1
}
terminate_process_tree() { printf 'terminated\\n' >> "${dir}/signals"; return 0; }
job_run_update_for_instance() {
  [ -r "${currentFile}" ] || exit 51
  printf 'update|%s\\n' "$4" >> "${dir}/order"
  return 0
}
release_cloud_worker_leases_for_instance() {
  [ -r "${currentFile}" ] || exit 52
  printf 'release\\n' >> "${dir}/order"
  if [ "$verify_case" = "reused" ]; then
    printf '%s\\n' '${JSON.stringify({ instanceId: "replacement", workerPid: 7000, startedAt: "2026-07-21T00:00:00Z", expectedAt: "2026-07-21T00:00:00Z" })}' > "${currentFile}"
  fi
  return 0
}
clear_current_file() {
  printf 'clear|%s|%s\\n' "$(json_get_string instanceId "$1")" "$2" >> "${dir}/order"
  if [ "$(json_get_string instanceId "$1")" = "$2" ]; then
    rm -f "$1"
  fi
}
assert_case() {
  verify_case="$1"
  rm -f "${dir}/signals" "${dir}/order" "${currentFile}"
  case "$verify_case" in
    dead)
      printf '%s\\n' '{"instanceId":"host-dead-release","workerPid":6969,"startedAt":"2026-07-20T00:00:00Z","expectedAt":"2026-07-20T00:00:00Z"}' > "${currentFile}"
      ;;
    reused)
      printf '%s\\n' '{"instanceId":"host-reused-release","workerPid":6969,"processStartEpoch":100,"startedAt":"2026-07-20T00:00:00Z","expectedAt":"2026-07-20T00:00:00Z"}' > "${currentFile}"
      ;;
    *)
      exit 64
      ;;
  esac
  cloud_host_control_current_file stop-current "${currentFile}" cloud-library-host >/dev/null
}
assert_case dead
[ ! -e "${currentFile}" ] || exit 53
[ ! -e "${dir}/signals" ] || exit 54
grep '^update|stale$' "${dir}/order" >/dev/null || exit 55
grep '^release$' "${dir}/order" >/dev/null || exit 56
grep '^clear|host-dead-release|host-dead-release$' "${dir}/order" >/dev/null || exit 57
assert_case reused
[ -r "${currentFile}" ] || exit 58
[ "$(json_get_string instanceId "${currentFile}")" = "replacement" ] || exit 59
[ ! -e "${dir}/signals" ] || exit 60
grep '^update|stale$' "${dir}/order" >/dev/null || exit 61
grep '^release$' "${dir}/order" >/dev/null || exit 62
grep '^clear|replacement|host-reused-release$' "${dir}/order" >/dev/null || exit 63
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mark-replaced records the live host without terminating it or clearing its marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-replace-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    await writeFile(
      currentFile,
      `${JSON.stringify({ instanceId: "host-4", workerPid: 7272, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}\n`,
      "utf8",
    );
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_followbrief_pid() { return 0; }
terminate_process_tree() { touch "${dir}/terminated"; return 0; }
job_run_update_for_instance() { printf '%s\\n' "$4" >> "${dir}/updates"; return 0; }
release_cloud_worker_leases_for_instance() { printf 'release\\n' >> "${dir}/updates"; return 0; }
cloud_host_control_current_file mark-replaced "${currentFile}" cloud-library-host
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
    assert.equal(JSON.parse(await readFile(currentFile, "utf8")).instanceId, "host-4");
    await assert.rejects(readFile(join(dir, "terminated"), "utf8"));
    assert.equal((await readFile(join(dir, "updates"), "utf8")).trim(), "replaced");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mark-replaced never accepts reset-fenced reconciliation for live, dead, or reused workers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-host-control-replace-reset-fenced-"));
  try {
    const currentFile = join(dir, "current.json");
    const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
    const script = join(dir, "check.sh");
    await writeFile(
      script,
      `${cloudHostControlHarnessPrelude(runner, dir)}
verify_case=""
verify_followbrief_pid() {
  [ "$verify_case" = "live" ]
}
process_start_epoch() {
  if [ "$verify_case" = "reused" ]; then
    printf '200\\n'
    return 0
  fi
  printf '100\\n'
}
kill() {
  if [ "$1" = "-0" ] && [ "$2" = "7777" ]; then
    [ "$verify_case" = "reused" ]
    return $?
  fi
  printf '%s\\n' "$*" >> "${dir}/signals"
  return 1
}
terminate_process_tree() { printf 'terminated\\n' >> "${dir}/signals"; return 0; }
job_run_update_for_instance() {
  printf '%s\\n' "$4" >> "${dir}/updates"
  printf '%s\\n' 'FOLLOWBRIEF_ERROR {"type":"http_sync","status":409,"syncCode":"http_status","responseCode":"agent_job_reset_fenced","retryable":false}' > "$BUILDER_BLOG_JOB_UPDATE_ERROR_FILE"
  return 1
}
release_cloud_worker_leases_for_instance() {
  printf 'release\\n' >> "${dir}/signals"
  return 0
}
assert_case() {
  verify_case="$1"
  rm -f "${dir}/signals" "${dir}/updates"
  printf '%s\\n' "${2}" > "${currentFile}"
  set +e
  cloud_host_control_current_file mark-replaced "${currentFile}" cloud-library-host >/dev/null 2>> "${dir}/errors"
  actual_code=$?
  set -e
  [ "$actual_code" -ne 0 ] || {
    echo "$verify_case unexpectedly succeeded" >&2
    exit 41
  }
  [ -r "${currentFile}" ] || {
    echo "$verify_case removed the marker" >&2
    exit 42
  }
  [ ! -e "${dir}/signals" ] || {
    echo "$verify_case signaled another process" >&2
    exit 43
  }
}
assert_case live '${JSON.stringify({ instanceId: "host-live-reset", workerPid: 7777, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}'
assert_case dead '${JSON.stringify({ instanceId: "host-dead-reset", workerPid: 7777, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}'
assert_case reused '${JSON.stringify({ instanceId: "host-reused-reset", workerPid: 7777, processStartEpoch: 100, startedAt: "2026-07-20T00:00:00Z", expectedAt: "2026-07-20T00:00:00Z" })}'
`,
      "utf8",
    );
    await execFileAsync("sh", [script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud source readiness check is read-only and verifies deployment prerequisites", async () => {
  const script = await readFile("scripts/check-cloud-source-fetch-readiness.mts", "utf8");
  const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron.md", "utf8");

  assert.match(script, /000080_cloud_source_fetch/);
  assert.match(script, /CloudFetchQueueItem_active_task_key/);
  assert.match(script, /cloudLanguageLibrary\.findMany/);
  assert.match(script, /adminEmails/);
  assert.match(prompt, /check-cloud-source-fetch-readiness\.mts --language zh/);
  assert.match(prompt, /It must report `ready`/);
  assert.doesNotMatch(script, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(script, /\$executeRaw/);
});

test("cloud rollback smoke exercises the DB flow inside one rolled-back transaction", async () => {
  const script = await readFile("scripts/smoke-cloud-source-fetch-rollback.mts", "utf8");
  const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron.md", "utf8");

  assert.match(script, /prisma\.\$transaction/);
  assert.match(script, /throw new SmokeRollback\(\)/);
  assert.match(script, /submitUserPrivateLibraryToCloud/);
  assert.match(script, /cloudFetchQueueItem\.create/);
  assert.match(script, /leaseCloudFetchTasks/);
  assert.match(script, /lease\.tasks\[0\]\?\.cloudSourceTaskId !== task\.id/);
  assert.match(script, /syncBuilderFeedItems/);
  assert.match(script, /applyCloudFetchTaskSyncResult/);
  assert.match(script, /upsertSourceCandidateFromCloudBuilder/);
  assert.match(script, /remainingUsers/);
  assert.match(prompt, /smoke-cloud-source-fetch-rollback\.mts --language zh/);
});

test("cloud submission contract lets admins submit platform-maintained sources while rejecting ordinary users", async () => {
  const route = await readFile("src/app/api/cloud-library/source-submissions/route.ts", "utf8");
  const library = await readFile("src/lib/cloud-source-library.ts", "utf8");
  const skillPromptActions = await readFile("src/components/SkillPromptActions.tsx", "utf8");
  const buildersPage = await readFile("src/app/(workspace)/builders/page.tsx", "utf8");

  assert.match(library, /platform_managed_source/);
  assert.match(library, /FollowBrief already maintains this source\./);
  assert.match(library, /allowPlatformMaintainedSources/);
  assert.match(route, /isAdminEmail\(session\.user\.email\)/);
  assert.match(route, /allowPlatformMaintainedSources: userIsAdmin/);
  assert.match(route, /code: error\.code/);
  assert.match(skillPromptActions, /Maintained by FollowBrief/);
  assert.match(skillPromptActions, /platformMaintained/);
  assert.match(skillPromptActions, /cloudSelectable/);
  assert.match(skillPromptActions, /submitAllBuilderIds/);
  assert.match(buildersPage, /platformMaintained: isPlatformMaintainedSourceType\(builder\.sourceType\)/);
});
