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

test("runner supervises cron workers instead of skipping active old instances", () => {
  const runner = source("scripts/builder-agent-runner.sh");

  assert.match(runner, /run_cron_supervisor/);
  assert.match(runner, /run_cron_worker/);
  assert.match(runner, /BUILDER_BLOG_WORKER_MODE=1/);
  assert.match(runner, /INSTANCE_ID=/);
  assert.match(runner, /CURRENT_FILE=/);
  assert.match(runner, /clear_current_file/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$BUILDER_BLOG_WORKER_PID"/);
  assert.match(runner, /Scheduled worker running in launchd foreground/);
  assert.match(runner, /set \+e[\s\S]*run_cron_worker[\s\S]*_code="\$\?"/);
  assert.match(runner, /verify_followbrief_pid/);
  assert.match(runner, /terminate_process_tree/);
  assert.match(runner, /next_schedule_arrived/);
  assert.match(runner, /status replaced/);
  assert.match(runner, /status killed/);
  assert.match(runner, /HEARTBEAT_INTERVAL_SECONDS=60/);
  assert.match(runner, /timeout_seconds_for_job/);
  assert.match(runner, /library-cron\)[\s\S]*120 \* 60/);
  assert.match(runner, /digest-cron\)[\s\S]*45 \* 60/);
  assert.match(runner, /20 \* 60/);
  assert.doesNotMatch(runner, /skipping duplicate cron launch/);
  assert.doesNotMatch(runner, /\)\s*>> "\$LOG_FILE" 2>&1 &/);
  assert.doesNotMatch(runner, /WORKER_PID="\$!"/);
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
