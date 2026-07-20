import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

async function loadAgentJobRunsModule() {
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/builder_blog_test";
  return import("../src/lib/agent-job-runs");
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
  assert.match(route, /lockResetFenceForNewWorker\(tx\)/);
  assert.match(route, /lockResetFenceForNewWorker\(tx\)[\s\S]*newRunCreatedAt = await databaseClockNow\(tx\)/);
  assert.match(route, /createdAt: newRunCreatedAt!/);
  assert.match(route, /lockResetFenceForWorker\(tx, existingRun\.createdAt\)/);
  assert.doesNotMatch(route, /lockResetFenceForWorker\(tx, startedAt\)/);
  assert.doesNotMatch(route, /userId_instanceId/);
  assert.match(route, /MAX_DETAILS_BYTES = 50_000/);

  assert.match(cli, /job-run-start/);
  assert.match(cli, /job-run-update/);
  assert.match(cli, /\/api\/skill\/job-runs/);
  assert.match(cli, /function exitCodeOrNull/);
  assert.match(cli, /exitCode: exitCodeOrNull\(argValue\(args, "--exit-code", ""\)\)/);
  assert.match(cli, /runtimeUsageFromFile\(argValue\(args, "--usage-file", null\)\)/);
  assert.match(cli, /BUILDER_BLOG_JOB_RUN_ID/);
  assert.match(cli, /hermes: "Hermes"/);
  assert.match(cli, /case "Hermes":[\s\S]*return detectedHermesModel\(\)/);
  assert.match(cli, /function detectedHermesModel\(\)/);
  assert.match(cli, /process\.env\.HERMES_MODEL/);
  assert.match(cli, /process\.env\.HERMES_CONFIG_PATH/);
  assert.doesNotMatch(cli, /Gemini CLI|detectedGeminiModel|GEMINI_MODEL/);

  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /LAST_AGENT_OUTPUT_FILE/);
  assert.match(runner, /job_run_update failed "Runtime exited with code \$_code\." "runtime_finished" \\\n\s+--exit-code "\$_code"/);
  assert.match(runner, /job_run_update timed_out "Runtime reported a timeout\." "runtime_reported_timeout" \\\n\s+--exit-code "\$_code"/);
  assert.match(runner, /job_run_update succeeded "Runtime completed successfully\." "runtime_finished" \\\n\s+--stage "completed" \\\n\s+--exit-code "\$_code"/);
  assert.match(runner, /BUILDER_BLOG_AGENT_MODEL="\$\{BUILDER_BLOG_CODEX_MODEL:-gpt-5\.4-mini\}"/);
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
  assert.match(fetchRuns, /lockResetFenceForWorker\(tx, jobRun\.createdAt\)/);
  assert.doesNotMatch(fetchRuns, /lockResetFenceForWorker\(tx, startedAt\)/);
  assert.match(fetchRunPatch, /select: \{[\s\S]*createdAt: true/);
  assert.match(fetchRunPatch, /lockResetFenceForWorker\(tx, run\.createdAt\)/);
  assert.match(builders, /select: \{ id: true, details: true, createdAt: true \}/);
  assert.match(builders, /lockResetFenceForWorker\(tx, run\.createdAt\)/);
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
  assert.match(cli, /filterSyncPayloadToTaskIds/);
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
  assert.match(runner, /_hermes_output="\$\(agent_output_file hermes\)"/);
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
  assert.match(runner, /_fltr_recovery_dir="\$JOB_TMP_DIR\/debug\/recovery"/);
  assert.match(runner, /_fltr_result_file="\$_fltr_recovery_dir\/library-fetch-result\.json"/);
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
  assert.match(runner, /finalize_library_timeout_results\(\)/);
  assert.match(runner, /runtime_timeout_flush_started/);
  assert.match(runner, /job_run_update running "Runtime timed out; syncing terminal library results\." "runtime_timeout_flush_started"/);
  assert.match(runner, /runtime_timeout_no_fetch_result/);
  assert.match(
    runner,
    /tracked_job_signal_cleanup\(\)[\s\S]*terminate_process_tree "\$RUNTIME_PID" TERM 10 \|\| true\s+wait "\$RUNTIME_PID" 2>\/dev\/null \|\| true[\s\S]*cleanup_job_tmp_dir killed/,
  );
  assert.match(runner, /job_run_update running "Runtime exceeded timeout and will be terminated\." "timeout_seconds_for_job"/);
  assert.match(runner, /job_run_update running "Runtime timed out; cleanup started\." "timeout_seconds_for_job"/);
  assert.doesNotMatch(runner, /job_run_update timed_out "Runtime exceeded timeout and will be terminated\." "timeout_seconds_for_job"/);
  assert.match(runner, /mkdir -p "\$_fltr_results_dir"/);
  assert.doesNotMatch(runner, /\[ -d "\$_fltr_results_dir" \] \|\| return 0/);
  assert.match(runner, /flush_remaining_library_results "\$_fltr_result_file"/);
  assert.match(runner, /"runtime-timeout" "runtime_timeout"/);
  assert.match(runner, /--default-missing-reason \$_frlr_missing_reason/);
  assert.match(runner, /_frlr_sync_command="\$\{SYNC_BUILDERS_COMMAND:-\}"/);
  assert.match(runner, /append-fetch-run-terminal-task-ids[\s\S]*--out "\$_frlr_synced_ids_file"/);
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
  assert.match(
    runner,
    /Codex auth is missing access_token[\s\S]*hermes auth[\s\S]*hermes model/,
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
  assert.match(workerPrompt, /extraction_exceeds_shard_timeout/);
  assert.match(workerPrompt, /Do NOT use any subagent, nested agent, secondary session, or delegation/);
  assert.match(workerPrompt, /including Claude Task\/subagent tools,[\s\S]*`codex exec`, `claude -p`, `openclaw agent`/);
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
  assert.match(runner, /-name 'fetch-\*'/);
  assert.match(runner, /-name 'youtube-asr'/);
  assert.match(runner, /cloud_host_signal_cleanup\(\)[\s\S]*terminate_job_tmp_processes TERM 3[\s\S]*cleanup_job_tmp_dir killed "worker_host_interrupted"/);
  assert.match(runner, /run_cloud_worker_host\(\)[\s\S]*cleanup_job_tmp_dir "\$_cleanup_status" "\$_cleanup_reason"[\s\S]*cleanup_old_job_runs/);
  assert.match(runner, /cloud_host_sleep_with_heartbeat[\s\S]*cleanup_transient_job_artifacts/);
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
  assert.match(fetchRoute, /agentJobRun\.findMany/);
  assert.match(digestRoute, /jobRuns/);
  assert.match(digestRoute, /scheduledJobRuns/);
  assert.match(digestRoute, /agentJobRun\.findMany/);
});
