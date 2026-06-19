import assert from "node:assert/strict";
import test from "node:test";
import {
  getDigestUpdateStatus,
  type CronSlot,
  type DigestCronRunStatusInput,
} from "../src/lib/digest-update-status";
import type { DigestCronJobStatus } from "../src/lib/digest-runs";

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

function missedSlot(): CronSlot {
  return {
    expectedAt: "2026-06-18T10:00:00.000Z",
    windowEnd: "2026-06-18T11:00:00.000Z",
    status: "missed",
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

test("manual digest runs do not mask active scheduled digest status", () => {
  const status = getDigestUpdateStatus(activeCron(), [missedSlot()], [preparedRun("manual")]);

  assert.equal(status.key, "needs-attention");
  assert.match(status.summary, /No run started in the latest scheduled window/);
});

test("scheduled digest runs can still show active cron building state", () => {
  const status = getDigestUpdateStatus(activeCron(), [missedSlot()], [preparedRun("cron")]);

  assert.equal(status.key, "building");
});

test("one-time digest runs still show building when no schedule is connected", () => {
  const status = getDigestUpdateStatus(null, [], [preparedRun("manual")]);

  assert.equal(status.key, "building");
});
