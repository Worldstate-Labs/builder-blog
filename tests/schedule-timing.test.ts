import assert from "node:assert/strict";
import test from "node:test";

import {
  addScheduleInterval,
  firstExpectedSchedule,
  floorToExpectedSchedule,
  usesRelativeIntervalSchedule,
} from "../src/lib/schedule-timing";

function laDailyCronJob(overrides: Partial<{
  frequencyKey: string;
  intervalMinutes: number;
  schedule: string;
  startedAt: string;
  platform: string;
  timeZone: string | null;
}> = {}) {
  return {
    frequencyKey: "daily",
    intervalMinutes: 1440,
    schedule: "anchor:25 22 * * *",
    startedAt: "2026-07-30T05:25:09.000Z",
    platform: "darwin",
    timeZone: "America/Los_Angeles",
    ...overrides,
  };
}

function laWeeklyCronJob(overrides: Partial<{
  frequencyKey: string;
  intervalMinutes: number;
  schedule: string;
  startedAt: string;
  platform: string;
  timeZone: string | null;
}> = {}) {
  return {
    frequencyKey: "weekly",
    intervalMinutes: 10080,
    schedule: "anchor:0 8 * * 3",
    startedAt: "2026-07-29T15:00:05.000Z",
    platform: "darwin",
    timeZone: "America/Los_Angeles",
    ...overrides,
  };
}

test("relative interval schedules anchor expected runs to the job start time", () => {
  const cronJob = {
    frequencyKey: "30m",
    intervalMinutes: 30,
    schedule: "interval:1800",
    startedAt: "2026-06-13T10:47:14.166Z",
  };

  const cursor = floorToExpectedSchedule(new Date("2026-06-13T10:48:51.000Z"), cronJob);

  assert.equal(cursor.toISOString(), "2026-06-13T10:47:14.166Z");
  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-06-13T11:17:14.166Z");
  assert.equal(addScheduleInterval(cursor, cronJob).toISOString(), "2026-06-13T11:17:14.166Z");
});

test("cron expression schedules keep wall-clock alignment", () => {
  const cronJob = {
    frequencyKey: "30m",
    intervalMinutes: 30,
    schedule: "*/30 * * * *",
    startedAt: "2026-06-13T10:47:14.166Z",
  };

  const cursor = floorToExpectedSchedule(new Date("2026-06-13T10:48:51.000Z"), cronJob);

  assert.equal(cursor.toISOString(), "2026-06-13T10:30:00.000Z");
  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-06-13T10:47:14.166Z");
  assert.equal(addScheduleInterval(cursor, cronJob).toISOString(), "2026-06-13T11:00:00.000Z");
});

test("legacy macOS launchd rows use relative interval timing even when schedule stores cron text", () => {
  const cronJob = {
    frequencyKey: "30m",
    intervalMinutes: 30,
    schedule: "*/30 * * * *",
    startedAt: "2026-06-13T10:47:14.166Z",
    platform: "darwin",
  };

  const cursor = floorToExpectedSchedule(new Date("2026-06-13T10:48:51.000Z"), cronJob);

  assert.equal(cursor.toISOString(), "2026-06-13T10:47:14.166Z");
  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-06-13T11:17:14.166Z");
  assert.equal(addScheduleInterval(cursor, cronJob).toISOString(), "2026-06-13T11:17:14.166Z");
});

test("anchored cron schedules use install time rather than wall-clock cron buckets", () => {
  const cronJob = {
    frequencyKey: "12h",
    intervalMinutes: 720,
    schedule: "anchor:15 1,13 * * *",
    startedAt: "2026-06-21T13:15:22.000Z",
    platform: "linux",
  };

  const beforeFirstRun = floorToExpectedSchedule(new Date("2026-06-22T01:14:59.000Z"), cronJob);
  const firstRun = floorToExpectedSchedule(new Date("2026-06-22T01:15:22.000Z"), cronJob);
  const secondRun = floorToExpectedSchedule(new Date("2026-06-22T13:20:00.000Z"), cronJob);

  assert.equal(beforeFirstRun.toISOString(), "2026-06-21T13:15:22.000Z");
  assert.equal(firstRun.toISOString(), "2026-06-22T01:15:22.000Z");
  assert.equal(secondRun.toISOString(), "2026-06-22T13:15:22.000Z");
  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-06-22T01:15:22.000Z");
  assert.equal(addScheduleInterval(firstRun, cronJob).toISOString(), "2026-06-22T13:15:22.000Z");
});

