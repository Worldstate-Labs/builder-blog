import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCloudWorkerTaskLabel,
  formatPreAssignmentFailureMessage,
  hasWorkerAssignment,
  isCloudWorkerTerminalStatus,
  resolveCloudWorkerTaskStatus,
  resolveWorkerAssignment,
  selectFailedBeforeAssignmentWorkerTasks,
  selectUnassignedWorkerTasks,
  summarizeCloudWorkerLaneStatuses,
} from "@/lib/cloud-worker-task-display";
import type { CloudWorkerHostTask } from "@/lib/cloud-fetch-run-log";

function task(overrides: Partial<CloudWorkerHostTask>): CloudWorkerHostTask {
  return {
    id: "fetch_post:source:BLOG_POST:provider%3Aowner%2Frepo",
    status: "planned",
    phase: null,
    message: null,
    reason: null,
    builder: "Source",
    builderId: "source",
    sourceType: "feed",
    title: null,
    url: null,
    workerId: null,
    bodyChars: null,
    bodyWords: null,
    headlineChars: null,
    headlineWords: null,
    summaryChars: null,
    summaryWords: null,
    updatedAt: null,
    ...overrides,
  };
}

test("worker assignment requires a non-blank worker id", () => {
  assert.equal(hasWorkerAssignment(null), false);
  assert.equal(hasWorkerAssignment("   "), false);
  assert.equal(hasWorkerAssignment("worker-3"), true);
});

test("worker assignment resolves the first usable worker id", () => {
  assert.equal(resolveWorkerAssignment("   ", " worker-3 "), "worker-3");
  assert.equal(resolveWorkerAssignment(null, ""), null);
});

test("queue selection returns only active unassigned tasks", () => {
  const waiting = task({ id: "waiting" });
  const failed = task({ id: "failed", status: "failed", reason: "workload_exceeds_max_budget" });
  const assigned = task({ id: "assigned", workerId: "worker-1" });

  assert.deepEqual(selectUnassignedWorkerTasks([waiting, failed, assigned]), [waiting]);
  assert.deepEqual(
    selectFailedBeforeAssignmentWorkerTasks([waiting, failed, assigned]),
    [failed],
  );
});

test("pre-assignment failure copy prefers taxonomy and suppresses generic messages", () => {
  assert.equal(
    formatPreAssignmentFailureMessage(task({
      status: "failed",
      reason: "workload_exceeds_max_budget",
      message: "failed.",
    })),
    "The planned extraction workload exceeded the supported six-hour execution ceiling, so the run stopped before attempting extraction.",
  );
  assert.equal(
    formatPreAssignmentFailureMessage(task({
      status: "failed",
      reason: "new_failure_code",
      message: "failed.",
    })),
    "new_failure_code",
  );
  assert.equal(
    formatPreAssignmentFailureMessage(task({
      status: "failed",
      reason: null,
      message: "Downloader rejected the request.",
    })),
    "Downloader rejected the request.",
  );
  assert.equal(
    formatPreAssignmentFailureMessage(task({
      status: "failed",
      reason: null,
      message: "failed.",
    })),
    "Failure reason unavailable.",
  );
});

test("existing task titles take precedence", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({ title: "Original title", url: "https://example.com/post" }),
    ),
    "Original title",
  );
});

test("URLs become readable host and path labels", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({ url: "https://www.example.com/posts/one/?ref=queue#top" }),
    ),
    "example.com/posts/one",
  );
});

test("GitHub Trending task ids become repository labels", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({
        id: "fetch_post:source:BLOG_POST:github-trending%3Avorukot%2Fsuperfile",
      }),
    ),
    "vorukot/superfile",
  );
});

test("tweet and podcast ids use compact content labels", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({
        id: "fetch_post:source:TWEET:2081732293161582930",
      }),
    ),
    "Tweet 20817322…582930",
  );
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({
        id: "fetch_post:source:PODCAST_EPISODE:ffdR5fZTC5E",
      }),
    ),
    "Episode ffdR5fZTC5E",
  );
});

test("unknown content types keep a readable type inside a localizable label", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({
        id: "fetch_post:source:LIVE_VIDEO:abcdefghijklmno",
      }),
    ),
    "Post (Live Video) abcdefghijklmno",
  );
});

