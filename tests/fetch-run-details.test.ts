import assert from "node:assert/strict";
import test from "node:test";
import {
  compactFetchRunDetailsForStorage,
  deriveFetchRunStatusFromDetails,
  mergeFetchRunDetails,
} from "../src/lib/fetch-run-details";

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
          readMethod: "Copied body from a Hub-shared post with the same URL",
          summaryMethod: "Copied matching-language summary from a Hub-shared post",
          hubSharedReuse: { bodyReused: true, summaryReused: true },
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
      readMethod: "Copied body from a Hub-shared post with the same URL",
      summaryMethod: "Copied matching-language summary from a Hub-shared post",
      hubSharedReuse: { bodyReused: true, summaryReused: true },
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

test("fetch run details replace fallback placeholders with attempted sync identity and stage evidence", () => {
  const result = mergeFetchRunDetails(
    {
      fetchTasks: [
        {
          id: "fetch_post:builder_1:fallback",
          builderId: "builder_1",
          title: null,
          url: "https://example.com/rss/",
          status: "pending",
        },
      ],
    },
    {
      taskOutcomes: [
        {
          fetchTaskId: "fetch_post:builder_1:fallback",
          status: "failed",
          failureReason: "task_sync_failed",
          title: "Actual article title",
          url: "https://example.com/articles/actual",
          bodyChars: 1200,
          summaryChars: 180,
          headlineChars: 52,
          completedStage: "summarize",
          syncError: "builders.0.items.0.publishedAt: Invalid input",
        },
      ],
    },
  );

  assert.deepEqual(result.details.fetchTasks, [
    {
      id: "fetch_post:builder_1:fallback",
      builderId: "builder_1",
      title: "Actual article title",
      url: "https://example.com/articles/actual",
      status: "failed",
      failureReason: "task_sync_failed",
      bodyChars: 1200,
      summaryChars: 180,
      headlineChars: 52,
      completedStage: "summarize",
      syncError: "builders.0.items.0.publishedAt: Invalid input",
    },
  ]);
});

test("fetch run details merge shard worker usage separately from post tasks", () => {
  const result = mergeFetchRunDetails(
    {
      fetchTasks: [
        {
          id: "fetch_post:builder_1:post_1",
          builderId: "builder_1",
          status: "pending",
        },
      ],
    },
    {
      workerUsages: [
        {
          workerId: "shard-0",
          usage: {
            inputTokens: 100,
            outputTokens: 25,
            totalTokens: 125,
            costUsd: 0.01,
          },
        },
      ],
    },
  );

  assert.deepEqual(result.details.fetchTasks, [
    {
      id: "fetch_post:builder_1:post_1",
      builderId: "builder_1",
      status: "pending",
    },
  ]);
  assert.deepEqual(result.details.workerUsages, [
    {
      workerId: "shard-0",
      usage: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        costUsd: 0.01,
      },
    },
  ]);
});

test("failed terminal post outcomes derive a failed fetch run status", () => {
  const result = mergeFetchRunDetails(
    {
      fetchTasks: [
        { id: "fetch_post:builder_1:post_1", builderId: "builder_1", status: "pending" },
        { id: "fetch_post:builder_1:post_2", builderId: "builder_1", status: "pending" },
      ],
    },
    {
      taskOutcomes: [
        {
          fetchTaskId: "fetch_post:builder_1:post_1",
          status: "failed",
          failureReason: "not_summarized",
        },
        {
          fetchTaskId: "fetch_post:builder_1:post_2",
          status: "failed",
          failureReason: "not_summarized",
        },
      ],
    },
  );

  assert.deepEqual(
    deriveFetchRunStatusFromDetails({ status: "ok", errorCount: 0 }, result.details),
    { status: "failed", errorCount: 2 },
  );
});

test("fetch run storage compaction preserves terminal accounting under the details cap", () => {
  const tasks = Array.from({ length: 98 }, (_, index) => {
    const id = `fetch_post:builder_${index % 8}:BLOG_POST:https%3A%2F%2Fexample.com%2Fposts%2F${index}`;
    return {
      id,
      builder: `Source ${index % 8}`,
      builderId: `builder_${index % 8}`,
      sourceType: "blog",
      contentStatus: "requires_agent",
      agentWorkType: "blog_article_fetch",
      title: `A long post title ${index} with enough text to resemble real feed data`,
      url: `https://example.com/posts/${index}?utm_source=followbrief`,
      status: "failed",
      failureReason: "runtime_timeout",
      evidence: {
        missingShard: {
          shard: `shard-${index % 5}`,
          taskIds: Array.from({ length: 20 }, (_, taskIndex) => `fetch_post:builder_${taskIndex}:post_${taskIndex}`),
          taskTitles: Array.from({ length: 10 }, (_, titleIndex) => `Large evidence title ${titleIndex}`),
          workerLogFile: `shard-${index % 5}-worker.log`,
        },
        runShardSummary: ["shard-0-result.json:missing", "shard-1-result.json:missing"],
      },
      workerId: `shard-${index % 5}`,
    };
  });

  const details = {
    cliFlags: { days: 30, limit: 3 },
    fetchTasks: tasks,
    perBuilder: [{ builderId: "builder_1" }],
  };
  assert.ok(Buffer.byteLength(JSON.stringify(details), "utf8") > 100_000);

  const compacted = compactFetchRunDetailsForStorage(details, 100_000);
  const compactedFetchTasks = compacted.details.fetchTasks as Array<{
    status?: string;
    evidence?: unknown;
  }>;

  assert.equal(compacted.compacted, true);
  assert.ok(compacted.bytes <= 100_000);
  assert.equal(compactedFetchTasks.length, 98);
  assert.equal(compactedFetchTasks.filter((task) => task.status === "failed").length, 98);
  assert.equal(compactedFetchTasks.some((task) => task.evidence), false);
  assert.deepEqual(
    deriveFetchRunStatusFromDetails({ status: "ok", errorCount: 0 }, compacted.details),
    { status: "failed", errorCount: 98 },
  );
});

test("fetch run storage compaction preserves minimum sync-failure lifecycle evidence", () => {
  const task = {
    id: "fetch_post:builder_1:post_sync_failed",
    builder: "Example source",
    builderId: "builder_1",
    sourceType: "blog",
    status: "failed",
    failureReason: "task_sync_failed",
    title: "The actual fetched article",
    url: "https://example.com/posts/actual-article",
    bodyChars: 1200,
    bodyWords: 190,
    summaryChars: 180,
    summaryWords: 31,
    headlineChars: 52,
    headlineWords: 8,
    completedStage: "summarize",
    syncError: "builders.0.items.0.publishedAt: Invalid input",
    evidence: { verbose: "x".repeat(20_000) },
  };

  const compacted = compactFetchRunDetailsForStorage(
    { fetchTasks: [task], verbose: "y".repeat(20_000) },
    2_000,
  );
  const result = (compacted.details.fetchTasks as Array<Record<string, unknown>>)[0];

  assert.equal(compacted.compacted, true);
  assert.equal(result.evidence, undefined);
  assert.equal(result.title, task.title);
  assert.equal(result.url, task.url);
  assert.equal(result.completedStage, "summarize");
  assert.equal(result.syncError, task.syncError);
  assert.equal(result.bodyChars, 1200);
  assert.equal(result.summaryChars, 180);
  assert.equal(result.headlineChars, 52);
});
