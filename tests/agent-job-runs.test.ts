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
  assert.match(schema, /@@unique\(\[userId, instanceId\]\)/);
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
  assert.match(route, /agentJobRun\.upsert/);
  assert.match(route, /MAX_DETAILS_BYTES = 50_000/);

  assert.match(cli, /job-run-start/);
  assert.match(cli, /job-run-update/);
  assert.match(cli, /\/api\/skill\/job-runs/);
  assert.match(cli, /BUILDER_BLOG_JOB_RUN_ID/);
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
  assert.match(cli, /stage: "syncing"/);
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
  assert.match(runner, /BUILDER_BLOG_WORKER_MODE=1/);
  assert.match(runner, /BUILDER_BLOG_SCHEDULER_TICK/);
  assert.match(runner, /due_expected_at/);
  assert.match(runner, /scheduler_last_fired_file/);
  assert.match(runner, /schedule-anchor-\$JOB_NAME-\$ACCOUNT_SLUG/);
  assert.match(runner, /INSTANCE_ID=/);
  assert.match(runner, /CURRENT_FILE=/);
  assert.match(runner, /clear_current_file/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$BUILDER_BLOG_WORKER_PID"/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$WORKER_PID"/);
  assert.match(runner, /Scheduled worker running in launchd foreground/);
  assert.match(runner, /Scheduled worker launched by local scheduler tick/);
  assert.match(runner, /set \+e[\s\S]*run_cron_worker[\s\S]*_code="\$\?"/);
  assert.match(runner, /verify_followbrief_pid/);
  assert.match(runner, /terminate_process_tree/);
  assert.match(runner, /process_tree_pids/);
  assert.match(runner, /still_alive_after_kill/);
  assert.match(runner, /skipped-wait-pids/);
  assert.match(runner, /job_run_update_for_instance/);
  assert.match(runner, /OLD_STARTED="\$\(json_get_string startedAt "\$CURRENT_FILE"\)"/);
  assert.match(runner, /OLD_EXPECTED="\$\(json_get_string expectedAt "\$CURRENT_FILE"\)"/);
  assert.match(runner, /next_schedule_arrived/);
  assert.match(runner, /status replaced/);
  assert.match(runner, /status killed/);
  assert.match(runner, /HEARTBEAT_INTERVAL_SECONDS=60/);
  assert.match(runner, /timeout_seconds_for_job/);
  assert.match(runner, /library-cron\)[\s\S]*75 \* 60/);
  assert.match(runner, /digest-cron\)[\s\S]*45 \* 60/);
  assert.match(runner, /20 \* 60/);
  assert.match(runner, /agent_output_has_timeout/);
  assert.match(runner, /agent_output_file\(\)/);
  assert.match(runner, /mktemp "\$JOB_TMP_DIR\/\$_runtime-agent-output\.XXXXXX"/);
  assert.doesNotMatch(runner, /mktemp "\$JOB_TMP_DIR\/\$_runtime-agent-output\.XXXXXX\.log"/);
  assert.match(runner, /_codex_output="\$\(agent_output_file codex\)"/);
  assert.match(runner, /_claude_output="\$\(agent_output_file claude\)"/);
  assert.match(runner, /_openclaw_output="\$\(agent_output_file openclaw\)"/);
  assert.match(runner, /_gemini_output="\$\(agent_output_file gemini\)"/);
  assert.doesNotMatch(runner, /agent-output-\$\$\.log/);
  assert.match(runner, /Request timed out before a response was generated/);
  assert.match(runner, /codex app-server turn idle timed out/);
  assert.match(runner, /DEADLINE_EXCEEDED/);
  assert.doesNotMatch(runner, /skipping duplicate cron launch/);
  assert.doesNotMatch(runner, /\)\s*>> "\$LOG_FILE" 2>&1 &/);
  assert.match(runner, /WORKER_PID="\$!"/);
  assert.match(runner, /merge-task-results[\s\S]*tee "\$_merge_result_file"/);
  assert.match(runner, /checkpoint-progress[\s\S]*--results-dir "\$_results_dir"/);
  assert.match(runner, /sync_completed_checkpoints/);
  assert.match(runner, /completed-checkpoint-synced-task-ids\.txt/);
  assert.match(runner, /merge-task-results[\s\S]*--completed-only/);
  assert.match(runner, /Best-effort syncing \$_scc_count completed library task/);
  assert.match(runner, /backfilledOutcomes/);
  assert.match(runner, /worker\/result issue\(s\)/);

  assert.match(workerPrompt, /Live progress checkpoints/);
  assert.match(workerPrompt, /\$BUILDER_BLOG_SHARD_CHECKPOINT_DIR\/progress\/<hash>\.json/);
  assert.match(workerPrompt, /under the `progress\/`[\s\S]*subdirectory/);
});

test("web status uses scheduled job instances while history can show one-time runs", () => {
  const fetchPanel = source("src/components/FetchLogPanel.tsx");
  const digestPanel = source("src/components/DigestLogPanel.tsx");
  const fetchRoute = source("src/app/api/skill/fetch-runs/route.ts");
  const digestRoute = source("src/app/api/digest-runs/route.ts");

  for (const panel of [fetchPanel, digestPanel]) {
    assert.match(panel, /AgentJobRunListItem/);
    assert.match(panel, /trigger === "scheduled"/);
    assert.match(panel, /Scheduled/);
    assert.match(panel, /One-time/);
    assert.match(panel, /Stalled/);
    assert.match(panel, /timed_out|timed out/);
  }
  assert.match(fetchPanel, /Fetch sources run history/);
  assert.match(digestPanel, /Build log/);
  assert.match(digestPanel, /AI Digest build history/);
  assert.doesNotMatch(digestPanel, /Build history/);

  assert.match(fetchRoute, /jobRuns/);
  assert.match(fetchRoute, /scheduledJobRuns/);
  assert.match(fetchRoute, /agentJobRun\.findMany/);
  assert.match(digestRoute, /jobRuns/);
  assert.match(digestRoute, /scheduledJobRuns/);
  assert.match(digestRoute, /agentJobRun\.findMany/);
});