test("malformed ids render a safe fallback", () => {
  assert.equal(
    formatCloudWorkerTaskLabel(
      task({ id: "fetch_post:source:BLOG_POST:%E0%A4%A" }),
    ),
    "%E0%A4%A",
  );
  assert.equal(
    formatCloudWorkerTaskLabel(task({ id: "not-a-fetch-task" })),
    "Untitled post task",
  );
});

test("persisted terminal outcomes override stale live worker statuses", () => {
  assert.equal(resolveCloudWorkerTaskStatus("synced", "summarized"), "synced");
  assert.equal(resolveCloudWorkerTaskStatus("failed", "running"), "failed");
  assert.equal(resolveCloudWorkerTaskStatus("skipped", "queued"), "skipped");
  assert.equal(resolveCloudWorkerTaskStatus("blocked", "summarized"), "action_needed");
  assert.equal(resolveCloudWorkerTaskStatus("action_needed", "reading"), "action_needed");
  assert.equal(resolveCloudWorkerTaskStatus("pending", "running"), "running");
  assert.equal(resolveCloudWorkerTaskStatus("pending", "synced"), "synced");
  assert.equal(resolveCloudWorkerTaskStatus(null, null), null);

  assert.equal(isCloudWorkerTerminalStatus("synced"), true);
  assert.equal(isCloudWorkerTerminalStatus("blocked"), true);
  assert.equal(isCloudWorkerTerminalStatus("summarized"), false);
});

test("lane accounting matches four durable syncs plus one failure despite stale heartbeats", () => {
  const summary = summarizeCloudWorkerLaneStatuses([
    { persistedStatus: "synced", liveStatus: "synced" },
    { persistedStatus: "synced", liveStatus: "synced" },
    { persistedStatus: "synced", liveStatus: "summarized" },
    { persistedStatus: "synced", liveStatus: "summarized" },
    { persistedStatus: "failed", liveStatus: "failed" },
  ]);

  assert.deepEqual(summary, {
    synced: 4,
    skipped: 0,
    failed: 1,
    actionNeeded: 0,
    pending: 0,
    status: "partial",
    label: "PARTIAL",
  });
});

test("lane accounting labels complete, skipped, action-needed, failed, and running lanes distinctly", () => {
  assert.deepEqual(
    summarizeCloudWorkerLaneStatuses([
      { persistedStatus: "synced", liveStatus: "summarized" },
      { persistedStatus: "synced", liveStatus: "summarized" },
    ]),
    {
      synced: 2,
      skipped: 0,
      failed: 0,
      actionNeeded: 0,
      pending: 0,
      status: "synced",
      label: "SYNCED",
    },
  );
  assert.equal(
    summarizeCloudWorkerLaneStatuses([
      { persistedStatus: "skipped" },
      { persistedStatus: "skipped" },
    ]).label,
    "SKIPPED",
  );
  assert.equal(
    summarizeCloudWorkerLaneStatuses([
      { persistedStatus: "action_needed" },
      { persistedStatus: "synced" },
    ]).label,
    "ACTION NEEDED",
  );
  assert.equal(
    summarizeCloudWorkerLaneStatuses([
      { persistedStatus: "failed" },
      { persistedStatus: "failed" },
    ]).label,
    "FAILED",
  );
  const running = summarizeCloudWorkerLaneStatuses([
    { persistedStatus: "synced" },
    { persistedStatus: "pending", liveStatus: "summarizing" },
  ]);
  assert.equal(running.label, "RUNNING");
  assert.equal(running.pending, 1);

  for (const [summary, expectedTotal] of [
    [summarizeCloudWorkerLaneStatuses([{ persistedStatus: "skipped" }]), 1],
    [summarizeCloudWorkerLaneStatuses([{ persistedStatus: "action_needed" }]), 1],
    [summarizeCloudWorkerLaneStatuses([{ persistedStatus: "failed" }]), 1],
    [running, 2],
  ] as const) {
    assert.equal(
      summary.synced +
        summary.skipped +
        summary.failed +
        summary.actionNeeded +
        summary.pending,
      expectedTotal,
    );
  }
});
