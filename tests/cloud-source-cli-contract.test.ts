import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  assert.match(cliSource, /split-sync-slices --tasks fetch-result\.json[\s\S]*source\|task\|cloud-run/);
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
  const bootstrapRoute = await readFile("src/app/api/skill/bootstrap/route.ts", "utf8");
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(fileRoute, /"cloud-shard-budget\.mjs"/);
  assert.match(fileRoute, /path: "scripts\/cloud-shard-budget\.mjs"/);
  assert.match(bootstrapRoute, /api\/skill\/files\/cloud-shard-budget\.mjs/);
  assert.match(bootstrapRoute, /"\$AGENT_DIR\/cloud-shard-budget\.mjs"/);
  assert.match(runner, /api\/skill\/files\/cloud-shard-budget\.mjs/);
  assert.match(runner, /"\$AGENT_DIR\/cloud-shard-budget\.mjs"/);
});

test("cloud library runner reuses the library worker pipeline with cloud fetch and sync commands", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

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
  assert.match(runner, /SYNC_PAYLOAD_SLICE_GRANULARITY="cloud-run"/);
  assert.match(
    runner,
    /sync_completed_checkpoints\(\) \{[\s\S]*SYNC_PAYLOAD_SLICE_GRANULARITY="task"[\s\S]*sync_payload_slices "\$_scc_tasks" "\$_scc_payload"/,
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
  assert.match(runner, /_worker_entries="\$\{_worker_entries:-\} \$!:\$\(date \+%s\):\$_slw_shard_name:\$_slw_lane_id"/);
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
  assert.match(runner, /builder-blog-cloud-library-host\.md" "\$AGENT_DIR\/jobs\/cloud-library-host\.md"/);
  assert.doesNotMatch(runner, /BUILDER_BLOG_CLOUD_HOST_CHILD/);
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
  const start = runner.indexOf("sync_cloud_terminal_outcomes() {");
  const end = runner.indexOf("\ncloud_run_id_from_result() {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const dir = await mkdtemp(join(tmpdir(), "fb-cloud-planned-only-helper-"));
  try {
    const valid = join(dir, "valid.json");
    const empty = join(dir, "empty.json");
    const invalid = join(dir, "invalid.json");
    const syncLog = join(dir, "sync.log");
    const checkPath = join(dir, "check.sh");
    await writeFile(valid, JSON.stringify({
      cloudRunId: "cloud_run_1",
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "task_failed",
        status: "failed",
        reason: "workload_exceeds_max_budget",
        plannedTask: { id: "task_failed", cloudSourceTaskId: "source_1" },
      }],
    }));
    await writeFile(empty, JSON.stringify({ cloudRunId: "cloud_run_2", fetchTasks: [], taskOutcomes: [] }));
    await writeFile(invalid, "{");
    await writeFile(
      checkPath,
      `set -eu
${runner.slice(start, end)}
_sync_command=sync-cloud-builders
AGENT_DIR="${dir}"
SYNC_LOG="${syncLog}"
SYNC_EXIT_CODE=0
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

test("cloud library runner syncs planned-only zero-task outcomes once before returning no_update", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_cloud_terminal_outcomes() {");
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

test("cloud library runner skips planned-only sync when zero-task result has no syncable outcomes", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");
  const start = runner.indexOf("sync_cloud_terminal_outcomes() {");
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
  const start = runner.indexOf("sync_cloud_terminal_outcomes() {");
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
  const start = runner.indexOf("sync_cloud_terminal_outcomes() {");
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
  assert.match(prompt, /Long[\s\S]*transcription[\s\S]*must run in the[\s\S]*foreground/);
  assert.match(prompt, /BUILDER_BLOG_SHARD_TIMEOUT_SECONDS/);
  assert.match(prompt, /extraction_exceeds_shard_timeout/);
  assert.match(prompt, /extract-long-media/);
  assert.match(prompt, /Do not hand-roll yt-dlp, ffmpeg, whisper, or fixed-timeout shell commands/);
  assert.match(prompt, /estimatedWorkSeconds\/executionBudgetSeconds/);
  assert.match(prompt, /media duration/);
  assert.match(prompt, /attempted methods/);
  assert.doesNotMatch(prompt, /cat "\$BUILDER_BLOG_SHARD_FILE"/);
  assert.match(prompt, /compact task queue/);
  assert.match(prompt, /process one task at a time/);
  assert.match(prompt, /Started reading this task/);
  assert.match(prompt, /TASK_FILE="\$BUILDER_BLOG_SHARD_CHECKPOINT_DIR\/task-\$TASK_HASH\.json"/);
});

test("cloud copy prompt settings flow into the local cloud runner command", async () => {
  const actions = await readFile("src/components/AdminCloudFetchRunActions.tsx", "utf8");
  const route = await readFile("src/app/api/skill/jobs/[job]/skill.md/route.ts", "utf8");
  const fileRoute = await readFile("src/app/api/skill/files/[file]/route.ts", "utf8");
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
  assert.match(actions, /params\.set\("days"/);
  assert.match(actions, /params\.set\("parallel"/);

  assert.doesNotMatch(route, /boundedIntegerParam\(url\.searchParams, "cloudLimit", 10, 1, 100\)/);
  assert.match(route, /boundedIntegerParam\(url\.searchParams, "postLimit", 3, 1, 20\)/);
  assert.match(route, /const parallelDefault = 10/);
  assert.match(route, /const parallelMax = 20/);
  assert.doesNotMatch(route, /\{\{CLOUD_FETCH_LIMIT\}\}/);
  assert.match(route, /\{\{FETCH_LIMIT\}\}/);
  assert.match(fileRoute, /builder-blog-cloud-library-host\.md/);
  assert.match(fileRoute, /skills\/builder-blog-digest\/jobs\/cloud-library-host\.md/);
  assert.match(fileRoute, /replaceAll\("\{\{PARALLEL_WORKERS\}\}", "10"\)/);
  assert.doesNotMatch(fileRoute, /asset\.path\.includes\("cloud-library"\) \? "1"/);
  assert.match(bootstrapRoute, /builder-blog-cloud-library-host\.md/);
  assert.match(bootstrapRoute, /jobs\/cloud-library-host\.md/);
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
  assert.match(stopPrompt, /--job-type cloud-library-fetch/);
  assert.match(stopPrompt, /--status killed/);
  assert.match(stopPrompt, /--stage stopped/);
  assert.doesNotMatch(stopPrompt, /cron-status/);
  assert.doesNotMatch(stopPrompt, /--schedule-job cloud-library-cron/);
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