test("daily and weekly anchor schedules track wall-clock time so DST does not drift the window", () => {
  const daily = {
    frequencyKey: "daily",
    intervalMinutes: 1440,
    schedule: "anchor:0 8 * * *",
    startedAt: "2026-03-01T08:00:00.000Z",
    platform: "darwin",
    timeZone: "America/Los_Angeles",
  };
  const weekly = {
    frequencyKey: "weekly",
    intervalMinutes: 10080,
    schedule: "anchor:0 8 * * 3",
    startedAt: "2026-03-01T08:00:00.000Z",
    platform: "linux",
    timeZone: "America/Los_Angeles",
  };

  // Wall-clock anchors are not modeled as fixed UTC intervals from startedAt.
  assert.equal(usesRelativeIntervalSchedule(daily), false);
  assert.equal(usesRelativeIntervalSchedule(weekly), false);
  // Daily/weekly step by calendar day/week, holding the wall-clock hour across a
  // DST transition, rather than adding a fixed number of milliseconds.
  const anchoredMorning = new Date("2026-03-10T15:00:00.000Z");
  assert.equal(
    addScheduleInterval(anchoredMorning, daily).toISOString(),
    "2026-03-11T15:00:00.000Z",
  );
});

test("hourly anchor schedules stay on relative-interval timing (DST-neutral)", () => {
  const hourly = {
    frequencyKey: "1h",
    intervalMinutes: 60,
    schedule: "anchor:30 * * * *",
    startedAt: "2026-03-01T08:30:00.000Z",
    platform: "linux",
  };

  assert.equal(usesRelativeIntervalSchedule(hourly), true);
});

test("zoned daily anchors pick the first real occurrence strictly after startedAt", () => {
  const cronJob = laDailyCronJob();

  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-07-31T05:25:00.000Z");
  assert.equal(
    floorToExpectedSchedule(new Date("2026-07-31T02:27:00.000Z"), cronJob).toISOString(),
    "2026-07-30T05:25:00.000Z",
  );
});

test("zoned weekly anchors keep the same local weekday and time for the first occurrence", () => {
  const cronJob = laWeeklyCronJob();
  const firstExpected = firstExpectedSchedule(cronJob);

  assert.equal(firstExpected?.toISOString(), "2026-08-05T15:00:00.000Z");
  assert.equal(addScheduleInterval(firstExpected!, cronJob).toISOString(), "2026-08-12T15:00:00.000Z");
});

test("zoned daily anchors shift spring DST gaps forward with compatible disambiguation", () => {
  const cronJob = laDailyCronJob({
    schedule: "anchor:30 2 * * *",
    startedAt: "2026-03-07T10:30:00.000Z",
  });

  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-03-08T10:30:00.000Z");
  assert.equal(
    floorToExpectedSchedule(new Date("2026-03-08T10:45:00.000Z"), cronJob).toISOString(),
    "2026-03-08T10:30:00.000Z",
  );
});

test("zoned daily anchors choose the earlier instant for fall DST folds", () => {
  const cronJob = laDailyCronJob({
    schedule: "anchor:30 1 * * *",
    startedAt: "2026-10-31T08:30:00.000Z",
  });

  assert.equal(firstExpectedSchedule(cronJob)?.toISOString(), "2026-11-01T08:30:00.000Z");
  assert.equal(
    floorToExpectedSchedule(new Date("2026-11-01T08:45:00.000Z"), cronJob).toISOString(),
    "2026-11-01T08:30:00.000Z",
  );
});

test("zoned daily and weekly calendar addition keeps wall-clock time across DST", () => {
  const daily = laDailyCronJob({
    schedule: "anchor:30 2 * * *",
    startedAt: "2026-03-07T10:30:00.000Z",
  });
  const weekly = laWeeklyCronJob({
    schedule: "anchor:30 1 * * 0",
    startedAt: "2026-11-01T08:30:00.000Z",
  });

  assert.equal(
    addScheduleInterval(new Date("2026-03-08T10:30:00.000Z"), daily).toISOString(),
    "2026-03-09T09:30:00.000Z",
  );
  assert.equal(
    addScheduleInterval(new Date("2026-11-01T08:30:00.000Z"), weekly).toISOString(),
    "2026-11-08T09:30:00.000Z",
  );
});

test("missing or invalid time zones keep legacy daily and weekly anchor intervals relative to startedAt", () => {
  const legacyDaily = laDailyCronJob({ timeZone: null });
  const invalidWeekly = laWeeklyCronJob({ timeZone: "Mars/Olympus_Mons" });

  assert.equal(usesRelativeIntervalSchedule(legacyDaily), true);
  assert.equal(firstExpectedSchedule(legacyDaily)?.toISOString(), "2026-07-31T05:25:09.000Z");
  assert.equal(
    floorToExpectedSchedule(new Date("2026-07-31T02:27:00.000Z"), legacyDaily).toISOString(),
    "2026-07-30T05:25:09.000Z",
  );
  assert.equal(usesRelativeIntervalSchedule(invalidWeekly), true);
  assert.equal(firstExpectedSchedule(invalidWeekly)?.toISOString(), "2026-08-05T15:00:05.000Z");
  assert.equal(
    addScheduleInterval(new Date("2026-08-05T15:00:05.000Z"), invalidWeekly).toISOString(),
    "2026-08-12T15:00:05.000Z",
  );
});
