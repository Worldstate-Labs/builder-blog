import assert from "node:assert/strict";
import test from "node:test";

import { validateFetchSyncTaskBoundary } from "../src/lib/builder-feed-sync";

const plannedTask = {
  id: "fetch_post:builder_blog:BLOG_POST:post_1",
  builder: "Example Blog",
  builderId: "builder_blog",
  agentWorkType: "fetch_post",
  item: {
    kind: "BLOG_POST",
    externalId: "post_1",
    title: "Canonical title",
    url: "https://example.com/post-1",
    publishedAt: "2026-08-09T12:00:00.000Z",
    sourceName: "Example Blog",
  },
};

const validBuilder = {
  builderId: "builder_blog",
  kind: "BLOG" as const,
  sourceType: "blog",
  name: "Example Blog",
  subscribe: false,
  items: [{
    kind: "BLOG_POST" as const,
    externalId: "post_1",
    title: "Canonical title",
    url: "https://example.com/post-1",
    publishedAt: "2026-08-09T12:00:00.000Z",
    sourceName: "Example Blog",
    body: "A complete fetched body.",
    summary: "A useful summary.",
    rawJson: { fetchTaskId: plannedTask.id, builderId: plannedTask.builderId },
  }],
};

test("fetch sync boundary accepts an exactly plan-bound item", () => {
  assert.doesNotThrow(() => validateFetchSyncTaskBoundary({
    plannedTasks: [plannedTask],
    builders: [validBuilder],
    taskOutcomes: [],
  }));
});

test("fetch sync boundary rejects worker-authored stable identity changes", () => {
  const builder = {
    ...validBuilder,
    items: [{ ...validBuilder.items[0], externalId: "wrong_post", publishedAt: "2020-01-01T00:00:00.000Z" }],
  };
  assert.throws(
    () => validateFetchSyncTaskBoundary({ plannedTasks: [plannedTask], builders: [builder], taskOutcomes: [] }),
    /externalId_mismatch|publishedAt_mismatch/,
  );
});

test("fetch sync boundary rejects off-plan and duplicate normal task items", () => {
  const offPlan = {
    ...validBuilder,
    items: [{ ...validBuilder.items[0], rawJson: { fetchTaskId: "unknown_task" } }],
  };
  assert.throws(
    () => validateFetchSyncTaskBoundary({ plannedTasks: [plannedTask], builders: [offPlan], taskOutcomes: [] }),
    /unknown_fetch_task_id/,
  );

  const duplicate = { ...validBuilder, items: [validBuilder.items[0], { ...validBuilder.items[0] }] };
  assert.throws(
    () => validateFetchSyncTaskBoundary({ plannedTasks: [plannedTask], builders: [duplicate], taskOutcomes: [] }),
    /duplicate_task_result/,
  );
});

test("fetch sync boundary lets fallback discovery return multiple real posts for one assigned task", () => {
  const fallbackTask = {
    ...plannedTask,
    id: "fetch_post:builder_blog:agent-fallback",
    agentWorkType: "fetch_builder_fallback",
    item: {
      ...plannedTask.item,
      externalId: "agent-fallback:builder_blog",
      title: null,
      url: "https://example.com/feed.xml",
    },
  };
  const builders = [{
    ...validBuilder,
    items: ["one", "two"].map((id) => ({
      ...validBuilder.items[0],
      externalId: id,
      title: `Discovered ${id}`,
      url: `https://example.com/${id}`,
      rawJson: { fetchTaskId: fallbackTask.id, builderId: fallbackTask.builderId },
    })),
  }];
  assert.doesNotThrow(() => validateFetchSyncTaskBoundary({
    plannedTasks: [fallbackTask],
    builders,
    taskOutcomes: [],
  }));
});

test("fetch sync boundary rejects outcomes for unknown tasks or tasks that also returned items", () => {
  assert.throws(
    () => validateFetchSyncTaskBoundary({
      plannedTasks: [plannedTask],
      builders: [validBuilder],
      taskOutcomes: [{ fetchTaskId: plannedTask.id }],
    }),
    /duplicate_task_result/,
  );
  assert.throws(
    () => validateFetchSyncTaskBoundary({
      plannedTasks: [plannedTask],
      builders: [],
      taskOutcomes: [{ fetchTaskId: "unknown_task" }],
    }),
    /unknown_fetch_task_id/,
  );
});

test("fetch sync boundary accepts outcomes but not post items for pre-post tasks", () => {
  for (const task of [
    { id: "candidate_discovery:builder_blog", agentWorkType: "candidate_discovery_fallback" },
    { id: "user_action:builder_x", agentWorkType: "x_token_missing" },
  ]) {
    assert.doesNotThrow(() => validateFetchSyncTaskBoundary({
      plannedTasks: [task],
      builders: [],
      taskOutcomes: [{ fetchTaskId: task.id }],
    }));
    assert.throws(
      () => validateFetchSyncTaskBoundary({
        plannedTasks: [task],
        builders: [{
          ...validBuilder,
          items: [{ ...validBuilder.items[0], rawJson: { fetchTaskId: task.id } }],
        }],
        taskOutcomes: [],
      }),
      /task_does_not_accept_items/,
    );
  }
});
