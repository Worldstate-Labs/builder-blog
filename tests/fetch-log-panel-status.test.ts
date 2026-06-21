import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFetchTimeline,
  fetchCronFrequencyLabel,
  fetchRunDisplayState,
  fetchRunStats,
  getFetchActivityStatus,
  getFetchUpdateStatus,
  type LibraryCronJobStatus,
  type LibraryFetchRunListItem,
} from "../src/components/FetchLogPanel";
import type { AgentJobRunListItem } from "../src/lib/agent-job-runs";

function activeCronJob(): LibraryCronJobStatus {
  return {
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
}

function waitingFetchSlot() {
  return {
    expectedAt: "2026-06-18T17:00:00.000Z",
    windowEnd: "2026-06-18T18:00:00.000Z",
    status: "waiting" as const,
    run: null,
    jobRun: null,
  };
}

function runningFetchJobRun(): AgentJobRunListItem {
  const now = new Date().toISOString();
  return {
    id: "job_1",
    jobType: "library-fetch",
    trigger: "one_time",
    scheduleJob: "library-cron",
    instanceId: "fetch-setup",
    expectedAt: null,
    startedAt: now,
    heartbeatAt: now,
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
    updatedAt: now,
  };
}

test("one-time setup validation does not hide missed scheduled fetch windows", () => {
  const cronJob = activeCronJob();
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

test("fetch status control reports the latest failed job instead of idle", () => {
  const failedAt = new Date().toISOString();
  const setupJob = {
    ...runningFetchJobRun(),
    instanceId: "fetch-setup-failed",
    heartbeatAt: failedAt,
    startedAt: failedAt,
    finishedAt: failedAt,
    status: "failed",
    updatedAt: failedAt,
  };
  const entries = buildFetchTimeline({
    jobRuns: [setupJob],
    runs: [],
    slots: [waitingFetchSlot()],
    nowMs: Date.now(),
  });
  const status = getFetchActivityStatus(entries);

  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Failed");
});

test("fetch status control stays idle when only the next scheduled slot is waiting", () => {
  const entries = buildFetchTimeline({
    jobRuns: [],
    runs: [],
    slots: [waitingFetchSlot()],
    nowMs: Date.parse("2026-06-18T16:55:00.000Z"),
  });
  const status = getFetchActivityStatus(entries);

  assert.equal(status.key, "waiting");
  assert.equal(status.label, "Idle");
});

test("fetch frequency label reflects the cron job state", () => {
  assert.equal(fetchCronFrequencyLabel(activeCronJob()), "every hour");
  assert.equal(
    fetchCronFrequencyLabel({
      ...activeCronJob(),
      status: "stopped",
      stoppedAt: "2026-06-18T13:00:00.000Z",
    }),
    "Stopped",
  );
  assert.equal(fetchCronFrequencyLabel(null), "Not scheduled");
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

test("fetch timeline status follows the concrete run bound to a scheduled slot", () => {
  const activeJob: AgentJobRunListItem = {
    id: "job_active",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "runtime-active",
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
    details: {
      progress: {
        counters: {
          tasksPlanned: 2,
          synced: 2,
        },
      },
    },
    updatedAt: "2026-06-20T13:04:00.000Z",
  };
  const failedRun: LibraryFetchRunListItem = {
    id: "run_failed",
    startedAt: "2026-06-20T12:00:10.000Z",
    finishedAt: "2026-06-20T12:01:00.000Z",
    durationMs: 50_000,
    status: "failed",
    source: "cron",
    jobRunId: null,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 6,
    itemsFetched: 5,
    tasksGenerated: 7,
    userActionsCount: 0,
    errorCount: 2,
    summary: "Read 5 posts from 6 sources · 7 posts planned · 2 posts failed",
    details: {
      fetchTasks: [
        { id: "fetch_post:1", status: "synced" },
        { id: "fetch_post:2", status: "synced" },
        { id: "fetch_post:3", status: "synced" },
        { id: "fetch_post:4", status: "synced" },
        { id: "fetch_post:5", status: "synced" },
        { id: "fetch_post:6", status: "failed" },
        { id: "fetch_post:7", status: "failed" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [activeJob],
    runs: [failedRun],
    slots: [
      {
        expectedAt: "2026-06-20T12:00:00.000Z",
        windowEnd: "2026-06-20T13:00:00.000Z",
        status: "running",
        run: failedRun,
        jobRun: activeJob,
      },
    ],
    nowMs: Date.parse("2026-06-20T13:05:00.000Z"),
  });

  assert.equal(entries[0]?.status, "failed");
  assert.equal(entries[0]?.syncSummary, "5/7 saved");
  assert.equal(entries[0]?.run?.id, "run_failed");
});

test("completed fetch outcomes outrank a later runtime timeout", () => {
  const timedOutJob: AgentJobRunListItem = {
    id: "job_timed_out",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "runtime-timed-out",
    expectedAt: "2026-06-20T15:31:02.000Z",
    startedAt: "2026-06-20T15:31:33.000Z",
    heartbeatAt: "2026-06-20T16:21:39.000Z",
    finishedAt: "2026-06-20T16:21:39.000Z",
    status: "timed_out",
    exitCode: null,
    signal: null,
    runtime: "codex",
    runnerPid: 7100,
    workerPid: 7100,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: "runtime",
    summary: "Runtime timed out.",
    details: {
      reason: "timeout_seconds_for_job",
      timeoutStage: "runtime",
      timeoutSeconds: 2880,
      progress: {
        stage: "reconciled",
        counters: {
          sourcesChecked: 6,
          sourcesTotal: 6,
          tasksPlanned: 1,
          tasksDone: 1,
          synced: 1,
          skipped: 0,
          failed: 0,
          actionNeeded: 0,
        },
      },
    },
    updatedAt: "2026-06-20T16:21:39.000Z",
  };
  const completedRun: LibraryFetchRunListItem = {
    id: "run_completed",
    startedAt: "2026-06-20T15:31:47.759Z",
    finishedAt: "2026-06-20T15:32:00.978Z",
    durationMs: 13_219,
    status: "ok",
    source: "cron",
    jobRunId: timedOutJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 6,
    itemsFetched: 0,
    tasksGenerated: 0,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 0 new posts from 6 sources",
    details: {
      fetchTasks: [
        { id: "fetch_post:product_hunt:workclaw", title: "#1 WorkClaw", status: "synced" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [timedOutJob],
    runs: [completedRun],
    slots: [
      {
        expectedAt: "2026-06-20T15:31:02.000Z",
        windowEnd: "2026-06-20T16:31:02.000Z",
        status: "failed",
        run: completedRun,
        jobRun: timedOutJob,
      },
    ],
    nowMs: Date.parse("2026-06-20T16:30:00.000Z"),
  });

  assert.equal(entries[0]?.status, "ok");
  assert.equal(entries[0]?.syncSummary, "1/1 saved");

  const displayState = fetchRunDisplayState({
    completedOutcomes: true,
    inflight: false,
    jobRun: timedOutJob,
    runStatus: completedRun.status,
  });
  assert.equal(displayState.displayStatus.label, "Succeeded");
  assert.equal(displayState.completedInterruptedLabel, "Timed out");
});

test("partial checkpoint outcomes keep the expanded planned count visible", () => {
  const timedOutJob: AgentJobRunListItem = {
    id: "job_timed_out_partial",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "runtime-timed-out-partial",
    expectedAt: "2026-06-20T15:31:02.000Z",
    startedAt: "2026-06-20T15:31:33.000Z",
    heartbeatAt: "2026-06-20T16:21:39.000Z",
    finishedAt: "2026-06-20T16:21:39.000Z",
    status: "timed_out",
    exitCode: null,
    signal: null,
    runtime: "codex",
    runnerPid: 7100,
    workerPid: 7100,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: "runtime",
    summary: "Runtime timed out.",
    details: {
      reason: "timeout_seconds_for_job",
      progress: {
        stage: "workers_running",
        counters: {
          sourcesChecked: 6,
          sourcesTotal: 6,
          tasksPlanned: 3,
          tasksDone: 1,
          synced: 1,
          skipped: 0,
          failed: 0,
          actionNeeded: 0,
        },
      },
    },
    updatedAt: "2026-06-20T16:21:39.000Z",
  };
  const run: LibraryFetchRunListItem = {
    id: "run_partial_checkpoint",
    startedAt: "2026-06-20T15:31:47.759Z",
    finishedAt: "2026-06-20T15:32:00.978Z",
    durationMs: 13_219,
    status: "ok",
    source: "cron",
    jobRunId: timedOutJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 6,
    itemsFetched: 0,
    tasksGenerated: 0,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 0 new posts from 6 sources",
    details: {
      fetchTasks: [
        { id: "fetch_post:product_hunt:workclaw", title: "#1 WorkClaw", status: "synced" },
        { id: "fetch_post:product_hunt:reframe", title: "#2 Reframe", status: "pending" },
        { id: "fetch_post:product_hunt:slack", title: "#3 Slackbot's MCP Client", status: "pending" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [timedOutJob],
    runs: [run],
    slots: [
      {
        expectedAt: "2026-06-20T15:31:02.000Z",
        windowEnd: "2026-06-20T16:31:02.000Z",
        status: "failed",
        run,
        jobRun: timedOutJob,
      },
    ],
    nowMs: Date.parse("2026-06-20T16:30:00.000Z"),
  });

  assert.equal(entries[0]?.status, "failed");
  assert.equal(entries[0]?.syncSummary, "1/3 saved");
});

test("fetch run stats keep the highest planned post count across details and live counters", () => {
  const run: LibraryFetchRunListItem = {
    id: "run_product_hunt",
    startedAt: "2026-06-20T13:31:00.000Z",
    finishedAt: "2026-06-20T13:32:00.000Z",
    durationMs: 60_000,
    status: "ok",
    source: "cron",
    jobRunId: "runtime-product-hunt",
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 6,
    itemsFetched: 4,
    tasksGenerated: 4,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 4 posts from 6 sources",
    details: {
      fetchTasks: [
        { id: "fetch_post:1", contentStatus: "ready", status: "synced", bodyChars: 100, summaryChars: 80 },
        { id: "fetch_post:2", contentStatus: "ready", status: "synced", bodyChars: 100, summaryChars: 80 },
        { id: "fetch_post:3", contentStatus: "ready", status: "synced", bodyChars: 100, summaryChars: 80 },
      ],
    },
  };

  const stats = fetchRunStats({
    details: run.details as Parameters<typeof fetchRunStats>[0]["details"],
    liveProgress: {
      counters: {
        sourcesChecked: 6,
        sourcesTotal: 6,
        tasksPlanned: 4,
        synced: 4,
      },
    },
    run,
  });

  assert.equal(stats.planned, 4);
  assert.equal(stats.read, 3);
  assert.equal(stats.summarized, 3);
  assert.equal(stats.synced, 3);
});

test("fetch run stats exclude candidate discovery from live post counters", () => {
  const stats = fetchRunStats({
    details: {},
    liveProgress: {
      counters: {
        sourcesChecked: 6,
        sourcesTotal: 6,
        tasksPlanned: 4,
        synced: 4,
      },
      tasks: [
        { id: "candidate_discovery:source:product_hunt_top_products", status: "synced", phase: "synced" },
        { id: "fetch_post:source:one", status: "synced", phase: "synced" },
        { id: "fetch_post:source:two", status: "synced", phase: "synced" },
        { id: "fetch_post:source:three", status: "synced", phase: "synced" },
      ],
    },
  });

  assert.equal(stats.planned, 3);
  assert.equal(stats.read, 3);
  assert.equal(stats.summarized, 3);
  assert.equal(stats.synced, 3);
});
