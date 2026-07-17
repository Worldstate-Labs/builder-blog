import assert from "node:assert/strict";
import test from "node:test";

import {
  addScheduleInterval,
  firstExpectedSchedule,
  floorToExpectedSchedule,
  usesRelativeIntervalSchedule,
} from "../src/lib/schedule-timing";

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
  };
  const weekly = {
    frequencyKey: "weekly",
    intervalMinutes: 10080,
    schedule: "anchor:0 8 * * 3",
    startedAt: "2026-03-01T08:00:00.000Z",
    platform: "linux",
  };

  // Wall-clock anchors are not modeled as fixed UTC intervals from startedAt.
  assert.equal(usesRelativeIntervalSchedule(daily), false);
  assert.equal(usesRelativeIntervalSchedule(weekly), false);
  // Daily/weekly step by calendar day/week, holding the wall-clock hour across a
  // DST transition, rather than adding a fixed number of milliseconds.
  const anchoredNoon = new Date("2026-03-10T08:00:00.000Z");
  assert.equal(
    addScheduleInterval(anchoredNoon, daily).getHours(),
    anchoredNoon.getHours(),
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
