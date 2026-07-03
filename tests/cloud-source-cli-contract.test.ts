import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    },
  );

  assert.equal(task.cloudRunId, "cloud_run_1");
  assert.equal(task.cloudSourceTaskId, "cloud_task_1");
  assert.equal(task.summaryLanguage, "zh");
  assert.equal(task.builderSync.cloudSourceTaskId, "cloud_task_1");
  assert.equal(task.builderSync.builderId, "cloud_builder_zh");
  assert.equal(task.summaryInstructions.language, "zh");
  assert.match(task.summaryInstructions.prompt, /Chinese|zh|中文/);
  assert.equal(task.type, "fetch_post");
});

test("cloud fetch command is exposed and keeps worker-facing task shape", async () => {
  const cliSource = await readFile("scripts/builder-digest.mjs", "utf8");

  assert.match(cliSource, /fetch-cloud-library \[--limit 10\]/);
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
  assert.doesNotMatch(cliSource, /user private-library builders are selected by cloud command/);
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
  assert.match(runner, /for _wafg_entry in \$\{_worker_entries:-\}/);
  assert.match(runner, /_worker_entries="\$\{_worker_entries:-\} \$!:\$\(date \+%s\):\$_slw_shard_name:\$_slw_lane_id"/);
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

test("cloud worker host keeps its job heartbeat fresh while fetch workers run", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /_last_job_run_heartbeat=0/);
  assert.match(
    runner,
    /job_run_update running "Running source fetch workers\." "heartbeat"[\s\S]*--stage "run_fetch_workers"/,
  );
  assert.match(runner, /_last_job_run_heartbeat="\$_now"/);
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

  assert.match(prompt, /Do NOT start background commands or tool calls/);
  assert.match(prompt, /run_in_background/);
  assert.match(prompt, /Long[\s\S]*transcription[\s\S]*must run in the[\s\S]*foreground/);
  assert.match(prompt, /BUILDER_BLOG_SHARD_TIMEOUT_SECONDS/);
  assert.match(prompt, /extraction_exceeds_shard_timeout/);
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

  assert.doesNotMatch(actions, /cloud-library-once/);
  assert.doesNotMatch(actions, /FREQUENCY_OPTIONS/);
  assert.doesNotMatch(actions, /params\.set\("freq"/);
  assert.match(actions, /Copy worker host prompt/);
  assert.match(actions, /Copy stop cloud fetch prompt/);
  assert.doesNotMatch(actions, /cloud-run-cloud-limit/);
  assert.match(actions, /cloud-run-post-limit/);
  assert.match(actions, /cloud-run-fetch-days/);
  assert.match(actions, /cloud-run-parallel-workers/);
  assert.doesNotMatch(actions, /params\.set\("cloudLimit"/);
  assert.match(actions, /params\.set\("postLimit"/);
  assert.match(actions, /params\.set\("days"/);
  assert.match(actions, /params\.set\("parallel"/);

  assert.doesNotMatch(route, /boundedIntegerParam\(url\.searchParams, "cloudLimit", 10, 1, 100\)/);
  assert.match(route, /boundedIntegerParam\(url\.searchParams, "postLimit", 3, 1, 20\)/);
  assert.doesNotMatch(route, /\{\{CLOUD_FETCH_LIMIT\}\}/);
  assert.match(route, /\{\{FETCH_LIMIT\}\}/);
  assert.match(fileRoute, /builder-blog-cloud-library-host\.md/);
  assert.match(fileRoute, /skills\/builder-blog-digest\/jobs\/cloud-library-host\.md/);
  assert.match(bootstrapRoute, /builder-blog-cloud-library-host\.md/);
  assert.match(bootstrapRoute, /jobs\/cloud-library-host\.md/);
  assert.match(jobFiles, /"cloud-library-host":/);
  assert.match(jobFiles, /cloud-library-host\.md/);
  assert.match(jobFiles, /"cloud-library-cron-stop":/);
  assert.match(jobFiles, /cloud-library-cron-stop\.md/);

  for (const prompt of [setupPrompt, cronPrompt, hostPrompt]) {
    assert.doesNotMatch(prompt, /\{\{CLOUD_FETCH_LIMIT\}\}/);
    assert.match(prompt, /\{\{FETCH_LIMIT\}\}/);
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
  assert.match(setupPrompt, /POST_LIMIT="\$\{BUILDER_BLOG_FETCH_LIMIT-\{\{FETCH_LIMIT\}\}\}"/);
  assert.match(setupPrompt, /FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-\{\{FETCH_DAYS\}\}\}"/);
  assert.match(setupPrompt, /WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-\{\{PARALLEL_WORKERS\}\}\}"/);
  assert.match(
    setupPrompt,
    /BUILDER_BLOG_AGENT_DIR="\$AGENT_DIR" BUILDER_BLOG_AGENT_RUNTIME="\$RUNTIME" BUILDER_BLOG_RUN_SOURCE=cloud BUILDER_BLOG_FETCH_LIMIT="\$POST_LIMIT" BUILDER_BLOG_FETCH_DAYS="\$FETCH_DAYS" BUILDER_BLOG_PARALLEL_WORKERS="\$WORKERS" BUILDER_BLOG_CLOUD_IDLE_SECONDS="\$IDLE_SECONDS" "\$AGENT_DIR\/builder-agent-runner\.sh" cloud-library-host/,
  );
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
  assert.match(script, /leaseCloudFetchTasks/);
  assert.match(script, /syncBuilderFeedItems/);
  assert.match(script, /applyCloudFetchTaskSyncResult/);
  assert.match(script, /upsertSourceCandidateFromCloudBuilder/);
  assert.match(script, /remainingUsers/);
  assert.match(prompt, /smoke-cloud-source-fetch-rollback\.mts --language zh/);
});
