import assert from "node:assert/strict";
import test from "node:test";

import { addScheduleInterval, floorToExpectedSchedule } from "../src/lib/schedule-timing";

test("relative interval schedules anchor expected runs to the job start time", () => {
  const cronJob = {
    frequencyKey: "30m",
    intervalMinutes: 30,
    schedule: "interval:1800",
    startedAt: "2026-06-13T10:47:14.166Z",
  };

  const cursor = floorToExpectedSchedule(new Date("2026-06-13T10:48:51.000Z"), cronJob);

  assert.equal(cursor.toISOString(), "2026-06-13T10:47:14.166Z");
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
  assert.equal(addScheduleInterval(cursor, cronJob).toISOString(), "2026-06-13T11:17:14.166Z");
});
