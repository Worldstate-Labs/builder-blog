import assert from "node:assert/strict";
import test from "node:test";
import { buildDigestTimeline, getDigestActivityStatus } from "../src/components/DigestLogPanel";
import {
  buildDigestCronStatus,
  digestCronFrequencyLabel,
  getDigestUpdateStatus,
  type CronSlot,
  type DigestCronRunStatusInput,
} from "../src/lib/digest-update-status";
import type { AgentJobRunListItem } from "../src/lib/agent-job-runs";
import type { DigestCronJobStatus, DigestRunListItem } from "../src/lib/digest-runs";

function activeCron(): DigestCronJobStatus {
  return {
    id: "cron_1",
    status: "active",
    startedAt: "2026-06-18T00:00:00.000Z",
    stoppedAt: null,
    frequencyKey: "1h",
    frequencyLabel: "every hour",
    schedule: "every hour",
    intervalMinutes: 60,
    runtime: "codex",
    regenerateDigest: false,
    hostname: "local",
    platform: "darwin",
    updatedAt: "2026-06-18T00:00:00.000Z",
  };
}

function stoppedCron(): DigestCronJobStatus {
  return {
    ...activeCron(),
    status: "stopped",
    stoppedAt: "2026-06-18T12:00:00.000Z",
  };
}

function missedSlot(): CronSlot {
  return {
    expectedAt: "2026-06-18T10:00:00.000Z",
    windowEnd: "2026-06-18T11:00:00.000Z",
    status: "missed",
    run: null,
    jobRun: null,
  };
}

function waitingDigestSlot(): CronSlot<DigestRunListItem> {
  return {
    expectedAt: "2026-06-18T11:00:00.000Z",
    windowEnd: "2026-06-18T12:00:00.000Z",
    status: "waiting",
    run: null,
    jobRun: null,
  };
}

function preparedRun(source: "cron" | "manual"): DigestCronRunStatusInput {
  return {
    id: `${source}_run`,
    status: "prepared",
    source,
    preparedAt: new Date().toISOString(),
  };
}

function runningDigestJobRun(): AgentJobRunListItem {
  return {
    id: "job_1",
    jobType: "digest-build",
    trigger: "scheduled",
    scheduleJob: "digest-cron",
    instanceId: "digest-20260618T100000",
    expectedAt: "2026-06-18T10:00:00.000Z",
    startedAt: "2026-06-18T10:00:05.000Z",
    heartbeatAt: "2026-06-18T10:04:00.000Z",
    finishedAt: null,
    status: "running",
    exitCode: null,
    signal: null,
    runtime: "codex",
    runnerPid: 123,
    workerPid: 123,
    hostname: "local",
    platform: "darwin",
    stage: "runtime_agent_started",
    summary: "Runtime heartbeat.",
    details: {},
    updatedAt: "2026-06-18T10:04:00.000Z",
  };
}

function syncedDigestRun(): DigestRunListItem {
  return {
    id: "run_1",
    status: "synced",
    source: "cron",
    jobRunId: "digest-20260618T100000",
    preparedAt: "2026-06-18T10:05:00.000Z",
    syncedAt: "2026-06-18T10:06:00.000Z",
    language: "original",
    digestTitle: "AI Builder Digest",
    lookbackCutoff: "2026-06-17T10:05:00.000Z",
    maxPostAgeDays: 30,
    lastDigestAt: null,
    regenerate: false,
    subscriptionCount: 6,
    candidateCount: 20,
    includedCount: 20,
    droppedCount: 0,
    contributingSourceCount: 6,
    sources: [],
    candidates: [],
  };
}

function succeededDigestJobRun(): AgentJobRunListItem {
  return {
    ...runningDigestJobRun(),
    heartbeatAt: "2026-06-18T10:08:00.000Z",
    finishedAt: "2026-06-18T10:08:00.000Z",
    status: "succeeded",
    stage: "runtime_finished",
    summary: "Runtime finished.",
    updatedAt: "2026-06-18T10:08:00.000Z",
  };
}

function unsavedDigestRun(): DigestRunListItem {
  return {
    ...syncedDigestRun(),
    id: "run_unsaved",
    status: "prepared",
    syncedAt: null,
    digestTitle: null,
    includedCount: null,
    droppedCount: null,
  };
}

test("manual digest runs do not mask active scheduled digest status", () => {
  const status = getDigestUpdateStatus(activeCron(), [missedSlot()], [preparedRun("manual")]);

  assert.equal(status.key, "needs-attention");
  assert.match(status.summary, /No run started in the latest scheduled window/);
});

test("scheduled digest runs can still show active cron building state", () => {
  const status = getDigestUpdateStatus(activeCron(), [missedSlot()], [preparedRun("cron")]);

  assert.equal(status.key, "building");
});

test("synced scheduled digest runs are not left running by an active runtime job", () => {
  const result = buildDigestCronStatus(
    activeCron(),
    [
      {
        id: "run_1",
        source: "cron",
        status: "synced",
        preparedAt: "2026-06-18T10:05:00.000Z",
      },
    ],
    [runningDigestJobRun()],
    Date.parse("2026-06-18T10:06:00.000Z"),
  );

  const slot = result.slots.find((candidate) => candidate.run?.id === "run_1");

  assert.equal(slot?.status, "ok");
  assert.equal(slot?.jobRun?.status, "running");
});

