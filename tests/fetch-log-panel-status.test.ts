import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFetchTimeline,
  fetchCronFrequencyLabel,
  fetchDetailsForTaskDisplay,
  fetchRunLifecycleSyncProgress,
  fetchRunDisplayState,
  fetchRunStats,
  fetchTaskFailureReasonText,
  getFetchActivityStatus,
  getFetchUpdateStatus,
  taskStatusPill,
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

test("fetch status control reports no update for an empty successful run", () => {
  const run: LibraryFetchRunListItem = {
    id: "run_no_update",
    startedAt: "2026-06-21T18:00:10.000Z",
    finishedAt: "2026-06-21T18:00:30.000Z",
    durationMs: 20_000,
    status: "ok",
    source: "cron",
    jobRunId: null,
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
        { id: "candidate_discovery:source:product_hunt_top_products", status: "synced", agentWorkType: "candidate_discovery_fallback" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [],
    runs: [run],
    slots: [
      {
        expectedAt: "2026-06-21T18:00:00.000Z",
        windowEnd: "2026-06-21T19:00:00.000Z",
        status: "ok",
        run,
        jobRun: null,
      },
    ],
    nowMs: Date.parse("2026-06-21T18:05:00.000Z"),
  });
  const status = getFetchActivityStatus(entries);
  const displayState = fetchRunDisplayState({
    completedOutcomes: false,
    inflight: false,
    jobRun: null,
    runStatus: run.status,
    noUpdate: true,
  });

  assert.equal(entries[0]?.status, "ok");
  assert.equal(status.key, "healthy");
  assert.equal(status.label, "No update");
  assert.equal(displayState.displayStatus.label, "No update");
  assert.equal(displayState.displayStatus.tone, "ok");
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

  const stats = fetchRunStats({
    details: staleRun.details as { fetchTasks: Array<{ id: string; status: string }> },
    liveProgress: null,
    run: staleRun,
  });
  const stalledDisplay = fetchRunDisplayState({
    completedOutcomes: false,
    inflight: false,
    jobRun: staleJob,
    outcomeStatus: "ok",
    runStatus: staleRun.status,
  });
  assert.equal(stalledDisplay.displayStatus.label, "Stalled");

  const openedLiveLogDisplay = fetchRunDisplayState({
    completedOutcomes: false,
    inflight: true,
    jobRun: staleJob,
    outcomeStatus: "ok",
    runStatus: staleRun.status,
    suppressStalled: true,
  });
  assert.equal(stats.planned, 4);
  assert.equal(openedLiveLogDisplay.displayStatus.label, "Syncing");
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

test("running fetch job with partial failures stays syncing in the timeline", () => {
  const runningJob: AgentJobRunListItem = {
    ...runningFetchJobRun(),
    instanceId: "runtime-running-with-failures",
    startedAt: "2026-06-24T12:17:50.000Z",
    heartbeatAt: "2026-06-24T12:39:15.000Z",
    details: {
      progress: {
        stage: "workers_running",
        counters: {
          sourcesChecked: 10,
          sourcesTotal: 10,
          tasksPlanned: 16,
          tasksDone: 8,
          synced: 5,
          skipped: 0,
          failed: 3,
          actionNeeded: 0,
        },
      },
    },
    updatedAt: "2026-06-24T12:39:15.000Z",
  };
  const run: LibraryFetchRunListItem = {
    id: "run_running_with_failures",
    startedAt: "2026-06-24T12:17:53.268Z",
    finishedAt: "2026-06-24T12:18:20.943Z",
    durationMs: 27_675,
    status: "ok",
    source: "manual",
    jobRunId: runningJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 10,
    itemsFetched: 9,
    tasksGenerated: 13,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 9 posts from 10 sources · 16 posts planned",
    details: {
      fetchTasks: [
        { id: "fetch_post:1", status: "synced" },
        { id: "fetch_post:2", status: "failed" },
        { id: "fetch_post:3", status: "pending" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [runningJob],
    runs: [run],
    slots: [],
    nowMs: Date.parse("2026-06-24T12:40:00.000Z"),
  });
  const status = getFetchActivityStatus(entries);

  assert.equal(entries[0]?.status, "running");
  assert.equal(status.key, "syncing");
  assert.equal(status.label, "Running");
});

test("sync lifecycle progress separates saved posts from accounted terminal outcomes", () => {
  assert.deepEqual(
    fetchRunLifecycleSyncProgress({
      planned: 40,
      synced: 27,
      skipped: 0,
      failed: 5,
      actionNeeded: 5,
    }),
    {
      synced: 27,
      accounted: 37,
      outcome: "27 / 40 posts",
      accountedText: "37 / 40 posts accounted",
    },
  );
});

test("failed post outcomes override an ok fetch run status", () => {
  const failedJob: AgentJobRunListItem = {
    id: "job_failed_outcomes",
    jobType: "library-fetch",
    trigger: "one_time",
    scheduleJob: "library-cron",
    instanceId: "runtime-failed-outcomes",
    expectedAt: null,
    startedAt: "2026-06-22T05:49:46.000Z",
    heartbeatAt: "2026-06-22T05:52:11.000Z",
    finishedAt: "2026-06-22T05:52:11.000Z",
    status: "failed",
    exitCode: 65,
    signal: null,
    runtime: "openclaw",
    runnerPid: 41050,
    workerPid: 41050,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: "runtime",
    summary: "Runtime exited with code 65.",
    details: {
      reason: "runtime_finished",
      progress: {
        stage: "reconciled",
        counters: {
          sourcesChecked: 6,
          sourcesTotal: 6,
          tasksPlanned: 2,
          tasksDone: 2,
          synced: 0,
          skipped: 0,
          failed: 2,
          actionNeeded: 0,
        },
      },
    },
    updatedAt: "2026-06-22T05:52:11.000Z",
  };
  const run: LibraryFetchRunListItem = {
    id: "run_failed_outcomes",
    startedAt: "2026-06-22T05:49:48.365Z",
    finishedAt: "2026-06-22T05:52:11.000Z",
    durationMs: 142_635,
    status: "ok",
    source: "manual",
    jobRunId: failedJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 6,
    itemsFetched: 1,
    tasksGenerated: 2,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 1 post from 6 sources",
    details: {
      fetchTasks: [
        { id: "fetch_post:builder_1:post_1", title: "Post 1", status: "failed" },
        { id: "fetch_post:builder_2:post_2", title: "Post 2", status: "failed" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [failedJob],
    runs: [run],
    slots: [],
    nowMs: Date.parse("2026-06-22T05:55:00.000Z"),
  });
  const status = getFetchActivityStatus(entries);
  const stats = fetchRunStats({
    details: run.details as { fetchTasks: Array<{ id: string; status: string }> },
    liveProgress: null,
    run,
  });
  const displayState = fetchRunDisplayState({
    completedOutcomes: true,
    inflight: false,
    jobRun: failedJob,
    outcomeStatus: "failed",
    runStatus: run.status,
  });

  assert.equal(entries[0]?.status, "failed");
  assert.equal(entries[0]?.syncSummary, "0/2 saved");
  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Failed");
  assert.equal(stats.failed, 2);
  assert.equal(displayState.displayStatus.label, "Failed");
});

test("partial post failures stay partial across timeline status and run card", () => {
  const succeededJob: AgentJobRunListItem = {
    id: "job_partial_outcomes",
    jobType: "library-fetch",
    trigger: "one_time",
    scheduleJob: "library-cron",
    instanceId: "runtime-partial-outcomes",
    expectedAt: null,
    startedAt: "2026-06-24T12:49:46.000Z",
    heartbeatAt: "2026-06-24T12:52:11.000Z",
    finishedAt: "2026-06-24T12:52:11.000Z",
    status: "succeeded",
    exitCode: 0,
    signal: null,
    runtime: "codex",
    runnerPid: 41050,
    workerPid: 41050,
    hostname: "JiedeMac-mini-2.local",
    platform: "darwin",
    stage: "runtime",
    summary: "Fetch job completed.",
    details: {},
    updatedAt: "2026-06-24T12:52:11.000Z",
  };
  const run: LibraryFetchRunListItem = {
    id: "run_partial_outcomes",
    startedAt: "2026-06-24T12:49:48.365Z",
    finishedAt: "2026-06-24T12:52:11.000Z",
    durationMs: 142_635,
    status: "partial",
    source: "manual",
    jobRunId: succeededJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini-2.local",
    platform: "darwin",
    buildersAttempted: 10,
    itemsFetched: 12,
    tasksGenerated: 16,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 12 posts from 10 sources · 16 posts planned · 4 posts failed",
    details: {
      fetchTasks: [
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `fetch_post:synced_${index}`,
          title: `Synced ${index}`,
          status: "synced",
        })),
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `fetch_post:failed_${index}`,
          title: `Failed ${index}`,
          status: "failed",
        })),
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [succeededJob],
    runs: [run],
    slots: [],
    nowMs: Date.parse("2026-06-24T13:30:00.000Z"),
  });
  const activityStatus = getFetchActivityStatus(entries);
  const updateStatus = getFetchUpdateStatus(null, [], [run], [succeededJob]);
  const displayState = fetchRunDisplayState({
    completedOutcomes: true,
    inflight: false,
    jobRun: succeededJob,
    outcomeStatus: "partial",
    runStatus: run.status,
  });

  assert.equal(entries[0]?.status, "partial");
  assert.equal(activityStatus.key, "needs-attention");
  assert.equal(activityStatus.label, "Partial");
  assert.equal(updateStatus.key, "needs-attention");
  assert.equal(updateStatus.label, "Partial");
  assert.equal(displayState.displayStatus.label, "Partial");
  assert.equal(displayState.displayStatus.tone, "partial");
});

test("action-needed post outcomes make a completed fetch run partial", () => {
  const succeededJob: AgentJobRunListItem = {
    id: "job_action_needed_outcomes",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "runtime-action-needed-outcomes",
    expectedAt: "2026-07-06T20:00:00.000Z",
    startedAt: "2026-07-06T20:01:00.000Z",
    heartbeatAt: "2026-07-06T20:07:00.000Z",
    finishedAt: "2026-07-06T20:07:00.000Z",
    status: "succeeded",
    exitCode: 0,
    signal: null,
    runtime: "codex",
    runnerPid: 41050,
    workerPid: 41050,
    hostname: "cc-agent-sfo2",
    platform: "darwin",
    stage: "runtime",
    summary: "Fetch job completed.",
    details: {
      progress: {
        stage: "checkpoint_syncing",
        counters: {
          sourcesChecked: 20,
          sourcesTotal: 20,
          tasksPlanned: 8,
          tasksDone: 8,
          synced: 3,
          skipped: 0,
          failed: 0,
          actionNeeded: 5,
        },
      },
    },
    updatedAt: "2026-07-06T20:07:00.000Z",
  };
  const run: LibraryFetchRunListItem = {
    id: "run_action_needed_outcomes",
    startedAt: "2026-07-06T20:01:10.000Z",
    finishedAt: "2026-07-06T20:07:00.000Z",
    durationMs: 350_000,
    status: "ok",
    source: "cron",
    jobRunId: succeededJob.instanceId,
    cliVersion: null,
    hostname: "cc-agent-sfo2",
    platform: "darwin",
    buildersAttempted: 20,
    itemsFetched: 3,
    tasksGenerated: 8,
    userActionsCount: 5,
    errorCount: 0,
    summary: "Read 3 posts from 20 sources · 8 posts planned · 5 actions needed",
    details: {
      fetchTasks: [
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `fetch_post:synced_${index}`,
          title: `Synced ${index}`,
          status: "synced",
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `fetch_post:action_needed_${index}`,
          title: `Needs action ${index}`,
          status: "action_needed",
        })),
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [succeededJob],
    runs: [run],
    slots: [
      {
        expectedAt: "2026-07-06T20:00:00.000Z",
        windowEnd: "2026-07-06T21:00:00.000Z",
        status: "ok",
        run,
        jobRun: succeededJob,
      },
    ],
    nowMs: Date.parse("2026-07-06T21:00:00.000Z"),
  });
  const activityStatus = getFetchActivityStatus(entries);
  const updateStatus = getFetchUpdateStatus(
    activeCronJob(),
    entries.map((entry) => ({
      ...entry.slot!,
      status: entry.status,
    })).filter((slot): slot is NonNullable<typeof slot> => Boolean(slot)),
    [run],
    [succeededJob],
  );
  const stats = fetchRunStats({
    details: run.details as Parameters<typeof fetchRunStats>[0]["details"],
    liveProgress: succeededJob.details && typeof succeededJob.details === "object" && !Array.isArray(succeededJob.details)
      ? (succeededJob.details as { progress?: Parameters<typeof fetchRunStats>[0]["liveProgress"] }).progress ?? null
      : null,
    run,
  });

  assert.equal(stats.synced, 3);
  assert.equal(stats.actionNeeded, 5);
  assert.equal(entries[0]?.status, "partial");
  assert.equal(entries[0]?.syncSummary, "3/8 saved");
  assert.equal(activityStatus.key, "needs-attention");
  assert.equal(activityStatus.label, "Partial");
  assert.equal(updateStatus.key, "needs-attention");
  assert.equal(updateStatus.label, "Partial");
});

