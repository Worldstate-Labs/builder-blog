import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFetchTimeline,
  getFetchUpdateStatus,
  type LibraryCronJobStatus,
  type LibraryFetchRunListItem,
} from "../src/components/FetchLogPanel";
import type { AgentJobRunListItem } from "../src/lib/agent-job-runs";

test("one-time setup validation does not hide missed scheduled fetch windows", () => {
  const cronJob: LibraryCronJobStatus = {
    id: "cron_1",
    status: "active",
    startedAt: "2026-06-18T12:00:00.000Z",
    stoppedAt: null,
    frequencyKey: "1h",
    frequencyLabel: "every hour",
    schedule: "interval:3600",
    intervalMinutes: 60,
    runtime: "codex",
    overrideFetched: false,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    updatedAt: "2026-06-18T12:00:00.000Z",
  };
  const missedSlot = {
    expectedAt: "2026-06-18T15:00:00.000Z",
    windowEnd: "2026-06-18T16:00:00.000Z",
    status: "missed" as const,
    run: null,
    jobRun: null,
  };
  const setupJob: AgentJobRunListItem = {
    id: "job_1",
    jobType: "library-fetch",
    trigger: "one_time",
    scheduleJob: "library-cron",
    instanceId: "setup-1",
    expectedAt: "2026-06-18T16:20:00.000Z",
    startedAt: "2026-06-18T16:20:00.000Z",
    heartbeatAt: "2026-06-18T16:22:00.000Z",
    finishedAt: null,
    status: "running",
    exitCode: null,
    signal: null,
    runtime: "codex",
    runnerPid: 123,
    workerPid: 123,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: "runtime_agent_started",
    summary: "Runtime heartbeat.",
    details: {},
    updatedAt: "2026-06-18T16:22:00.000Z",
  };
  const setupRun: LibraryFetchRunListItem = {
    id: "run_1",
    startedAt: "2026-06-18T16:20:00.000Z",
    finishedAt: "2026-06-18T16:20:03.000Z",
    durationMs: 3000,
    status: "partial",
    source: "manual",
    jobRunId: setupJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 4,
    itemsFetched: 8,
    tasksGenerated: 8,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Setup validation",
    details: { fetchTasks: [{ id: "task_1", status: "pending" }] },
  };

  const status = getFetchUpdateStatus(cronJob, [missedSlot], [setupRun], [setupJob]);

  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Needs attention");
  assert.match(status.summary, /No Fetch sources run started/);
});

test("stale scheduled fetch run with pending tasks does not stay syncing", () => {
  const cronJob: LibraryCronJobStatus = {
    id: "cron_1",
    status: "active",
    startedAt: "2026-06-18T03:43:58.627Z",
    stoppedAt: null,
    frequencyKey: "1h",
    frequencyLabel: "every hour",
    schedule: "interval:3600",
    intervalMinutes: 60,
    runtime: "codex",
    overrideFetched: false,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    updatedAt: "2026-06-18T03:44:21.983Z",
  };
  const staleJob: AgentJobRunListItem = {
    id: "job_1",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "20260618T044334-52527",
    expectedAt: "2026-06-18T04:43:34.000Z",
    startedAt: "2026-06-18T04:44:29.000Z",
    heartbeatAt: "2026-06-18T05:04:19.000Z",
    finishedAt: null,
    status: "running",
    exitCode: null,
    signal: null,
    runtime: "codex",
    runnerPid: 52527,
    workerPid: 52527,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: null,
    summary: "Runtime heartbeat.",
    details: {},
    updatedAt: "2026-06-18T05:04:45.492Z",
  };
  const staleRun: LibraryFetchRunListItem = {
    id: "run_1",
    startedAt: "2026-06-18T04:44:44.747Z",
    finishedAt: "2026-06-18T04:45:28.753Z",
    durationMs: 44_006,
    status: "ok",
    source: "cron",
    jobRunId: staleJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 13,
    itemsFetched: 0,
    tasksGenerated: 4,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 0 new posts from 13 sources",
    details: { fetchTasks: [{ id: "task_1", status: "pending" }] },
  };
  const stalledSlot = {
    expectedAt: "2026-06-18T04:43:34.000Z",
    windowEnd: "2026-06-18T05:43:34.000Z",
    status: "stalled" as const,
    run: staleRun,
    jobRun: staleJob,
  };

  const status = getFetchUpdateStatus(cronJob, [stalledSlot], [staleRun], [staleJob]);

  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Needs attention");
  assert.match(status.summary, /lost contact/);
});

test("fetch timeline opens the specific run bound to a scheduled slot", () => {
  const sharedJob: AgentJobRunListItem = {
    id: "job_latest",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "runtime-latest",
    expectedAt: "2026-06-20T13:00:00.000Z",
    startedAt: "2026-06-20T13:00:10.000Z",
    heartbeatAt: "2026-06-20T13:04:00.000Z",
    finishedAt: null,
    status: "running",
    exitCode: null,
    signal: null,
    runtime: "codex",
    runnerPid: 123,
    workerPid: 123,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: "runtime_agent_started",
    summary: "Runtime heartbeat.",
    details: {},
    updatedAt: "2026-06-20T13:04:00.000Z",
  };
  const olderRun: LibraryFetchRunListItem = {
    id: "run_1hr",
    startedAt: "2026-06-20T12:00:10.000Z",
    finishedAt: "2026-06-20T12:01:00.000Z",
    durationMs: 50_000,
    status: "ok",
    source: "cron",
    jobRunId: null,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 6,
    itemsFetched: 1,
    tasksGenerated: 1,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Older scheduled run",
    details: { fetchTasks: [{ id: "fetch_post:older", status: "pending" }] },
  };
  const latestRun: LibraryFetchRunListItem = {
    ...olderRun,
    id: "run_5min",
    startedAt: "2026-06-20T13:00:10.000Z",
    finishedAt: "2026-06-20T13:01:00.000Z",
    summary: "Latest scheduled run",
    jobRunId: sharedJob.instanceId,
  };

  const entries = buildFetchTimeline({
    jobRuns: [sharedJob],
    runs: [latestRun, olderRun],
    slots: [
      {
        expectedAt: "2026-06-20T12:00:00.000Z",
        windowEnd: "2026-06-20T13:00:00.000Z",
        status: "running",
        run: olderRun,
        jobRun: sharedJob,
      },
      {
        expectedAt: "2026-06-20T13:00:00.000Z",
        windowEnd: "2026-06-20T14:00:00.000Z",
        status: "running",
        run: latestRun,
        jobRun: sharedJob,
      },
    ],
    nowMs: Date.parse("2026-06-20T13:05:00.000Z"),
  });

  const olderEntry = entries.find((entry) => entry.time === "2026-06-20T12:00:00.000Z");

  assert.deepEqual(olderEntry?.logRef, { kind: "run", runId: "run_1hr" });
});