test("digest timeline consumes job runs linked from a slotted synced run", () => {
  const run = syncedDigestRun();
  const jobRun = runningDigestJobRun();
  const entries = buildDigestTimeline({
    jobRuns: [jobRun],
    runs: [run],
    slots: [
      {
        expectedAt: "2026-06-18T10:00:00.000Z",
        windowEnd: "2026-06-18T11:00:00.000Z",
        status: "running",
        run,
        jobRun: null,
      },
    ],
    nowMs: Date.parse("2026-06-18T10:06:00.000Z"),
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.status, "ok");
  assert.equal(entries[0]?.syncSummary, "20/20 saved");
  assert.deepEqual(entries[0]?.logRef, { kind: "run", runId: "run_1" });
  assert.equal(entries[0]?.jobRun?.instanceId, jobRun.instanceId);
});

test("scheduled digest status is partial when the runtime succeeded without saving", () => {
  const run = {
    id: "cron_unsaved",
    status: "prepared",
    source: "cron",
    preparedAt: "2026-06-18T10:05:00.000Z",
  };
  const result = buildDigestCronStatus(
    activeCron(),
    [run],
    [succeededDigestJobRun()],
    Date.parse("2026-06-18T10:30:00.000Z"),
  );
  const slot = result.slots.find((candidate) => candidate.run?.id === run.id);
  const status = getDigestUpdateStatus(activeCron(), result.slots, [run]);

  assert.equal(slot?.status, "partial");
  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Partial");
});

test("digest activity status is partial when an unsaved run has a completed runtime", () => {
  const run = unsavedDigestRun();
  const jobRun = succeededDigestJobRun();
  const entries = buildDigestTimeline({
    jobRuns: [jobRun],
    runs: [run],
    slots: [],
    nowMs: Date.parse("2026-06-18T11:00:00.000Z"),
  });
  const status = getDigestActivityStatus(entries);

  assert.equal(entries[0]?.status, "partial");
  assert.equal(entries[0]?.syncSummary, "0/20 saved");
  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Partial");
});

test("digest status control reports the latest active job instead of the waiting schedule slot", () => {
  const heartbeatAt = new Date().toISOString();
  const setupJobRun = {
    ...runningDigestJobRun(),
    trigger: "one_time",
    instanceId: "digest-setup",
    expectedAt: null,
    heartbeatAt,
    startedAt: heartbeatAt,
    updatedAt: heartbeatAt,
  };
  const entries = buildDigestTimeline({
    jobRuns: [setupJobRun],
    runs: [],
    slots: [waitingDigestSlot()],
    nowMs: Date.now(),
  });
  const status = getDigestActivityStatus(entries);

  assert.equal(status.key, "building");
  assert.equal(status.label, "Running");
});

test("digest status control reports the latest failed job instead of idle", () => {
  const failedAt = new Date().toISOString();
  const setupJobRun = {
    ...runningDigestJobRun(),
    trigger: "one_time",
    instanceId: "digest-setup-failed",
    expectedAt: null,
    heartbeatAt: failedAt,
    startedAt: failedAt,
    finishedAt: failedAt,
    status: "failed",
    updatedAt: failedAt,
  };
  const entries = buildDigestTimeline({
    jobRuns: [setupJobRun],
    runs: [],
    slots: [waitingDigestSlot()],
    nowMs: Date.now(),
  });
  const status = getDigestActivityStatus(entries);

  assert.equal(status.key, "needs-attention");
  assert.equal(status.label, "Failed");
});

test("digest status control reports no update for an empty digest run", () => {
  const run: DigestRunListItem = {
    ...syncedDigestRun(),
    id: "run_empty",
    status: "prepared",
    syncedAt: null,
    digestTitle: null,
    candidateCount: 0,
    includedCount: null,
    droppedCount: null,
    contributingSourceCount: 0,
    sources: [],
    candidates: [],
  };
  const entries = buildDigestTimeline({
    jobRuns: [],
    runs: [run],
    slots: [],
    nowMs: Date.now(),
  });
  const status = getDigestActivityStatus(entries);

  assert.equal(status.key, "healthy");
  assert.equal(status.label, "No update");
});

test("digest status control stays idle when only the next scheduled slot is waiting", () => {
  const entries = buildDigestTimeline({
    jobRuns: [],
    runs: [],
    slots: [waitingDigestSlot()],
    nowMs: Date.parse("2026-06-18T10:05:00.000Z"),
  });
  const status = getDigestActivityStatus(entries);

  assert.equal(status.key, "waiting");
  assert.equal(status.label, "Idle");
});

test("digest frequency label reflects the cron job state", () => {
  assert.equal(digestCronFrequencyLabel(activeCron()), "every hour");
  assert.equal(digestCronFrequencyLabel(stoppedCron()), "Stopped");
  assert.equal(digestCronFrequencyLabel(null), "Not scheduled");
});

test("one-time digest runs still show building when no schedule is connected", () => {
  const status = getDigestUpdateStatus(null, [], [preparedRun("manual")]);

  assert.equal(status.key, "building");
});
