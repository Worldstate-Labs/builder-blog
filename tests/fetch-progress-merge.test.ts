import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeFetchProgressEvents,
  mergeFetchProgressTask,
} from "../src/lib/fetch-progress-merge";

test("API progress merge keeps a terminal task ahead of a stale checkpoint", () => {
  const merged = mergeFetchProgressTask(
    {
      id: "fetch_post:source:first",
      status: "synced",
      phase: "synced",
      message: "synced.",
      updatedAt: "2026-07-14T06:12:20.402Z",
    },
    {
      id: "fetch_post:source:first",
      status: "summarized",
      phase: "summarize",
      message: "Summary ready; waiting for server sync.",
      summaryChars: 420,
      updatedAt: "2026-07-14T06:11:20.402Z",
    },
  );

  assert.equal(merged.status, "synced");
  assert.equal(merged.phase, "synced");
  assert.equal(merged.message, "synced.");
  assert.equal(merged.summaryChars, 420);
  assert.equal(merged.updatedAt, "2026-07-14T06:12:20.402Z");
});

test("API progress merge rejects an older conflicting terminal snapshot", () => {
  const merged = mergeFetchProgressTask(
    { status: "synced", phase: "synced", updatedAt: "2026-07-14T06:12:20.402Z" },
    { status: "failed", phase: "completed", updatedAt: "2026-07-14T06:11:20.402Z" },
  );

  assert.equal(merged.status, "synced");
  assert.equal(merged.phase, "synced");
  assert.equal(merged.updatedAt, "2026-07-14T06:12:20.402Z");
});

test("API progress merge keeps one task-planning milestone but preserves later retries", () => {
  const events = dedupeFetchProgressEvents([
    { at: "2026-07-14T06:09:20.402Z", type: "tasks_planned", message: "Planned 3 post tasks." },
    { at: "2026-07-14T06:10:20.402Z", type: "task_progress", taskId: "task-1", status: "reading", message: "Reading." },
    { at: "2026-07-14T06:11:20.402Z", type: "tasks_planned", message: "Planned 3 post tasks." },
    { at: "2026-07-14T06:11:40.402Z", type: "checkpoint_syncing", message: "Syncing checkpoint." },
    { at: "2026-07-14T06:12:20.402Z", type: "task_progress", taskId: "task-1", status: "reading", message: "Reading." },
  ], 20);

  assert.deepEqual(events.map((event) => event.at), [
    "2026-07-14T06:09:20.402Z",
    "2026-07-14T06:10:20.402Z",
    "2026-07-14T06:11:40.402Z",
    "2026-07-14T06:12:20.402Z",
  ]);
});
