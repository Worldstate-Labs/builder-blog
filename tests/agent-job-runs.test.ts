import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

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
  assert.match(route, /z\.enum\(\["library-fetch", "digest-build"\]\)/);
  assert.match(route, /z\.enum\(\["scheduled", "one_time", "manual_cli"\]\)/);
  assert.match(
    route,
    /z\.enum\(\["starting", "running", "succeeded", "failed", "timed_out", "killed", "replaced", "stale"\]\)/,
  );
  assert.match(route, /agentJobRun\.findFirst/);
  assert.match(route, /userId: user\.id,[\s\S]*jobType: parsed\.data\.jobType,[\s\S]*instanceId: parsed\.data\.instanceId/);
  assert.match(route, /mergeAgentJobRunLifecycle/);
  assert.match(route, /isTerminalAgentJobStatus/);
  assert.match(route, /select: \{ id: true, details: true, status: true, finishedAt: true, exitCode: true, signal: true, stage: true, summary: true \}/);
  assert.match(route, /agentJobRun\.update/);
  assert.match(route, /agentJobRun\.create/);
  assert.doesNotMatch(route, /userId_instanceId/);
  assert.match(route, /MAX_DETAILS_BYTES = 50_000/);

  assert.match(cli, /job-run-start/);
  assert.match(cli, /job-run-update/);
  assert.match(cli, /\/api\/skill\/job-runs/);
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
  assert.match(runner, /--usage-file/);
});

test("terminal agent job runs cannot be regressed by late runtime updates", () => {
  const route = source("src/app/api/skill/job-runs/route.ts");

  assert.match(route, /TERMINAL_AGENT_JOB_STATUSES/);
  assert.match(route, /existingRun && isTerminalAgentJobStatus\(existingRun\.status\)/);
  assert.match(route, /status: existingRun\.status/);
  assert.match(route, /finishedAt: existingRun\.finishedAt/);
  assert.match(route, /exitCode: existingRun\.exitCode/);
  assert.match(route, /signal: existingRun\.signal/);
});

test("library fetch job runs carry bounded live progress without schema churn", () => {
  const cli = source("scripts/builder-digest.mjs");
  const panel = source("src/components/FetchLogPanel.tsx");
  const route = source("src/app/api/skill/job-runs/route.ts");

  assert.match(cli, /FETCH_PROGRESS_VERSION = 1/);
  assert.match(cli, /FETCH_PROGRESS_RECENT_EVENT_LIMIT = 60/);
  assert.match(cli, /FETCH_PROGRESS_SOURCE_LIMIT = 120/);
  assert.match(cli, /FETCH_PROGRESS_TASK_LIMIT = 120/);
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
  assert.match(cli, /filterFetchResultToTaskIds/);
  assert.match(cli, /filterSyncPayloadToTaskIds/);
  assert.match(cli, /backfillMissing: !completedOnly/);
  assert.match(cli, /completedTaskIds/);
  assert.match(cli, /includeInternal/);
  assert.match(cli, /progress: fetchProgressSnapshotValue/);
  assert.match(cli, /tasks: Array\.isArray\(progress\.tasks\)/);
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
  assert.match(panel, /function readFetchJobProgress/);
  assert.match(panel, /function fetchTaskProgressMap/);
  assert.match(panel, /function JobLifecycle/);
  assert.match(panel, /function LifecyclePipeline/);
  assert.match(panel, /liveTask=\{task\.id \? liveTasks\.get\(task\.id\) \?\? null : null\}/);
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
  assert.match(route, /existingRun\?\.details/);
  assert.match(route, /merged\.progress = current\.progress/);
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
  assert.match(runner, /cleanup_job_tmp_dir/);
  assert.match(runner, /cleanup_old_job_runs/);
  assert.match(runner, /tracked_job_signal_cleanup\(\)[\s\S]*terminate_process_tree "\$RUNTIME_PID" TERM 10/);
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
  assert.match(runner, /merge-task-results[\s\S]*tee "\$_merge_result_file"/);
  assert.match(runner, /checkpoint-progress[\s\S]*--results-dir "\$_results_dir"/);
  assert.match(runner, /sync_completed_checkpoints/);
  assert.match(runner, /completed-checkpoint-synced-task-ids\.txt/);
  assert.match(runner, /merge-task-results[\s\S]*--completed-only/);
  assert.match(runner, /Best-effort syncing \$_scc_count completed library task/);
  assert.match(runner, /backfilledOutcomes/);
  assert.match(runner, /worker\/result issue\(s\)/);
  assert.doesNotMatch(runner, /WORKER_PID="\$!"/);
  assert.doesNotMatch(runner, /rm -rf "\$JOB_STATE_DIR"/);
  assert.doesNotMatch(runner, /rm -rf "\$AGENT_DIR\/tmp"/);
  assert.doesNotMatch(runner, /rm -rf "\$AGENT_DIR\/tmp\/accounts"/);

  assert.match(workerPrompt, /Live progress checkpoints/);
  assert.match(workerPrompt, /\$BUILDER_BLOG_SHARD_CHECKPOINT_DIR\/progress\/<hash>\.json/);
  assert.match(workerPrompt, /under the `progress\/`[\s\S]*subdirectory/);
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
  assert.doesNotMatch(digestPanel, />\s*AI Digest build history\s*<\/h2>/);
  assert.doesNotMatch(digestPanel, /Build history/);

  assert.match(fetchRoute, /jobRuns/);
  assert.match(fetchRoute, /scheduledJobRuns/);
  assert.match(fetchRoute, /agentJobRun\.findMany/);
  assert.match(digestRoute, /jobRuns/);
  assert.match(digestRoute, /scheduledJobRuns/);
  assert.match(digestRoute, /agentJobRun\.findMany/);
});