test("stopped stale fetch job does not turn unfinished planned posts into failed status", () => {
  const staleJob: AgentJobRunListItem = {
    id: "job_stale_stop",
    jobType: "library-fetch",
    trigger: "scheduled",
    scheduleJob: "library-cron",
    instanceId: "runtime-stopped",
    expectedAt: null,
    startedAt: "2026-06-24T12:31:01.000Z",
    heartbeatAt: "2026-06-24T12:35:40.824Z",
    finishedAt: null,
    status: "stale",
    exitCode: null,
    signal: null,
    runtime: "openclaw",
    runnerPid: 28993,
    workerPid: 28993,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    stage: "runtime",
    summary: "Stop cron found no live worker for the recorded instance.",
    details: {
      reason: "stop_cron_stale",
      progress: {
        stage: "tasks_planned",
        counters: {
          sourcesChecked: 10,
          sourcesTotal: 10,
          tasksPlanned: 10,
          tasksDone: 0,
          synced: 0,
          skipped: 0,
          failed: 0,
          actionNeeded: 0,
        },
      },
    },
    updatedAt: "2026-06-24T12:35:40.824Z",
  };
  const run: LibraryFetchRunListItem = {
    id: "run_stale_stop",
    startedAt: "2026-06-24T12:31:41.915Z",
    finishedAt: "2026-06-24T12:32:13.410Z",
    durationMs: 31_495,
    status: "ok",
    source: "cron",
    jobRunId: staleJob.instanceId,
    cliVersion: null,
    hostname: "JiedeMac-mini.local",
    platform: "darwin",
    buildersAttempted: 10,
    itemsFetched: 4,
    tasksGenerated: 7,
    userActionsCount: 0,
    errorCount: 0,
    summary: "Read 4 posts from 10 sources · 10 posts planned",
    details: {
      fetchTasks: [
        { id: "fetch_post:1", status: "fetched" },
        { id: "fetch_post:2", status: "pending" },
      ],
    },
  };

  const entries = buildFetchTimeline({
    jobRuns: [staleJob],
    runs: [run],
    slots: [],
    nowMs: Date.parse("2026-06-24T12:40:00.000Z"),
  });
  const status = getFetchActivityStatus(entries);
  const displayState = fetchRunDisplayState({
    completedOutcomes: false,
    inflight: false,
    jobRun: staleJob,
    outcomeStatus: "ok",
    runStatus: run.status,
  });

  assert.equal(entries[0]?.status, "stopped");
  assert.equal(status.key, "stopped");
  assert.equal(status.label, "Stopped");
  assert.equal(displayState.displayStatus.label, "Stopped");
  assert.equal(displayState.displayStatus.tone, "partial");
});

