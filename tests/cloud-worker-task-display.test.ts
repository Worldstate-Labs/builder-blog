import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCloudWorkerTaskLabel,
  hasWorkerAssignment,
  resolveWorkerAssignment,
  selectUnassignedWorkerTasks,
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

test("queue selection returns only unassigned tasks", () => {
  const waiting = task({ id: "waiting" });
  const assigned = task({ id: "assigned", workerId: "worker-1" });

  assert.deepEqual(selectUnassignedWorkerTasks([waiting, assigned]), [waiting]);
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
