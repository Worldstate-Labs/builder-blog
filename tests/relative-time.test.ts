import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAbsoluteDate,
  formatAbsoluteDateTime,
  relativeTime,
  toEpochMs,
} from "../src/lib/relative-time";

const NOW = Date.UTC(2026, 5, 19, 12, 0, 0); // Fri Jun 19 2026 12:00:00 UTC
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return relativeTime(NOW - ms, NOW);
}
function ahead(ms: number): string {
  return relativeTime(NOW + ms, NOW);
}

test("relativeTime: under a minute reads 'just now' (past and future)", () => {
  assert.equal(ago(0), "just now");
  assert.equal(ago(30 * SECOND), "just now");
  assert.equal(ago(59 * SECOND), "just now");
  assert.equal(ahead(20 * SECOND), "just now");
});

test("relativeTime: minutes use floor and 'min ago'", () => {
  assert.equal(ago(MINUTE), "1 min ago");
  assert.equal(ago(5 * MINUTE), "5 min ago");
  assert.equal(ago(59 * MINUTE), "59 min ago");
  assert.equal(ago(MINUTE + 59 * SECOND), "1 min ago"); // floor
});

test("relativeTime: hours use floor and 'hr ago'", () => {
  assert.equal(ago(HOUR), "1 hr ago");
  assert.equal(ago(90 * MINUTE), "1 hr ago"); // floor
  assert.equal(ago(3 * HOUR), "3 hr ago");
  assert.equal(ago(23 * HOUR + 59 * MINUTE), "23 hr ago");
});

test("relativeTime: days use floor and pluralize", () => {
  assert.equal(ago(25 * HOUR), "1 day ago"); // floor, singular
  assert.equal(ago(DAY), "1 day ago");
  assert.equal(ago(2 * DAY), "2 days ago");
  assert.equal(ago(6 * DAY), "6 days ago");
});

test("relativeTime: 7 days or older falls back to an absolute date", () => {
  assert.equal(ago(7 * DAY), "Jun 12"); // same year -> no year
  assert.equal(ago(40 * DAY), "May 10");
  assert.equal(ago(400 * DAY), "May 15, 2025"); // prior year -> include year
});

test("relativeTime: future is symmetric with 'in …'", () => {
  assert.equal(ahead(5 * MINUTE), "in 5 min");
  assert.equal(ahead(3 * HOUR), "in 3 hr");
  assert.equal(ahead(DAY), "in 1 day");
  assert.equal(ahead(2 * DAY), "in 2 days");
  assert.equal(ahead(10 * DAY), "Jun 29"); // beyond 7d -> absolute
});

test("relativeTime: tiny clock skew (value slightly in the future) reads 'just now'", () => {
  assert.equal(ahead(5 * SECOND), "just now");
});

test("relativeTime: invalid or empty input returns an empty string", () => {
  assert.equal(relativeTime("not-a-date", NOW), "");
  assert.equal(relativeTime("", NOW), "");
});

test("relativeTime accepts ISO strings, epoch ms, and Date", () => {
  const iso = new Date(NOW - 2 * HOUR).toISOString();
  assert.equal(relativeTime(iso, NOW), "2 hr ago");
  assert.equal(relativeTime(NOW - 2 * HOUR, NOW), "2 hr ago");
  assert.equal(relativeTime(new Date(NOW - 2 * HOUR), NOW), "2 hr ago");
});

test("formatAbsoluteDate omits the year only when it matches the reference year", () => {
  assert.equal(formatAbsoluteDate(NOW - 40 * DAY, NOW), "May 10");
  assert.equal(formatAbsoluteDate(NOW - 400 * DAY, NOW), "May 15, 2025");
});

test("formatAbsoluteDateTime renders a precise UTC tooltip timestamp", () => {
  assert.equal(formatAbsoluteDateTime(NOW - 2 * DAY), "Jun 17, 2026, 12:00 PM UTC");
});

test("toEpochMs parses inputs and reports NaN for invalid/missing", () => {
  assert.equal(toEpochMs(NOW), NOW);
  assert.equal(toEpochMs(new Date(NOW)), NOW);
  assert.ok(Number.isNaN(toEpochMs(null)));
  assert.ok(Number.isNaN(toEpochMs(undefined)));
  assert.ok(Number.isNaN(toEpochMs("nope")));
});