test("scheduled fetch status control reports stopped for a stopped latest slot", () => {
  const staleJob: AgentJobRunListItem = {
    ...runningFetchJobRun(),
    trigger: "scheduled",
    instanceId: "runtime-stopped-slot",
    status: "stale",
    summary: "Stop cron found no live worker for the recorded instance.",
    details: { reason: "stop_cron_stale" },
  };
  const status = getFetchUpdateStatus(
    activeCronJob(),
    [
      {
        expectedAt: "2026-06-24T12:00:00.000Z",
        windowEnd: "2026-06-24T13:00:00.000Z",
        status: "stopped",
        run: null,
        jobRun: staleJob,
      },
    ],
    [],
    [staleJob],
  );

  assert.equal(status.key, "stopped");
  assert.equal(status.label, "Stopped");
});

test("replaced fetch job stays non-failed across timeline and status control", () => {
  const replacedJob: AgentJobRunListItem = {
    ...runningFetchJobRun(),
    trigger: "scheduled",
    instanceId: "runtime-replaced",
    status: "replaced",
    finishedAt: "2026-06-24T12:45:00.000Z",
    summary: "Runtime was replaced by a newer instance.",
    details: { reason: "runtime_replaced" },
  };
  const entries = buildFetchTimeline({
    jobRuns: [replacedJob],
    runs: [],
    slots: [
      {
        expectedAt: "2026-06-24T12:00:00.000Z",
        windowEnd: "2026-06-24T13:00:00.000Z",
        status: "replaced",
        run: null,
        jobRun: replacedJob,
      },
    ],
    nowMs: Date.parse("2026-06-24T12:50:00.000Z"),
  });
  const activityStatus = getFetchActivityStatus(entries);
  const scheduleStatus = getFetchUpdateStatus(activeCronJob(), entries.map((entry) => entry.slot!).filter(Boolean), [], [replacedJob]);

  assert.equal(entries[0]?.status, "replaced");
  assert.equal(activityStatus.key, "replaced");
  assert.equal(activityStatus.label, "Replaced");
  assert.equal(scheduleStatus.key, "replaced");
  assert.equal(scheduleStatus.label, "Replaced");
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
        { id: "fetch_post:1", contentStatus: "ready", status: "synced", bodyChars: 100, summaryChars: 80, headlineChars: 38 },
        { id: "fetch_post:2", contentStatus: "ready", status: "synced", bodyChars: 100, summaryChars: 80, headlineChars: 38 },
        { id: "fetch_post:3", contentStatus: "ready", status: "synced", bodyChars: 100, summaryChars: 80, headlineChars: 38 },
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
  assert.equal(stats.summaries, 3);
  assert.equal(stats.headlines, 3);
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

test("live job progress can backfill job-only post task details", () => {
  const details = fetchDetailsForTaskDisplay({}, {
    stage: "workers_running",
    counters: {
      tasksPlanned: 2,
    },
    tasks: [
      {
        id: "candidate_discovery:source:product_hunt_top_products",
        status: "synced",
        phase: "synced",
        workerId: "shard-0",
      },
      {
        id: "fetch_post:source:one",
        builder: "Example Blog",
        builderId: "builder_1",
        sourceType: "blog",
        title: "A running task",
        url: "https://example.com/post",
        status: "summarizing",
        phase: "summarize",
        workerId: "shard-1",
        bodyChars: 1200,
      },
      {
        id: "fetch_post:source:two",
        builder: "Example Blog",
        builderId: "builder_1",
        sourceType: "blog",
        title: "A synced task",
        status: "synced",
        phase: "synced",
        workerId: "shard-2",
        bodyChars: 900,
        summaryChars: 140,
        headlineChars: 42,
      },
    ],
  });

  assert.deepEqual(details.fetchTasks, [
    {
      id: "fetch_post:source:one",
      builder: "Example Blog",
      builderId: "builder_1",
      sourceType: "blog",
      title: "A running task",
      url: "https://example.com/post",
      status: "pending",
      workerId: "shard-1",
      bodyChars: 1200,
      bodyWords: null,
      headlineChars: null,
      headlineWords: null,
      summaryChars: null,
      summaryWords: null,
    },
    {
      id: "fetch_post:source:two",
      builder: "Example Blog",
      builderId: "builder_1",
      sourceType: "blog",
      title: "A synced task",
      url: null,
      status: "synced",
      workerId: "shard-2",
      bodyChars: 900,
      bodyWords: null,
      headlineChars: 42,
      headlineWords: null,
      summaryChars: 140,
      summaryWords: null,
    },
  ]);
});

test("planned ready tasks do not look like active summarizing work before worker progress", () => {
  assert.deepEqual(
    taskStatusPill({
      id: "fetch_post:source:ready",
      status: "pending",
      contentStatus: "ready",
      bodyChars: 1200,
      bodyWords: 180,
    }),
    { label: "ready", tone: "idle" },
  );
  assert.deepEqual(
    taskStatusPill(
      {
        id: "fetch_post:source:active",
        status: "pending",
        contentStatus: "ready",
        bodyChars: 1200,
      },
      {
        id: "fetch_post:source:active",
        status: "summarizing",
        phase: "summarize",
        workerId: "worker-3",
      },
    ),
    { label: "summarizing", tone: "warn" },
  );
});

test("validation-failed fetch task reason includes the concrete validator error", () => {
  assert.equal(
    fetchTaskFailureReasonText({
      status: "failed",
      failureReason: "task_validation_failed",
      title: "Macron's sports protectionism",
      evidence: {
        validation: {
          builder: "Politico",
          item: "https://www.politico.com/live-updates/2026/07/09/world-cup-2026/emmanuel-macron-tour-de-france-world-cup-00992527",
          errors: ["content_quality:content_duplicates_metadata"],
        },
      },
    }),
    "Sync payload for this post failed validation: content_quality:content_duplicates_metadata (post body duplicated title or description metadata instead of primary content)",
  );
});

test("fetch run stats do not count summary translation as source read", () => {
  const stats = fetchRunStats({
    details: {
      fetchTasks: [
        {
          id: "fetch_post:blog:translated",
          agentWorkType: "translate_summary_only",
          contentStatus: "ready",
          status: "synced",
          bodyChars: 0,
          bodyWords: 0,
          summaryChars: 86,
          summaryWords: 18,
          headlineChars: 42,
          headlineWords: 6,
          summaryMethod: "Translated summary from a Hub-shared post",
          hubSharedReuse: {
            source: "hub_shared_post",
            bodyReused: false,
            summaryReused: false,
            summaryTranslated: true,
          },
        },
      ],
    },
    liveProgress: null,
  });

  assert.equal(stats.planned, 1);
  assert.equal(stats.read, 0);
  assert.equal(stats.summaries, 1);
  assert.equal(stats.headlines, 1);
  assert.equal(stats.summarized, 1);
  assert.equal(stats.synced, 1);
});
