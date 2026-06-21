import assert from "node:assert/strict";
import test from "node:test";
import { mergeFetchRunDetails } from "../src/lib/fetch-run-details";

test("late planned-task patches do not regress terminal fetch task outcomes", () => {
  const result = mergeFetchRunDetails(
    {
      perBuilder: [{ builderId: "builder_1" }],
      fetchTasks: [
        {
          id: "fetch_post:builder_1:post_1",
          builderId: "builder_1",
          status: "synced",
          summaryChars: 120,
        },
      ],
    },
    {
      plannedTasks: [
        {
          id: "fetch_post:builder_1:post_1",
          builderId: "builder_1",
          title: "Post 1",
          url: "https://example.com/post-1",
          status: "pending",
        },
      ],
    },
  );

  assert.equal(result.planned, 1);
  assert.deepEqual(result.details.fetchTasks, [
    {
      id: "fetch_post:builder_1:post_1",
      builderId: "builder_1",
      status: "synced",
      summaryChars: 120,
      title: "Post 1",
      url: "https://example.com/post-1",
    },
  ]);
});

test("fetch run details merge long planned task ids with outcomes", () => {
  const longTaskId = `fetch_post:builder_1:${"a".repeat(420)}`;
  const result = mergeFetchRunDetails(
    { perBuilder: [{ builderId: "builder_1" }] },
    {
      plannedTasks: [
        {
          id: longTaskId,
          builderId: "builder_1",
          title: "Long task",
          status: "pending",
        },
      ],
      taskOutcomes: [
        {
          fetchTaskId: longTaskId,
          status: "synced",
          summaryChars: 80,
          agentRuntime: "codex",
          agentModel: "gpt-test",
        },
      ],
    },
  );

  assert.equal(result.planned, 1);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.details.fetchTasks, [
    {
      id: longTaskId,
      builderId: "builder_1",
      title: "Long task",
      status: "synced",
      summaryChars: 80,
      agentRuntime: "codex",
      agentModel: "gpt-test",
    },
  ]);
  assert.equal(result.details.agentRuntime, "codex");
  assert.equal(result.details.agentModel, "gpt-test");
});

test("fetch run details do not downgrade a synced task after a late failed slice outcome", () => {
  const result = mergeFetchRunDetails(
    {
      fetchTasks: [
        {
          id: "fetch_post:builder_1:post_1",
          builderId: "builder_1",
          status: "synced",
          summaryChars: 80,
        },
      ],
    },
    {
      taskOutcomes: [
        {
          fetchTaskId: "fetch_post:builder_1:post_1",
          status: "failed",
          failureReason: "sync-builders-slice",
        },
      ],
    },
  );

  assert.deepEqual(result.details.fetchTasks, [
    {
      id: "fetch_post:builder_1:post_1",
      builderId: "builder_1",
      status: "synced",
      summaryChars: 80,
    },
  ]);
});
