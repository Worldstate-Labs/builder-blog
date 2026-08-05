import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
} from "@prisma/client";

import {
  CLOUD_WORKER_RELEASE_ERROR,
  CLOUD_WORKER_RELEASE_OUTCOME,
  CloudWorkerReleaseJobNotFoundError,
  releaseCloudFetchWorkerLeases,
} from "../src/lib/cloud-fetch-worker-release";
import { GLOBAL_RESET_FENCE_ID, StaleWorkerWriteError } from "../src/lib/reset-fence";

type AgentJobRunRow = {
  id: string;
  userId: string;
  jobType: string;
  instanceId: string;
  createdAt: Date;
};

type CloudFetchRunRow = {
  id: string;
  status: CloudFetchRunStatus;
  createdByUserId: string | null;
  agentJobRunId: string | null;
  finishedAt: Date | null;
  tasksSucceeded: number;
  tasksFailed: number;
  usageTokens: number | null;
  usageCostUsd: number | null;
};

type CloudFetchRunTaskRow = {
  runId: string;
  cloudSourceTaskId: string;
  status: CloudFetchRunStatus;
  finishedAt: Date | null;
  failureReason: string | null;
  usageTokens: number | null;
  usageCostUsd: number | null;
  details: Record<string, unknown>;
};

type CloudFetchQueueItemRow = {
  id: string;
  runId: string | null;
  cloudSourceTaskId: string;
  status: CloudFetchQueueStatus;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseOwner: string | null;
};

type CloudSourceTaskSnapshot = {
  id: string;
  consecutiveFailures: number;
  consecutiveDeferrals: number;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
  lastDeferredAt: Date | null;
  nextAttemptAt: Date | null;
};

test("releaseCloudFetchWorkerLeases releases only the owned running work, recomputes affected runs, and is idempotent", async () => {
  const now = new Date("2026-08-05T12:00:00.000Z");
  const fixture = createReleaseFixture({
    lastResetAt: new Date("2026-08-05T11:00:00.000Z"),
    jobs: [
      {
        id: "job_owned",
        userId: "user_a",
        jobType: "cloud-library-fetch",
        instanceId: "worker_a",
        createdAt: new Date("2026-08-05T11:30:00.000Z"),
      },
      {
        id: "job_other",
        userId: "user_a",
        jobType: "digest-build",
        instanceId: "worker_a",
        createdAt: new Date("2026-08-05T11:20:00.000Z"),
      },
    ],
    runs: [
      emptyRun({
        id: "run_2",
        createdByUserId: "user_a",
        agentJobRunId: "job_owned",
      }),
      emptyRun({
        id: "run_1",
        createdByUserId: "user_a",
        agentJobRunId: "job_owned",
      }),
      emptyRun({
        id: "run_done",
        createdByUserId: "user_a",
        agentJobRunId: "job_owned",
        status: CloudFetchRunStatus.FAILED,
        finishedAt: new Date("2026-08-05T10:00:00.000Z"),
      }),
      emptyRun({
        id: "run_other_job",
        createdByUserId: "user_a",
        agentJobRunId: "job_other",
      }),
      emptyRun({
        id: "run_legacy",
        createdByUserId: "user_a",
        agentJobRunId: null,
      }),
    ],
    tasks: [
      runningTask("run_2", "task_d"),
      finalizedTask("run_2", "task_e", CloudFetchRunStatus.FAILED),
      runningTask("run_1", "task_b"),
      finalizedTask("run_1", "task_c", CloudFetchRunStatus.SUCCEEDED),
      runningTask("run_1", "task_a"),
      runningTask("run_other_job", "task_other_job"),
      runningTask("run_legacy", "task_legacy"),
    ],
    queueItems: [
      leasedQueueItem("queue_a", "run_1", "task_a"),
      leasedQueueItem("queue_b", "run_1", "task_b"),
      {
        ...leasedQueueItem("queue_d", "run_elsewhere", "task_d"),
        leaseOwner: "cloud-worker:other",
      },
      leasedQueueItem("queue_other_job", "run_other_job", "task_other_job"),
      leasedQueueItem("queue_legacy", "run_legacy", "task_legacy"),
    ],
    sourceTasks: [
      sourceTaskSnapshot("task_a"),
      sourceTaskSnapshot("task_b"),
      sourceTaskSnapshot("task_d"),
    ],
  });

  const result = await releaseCloudFetchWorkerLeases({
    userId: "user_a",
    instanceId: "worker_a",
    now,
    prisma: fixture.prisma as never,
  });

  assert.deepEqual(result, {
    outcome: CLOUD_WORKER_RELEASE_OUTCOME.released,
    releasedRuns: 2,
    releasedSourceTasks: 3,
    requeuedQueueItems: 2,
  });
  assert.deepEqual(fixture.transactionOptions, [{ maxWait: 60_000, timeout: 60_000 }]);
  assert.deepEqual(fixture.agentJobRunFindFirstCalls, [
    {
      where: {
        userId: "user_a",
        jobType: "cloud-library-fetch",
        instanceId: "worker_a",
      },
      select: { id: true, createdAt: true },
    },
  ]);
  assert.deepEqual(fixture.resetFenceLockValues, [[GLOBAL_RESET_FENCE_ID]]);
  assert.equal(fixture.resetFenceUpsertCalls.length, 0);
  assert.ok(
    fixture.operations.indexOf("resetFence.lock") < fixture.operations.indexOf("cloudFetchRun.findMany"),
  );
  assert.deepEqual(
    fixture.lockCalls.map((call) => ({
      runId: call.runId,
      cloudSourceTaskIds: call.cloudSourceTaskIds,
    })),
    [
      { runId: "run_1", cloudSourceTaskIds: ["task_a", "task_b"] },
      { runId: "run_2", cloudSourceTaskIds: ["task_d"] },
    ],
  );
  assert.match(fixture.lockCalls[0]!.query, /ORDER BY "cloudSourceTaskId" ASC\s+FOR UPDATE/);
  assert.match(fixture.lockCalls[1]!.query, /ORDER BY "cloudSourceTaskId" ASC\s+FOR UPDATE/);
  assert.deepEqual(
    fixture.cloudFetchRunTaskFindManyCalls.map((call) => call.orderBy ?? null),
    [
      [{ cloudSourceTaskId: "asc" }],
      [{ cloudSourceTaskId: "asc" }],
      null,
      [{ cloudSourceTaskId: "asc" }],
      [{ cloudSourceTaskId: "asc" }],
      null,
    ],
  );
  assert.deepEqual(
    fixture.cloudFetchRunTaskUpdateManyCalls.map((call) => call.where),
    [
      { runId: "run_1", cloudSourceTaskId: "task_a", status: CloudFetchRunStatus.RUNNING },
      { runId: "run_1", cloudSourceTaskId: "task_b", status: CloudFetchRunStatus.RUNNING },
      { runId: "run_2", cloudSourceTaskId: "task_d", status: CloudFetchRunStatus.RUNNING },
    ],
  );
  for (const call of fixture.cloudFetchRunTaskUpdateManyCalls) {
    assert.deepEqual(call.data, {
      status: CloudFetchRunStatus.FAILED,
      finishedAt: now,
      failureReason: "cloud_worker_replaced",
    });
  }
  assert.deepEqual(
    fixture.cloudFetchQueueItemUpdateManyCalls.map((call) => call.where),
    [
      { runId: "run_1", cloudSourceTaskId: "task_a", status: CloudFetchQueueStatus.LEASED },
      { runId: "run_1", cloudSourceTaskId: "task_b", status: CloudFetchQueueStatus.LEASED },
      { runId: "run_2", cloudSourceTaskId: "task_d", status: CloudFetchQueueStatus.LEASED },
    ],
  );
  for (const call of fixture.cloudFetchQueueItemUpdateManyCalls) {
    assert.deepEqual(call.data, {
      status: CloudFetchQueueStatus.QUEUED,
      leasedAt: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      runId: null,
    });
  }
  assert.deepEqual(
    fixture.cloudFetchRunUpdateCalls,
    [
      {
        where: { id: "run_1" },
        data: {
          status: CloudFetchRunStatus.PARTIAL,
          finishedAt: now,
          tasksSucceeded: 1,
          tasksFailed: 2,
          usageTokens: null,
          usageCostUsd: null,
        },
      },
      {
        where: { id: "run_2" },
        data: {
          status: CloudFetchRunStatus.FAILED,
          finishedAt: now,
          tasksSucceeded: 0,
          tasksFailed: 2,
          usageTokens: null,
          usageCostUsd: null,
        },
      },
    ],
  );
  assert.equal(findTask(fixture.tasks, "run_1", "task_a").status, CloudFetchRunStatus.FAILED);
  assert.equal(findTask(fixture.tasks, "run_1", "task_b").status, CloudFetchRunStatus.FAILED);
  assert.equal(findTask(fixture.tasks, "run_2", "task_d").status, CloudFetchRunStatus.FAILED);
  assert.equal(findTask(fixture.tasks, "run_1", "task_c").status, CloudFetchRunStatus.SUCCEEDED);
  assert.equal(findTask(fixture.tasks, "run_other_job", "task_other_job").status, CloudFetchRunStatus.RUNNING);
  assert.equal(findTask(fixture.tasks, "run_legacy", "task_legacy").status, CloudFetchRunStatus.RUNNING);
  assert.deepEqual(
    fixture.queueItems.map((item) => ({
      id: item.id,
      runId: item.runId,
      status: item.status,
      leaseOwner: item.leaseOwner,
    })),
    [
      { id: "queue_a", runId: null, status: CloudFetchQueueStatus.QUEUED, leaseOwner: null },
      { id: "queue_b", runId: null, status: CloudFetchQueueStatus.QUEUED, leaseOwner: null },
      { id: "queue_d", runId: "run_elsewhere", status: CloudFetchQueueStatus.LEASED, leaseOwner: "cloud-worker:other" },
      { id: "queue_other_job", runId: "run_other_job", status: CloudFetchQueueStatus.LEASED, leaseOwner: "cloud-worker:test" },
      { id: "queue_legacy", runId: "run_legacy", status: CloudFetchQueueStatus.LEASED, leaseOwner: "cloud-worker:test" },
    ],
  );
  assert.deepEqual(
    fixture.runs.map((run) => ({
      id: run.id,
      status: run.status,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      tasksSucceeded: run.tasksSucceeded,
      tasksFailed: run.tasksFailed,
    })),
    [
      { id: "run_2", status: CloudFetchRunStatus.FAILED, finishedAt: now.toISOString(), tasksSucceeded: 0, tasksFailed: 2 },
      { id: "run_1", status: CloudFetchRunStatus.PARTIAL, finishedAt: now.toISOString(), tasksSucceeded: 1, tasksFailed: 2 },
      { id: "run_done", status: CloudFetchRunStatus.FAILED, finishedAt: "2026-08-05T10:00:00.000Z", tasksSucceeded: 0, tasksFailed: 0 },
      { id: "run_other_job", status: CloudFetchRunStatus.RUNNING, finishedAt: null, tasksSucceeded: 0, tasksFailed: 0 },
      { id: "run_legacy", status: CloudFetchRunStatus.RUNNING, finishedAt: null, tasksSucceeded: 0, tasksFailed: 0 },
    ],
  );
  assert.deepEqual(fixture.sourceTasks, [
    sourceTaskSnapshot("task_a"),
    sourceTaskSnapshot("task_b"),
    sourceTaskSnapshot("task_d"),
  ]);

  const runUpdateCount = fixture.cloudFetchRunUpdateCalls.length;
  const taskUpdateCount = fixture.cloudFetchRunTaskUpdateManyCalls.length;
  const queueUpdateCount = fixture.cloudFetchQueueItemUpdateManyCalls.length;

  const repeat = await releaseCloudFetchWorkerLeases({
    userId: "user_a",
    instanceId: "worker_a",
    now,
    prisma: fixture.prisma as never,
  });

  assert.deepEqual(repeat, {
    outcome: CLOUD_WORKER_RELEASE_OUTCOME.alreadyReleased,
    releasedRuns: 0,
    releasedSourceTasks: 0,
    requeuedQueueItems: 0,
  });
  assert.equal(fixture.cloudFetchRunUpdateCalls.length, runUpdateCount);
  assert.equal(fixture.cloudFetchRunTaskUpdateManyCalls.length, taskUpdateCount);
  assert.equal(fixture.cloudFetchQueueItemUpdateManyCalls.length, queueUpdateCount);
});

test("releaseCloudFetchWorkerLeases throws a dedicated not-found conflict before any generated-state writes", async () => {
  for (const scenario of [
    {
      name: "missing worker instance",
      userId: "user_a",
      instanceId: "missing_worker",
      jobs: [] as AgentJobRunRow[],
    },
    {
      name: "cross-admin worker instance",
      userId: "user_a",
      instanceId: "worker_a",
      jobs: [
        {
          id: "job_other_user",
          userId: "user_b",
          jobType: "cloud-library-fetch",
          instanceId: "worker_a",
          createdAt: new Date("2026-08-05T11:30:00.000Z"),
        },
      ],
    },
    {
      name: "wrong job type",
      userId: "user_a",
      instanceId: "worker_a",
      jobs: [
        {
          id: "job_wrong_type",
          userId: "user_a",
          jobType: "digest-build",
          instanceId: "worker_a",
          createdAt: new Date("2026-08-05T11:30:00.000Z"),
        },
      ],
    },
  ]) {
    const fixture = createReleaseFixture({
      lastResetAt: new Date("2026-08-05T11:00:00.000Z"),
      jobs: scenario.jobs,
      runs: [emptyRun({ id: "run_1", createdByUserId: "user_a", agentJobRunId: "job_missing" })],
      tasks: [runningTask("run_1", "task_a")],
      queueItems: [leasedQueueItem("queue_a", "run_1", "task_a")],
      sourceTasks: [sourceTaskSnapshot("task_a")],
    });

    await assert.rejects(
      releaseCloudFetchWorkerLeases({
        userId: scenario.userId,
        instanceId: scenario.instanceId,
        now: new Date("2026-08-05T12:00:00.000Z"),
        prisma: fixture.prisma as never,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CloudWorkerReleaseJobNotFoundError, scenario.name);
        assert.equal(error.statusCode, 409);
        assert.equal(error.responseCode, CLOUD_WORKER_RELEASE_ERROR.jobNotFound);
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(fixture.operations.includes("resetFence.lock"), false, scenario.name);
    assert.equal(fixture.operations.includes("cloudFetchRun.findMany"), false, scenario.name);
    assert.equal(fixture.cloudFetchRunTaskUpdateManyCalls.length, 0, scenario.name);
    assert.equal(fixture.cloudFetchQueueItemUpdateManyCalls.length, 0, scenario.name);
    assert.equal(fixture.cloudFetchRunUpdateCalls.length, 0, scenario.name);
  }
});

test("releaseCloudFetchWorkerLeases propagates reset fencing before any Cloud writes", async () => {
  const fixture = createReleaseFixture({
    lastResetAt: new Date("2026-08-05T11:30:00.000Z"),
    jobs: [
      {
        id: "job_owned",
        userId: "user_a",
        jobType: "cloud-library-fetch",
        instanceId: "worker_a",
        createdAt: new Date("2026-08-05T11:30:00.000Z"),
      },
    ],
    runs: [emptyRun({ id: "run_1", createdByUserId: "user_a", agentJobRunId: "job_owned" })],
    tasks: [runningTask("run_1", "task_a")],
    queueItems: [leasedQueueItem("queue_a", "run_1", "task_a")],
    sourceTasks: [sourceTaskSnapshot("task_a")],
  });

  await assert.rejects(
    releaseCloudFetchWorkerLeases({
      userId: "user_a",
      instanceId: "worker_a",
      now: new Date("2026-08-05T12:00:00.000Z"),
      prisma: fixture.prisma as never,
    }),
    StaleWorkerWriteError,
  );
  assert.deepEqual(fixture.operations, [
    "agentJobRun.findFirst",
    "resetFence.lock",
  ]);
  assert.equal(fixture.cloudFetchRunTaskUpdateManyCalls.length, 0);
  assert.equal(fixture.cloudFetchQueueItemUpdateManyCalls.length, 0);
  assert.equal(fixture.cloudFetchRunUpdateCalls.length, 0);
});

test("releaseCloudFetchWorkerLeases returns already_released when the owned job has no running matching work", async () => {
  const fixture = createReleaseFixture({
    lastResetAt: new Date("2026-08-05T11:00:00.000Z"),
    jobs: [
      {
        id: "job_owned",
        userId: "user_a",
        jobType: "cloud-library-fetch",
        instanceId: "worker_a",
        createdAt: new Date("2026-08-05T11:30:00.000Z"),
      },
    ],
    runs: [
      emptyRun({
        id: "run_done",
        createdByUserId: "user_a",
        agentJobRunId: "job_owned",
        status: CloudFetchRunStatus.FAILED,
        finishedAt: new Date("2026-08-05T10:00:00.000Z"),
      }),
      emptyRun({
        id: "run_legacy",
        createdByUserId: "user_a",
        agentJobRunId: null,
      }),
    ],
    tasks: [
      finalizedTask("run_done", "task_a", CloudFetchRunStatus.FAILED),
      runningTask("run_legacy", "task_b"),
    ],
    queueItems: [
      leasedQueueItem("queue_done", "run_done", "task_a"),
      leasedQueueItem("queue_legacy", "run_legacy", "task_b"),
    ],
    sourceTasks: [sourceTaskSnapshot("task_a"), sourceTaskSnapshot("task_b")],
  });

  const result = await releaseCloudFetchWorkerLeases({
    userId: "user_a",
    instanceId: "worker_a",
    now: new Date("2026-08-05T12:00:00.000Z"),
    prisma: fixture.prisma as never,
  });

  assert.deepEqual(result, {
    outcome: CLOUD_WORKER_RELEASE_OUTCOME.alreadyReleased,
    releasedRuns: 0,
    releasedSourceTasks: 0,
    requeuedQueueItems: 0,
  });
  assert.equal(fixture.lockCalls.length, 0);
  assert.equal(fixture.cloudFetchRunTaskUpdateManyCalls.length, 0);
  assert.equal(fixture.cloudFetchQueueItemUpdateManyCalls.length, 0);
  assert.equal(fixture.cloudFetchRunUpdateCalls.length, 0);
});

test("duplicate release requests lock runs and task rows in the same deterministic order", async () => {
  const first = createReleaseFixture(defaultDuplicateFixtureInput());
  const second = createReleaseFixture(defaultDuplicateFixtureInput());
  const now = new Date("2026-08-05T12:00:00.000Z");

  await releaseCloudFetchWorkerLeases({
    userId: "user_a",
    instanceId: "worker_a",
    now,
    prisma: first.prisma as never,
  });
  await releaseCloudFetchWorkerLeases({
    userId: "user_a",
    instanceId: "worker_a",
    now,
    prisma: second.prisma as never,
  });

  assert.deepEqual(
    first.lockCalls.map((call) => ({
      runId: call.runId,
      cloudSourceTaskIds: call.cloudSourceTaskIds,
    })),
    [
      { runId: "run_1", cloudSourceTaskIds: ["task_a", "task_b"] },
      { runId: "run_2", cloudSourceTaskIds: ["task_c"] },
    ],
  );
  assert.deepEqual(
    second.lockCalls.map((call) => ({
      runId: call.runId,
      cloudSourceTaskIds: call.cloudSourceTaskIds,
    })),
    first.lockCalls.map((call) => ({
      runId: call.runId,
      cloudSourceTaskIds: call.cloudSourceTaskIds,
    })),
  );
  for (const call of [...first.lockCalls, ...second.lockCalls]) {
    assert.match(call.query, /ORDER BY "cloudSourceTaskId" ASC\s+FOR UPDATE/);
  }
});

function createReleaseFixture(input: {
  lastResetAt: Date;
  jobs: AgentJobRunRow[];
  runs: CloudFetchRunRow[];
  tasks: CloudFetchRunTaskRow[];
  queueItems: CloudFetchQueueItemRow[];
  sourceTasks: CloudSourceTaskSnapshot[];
}) {
  const jobs = input.jobs.map((job) => ({ ...job }));
  const runs = input.runs.map((run) => ({ ...run }));
  const tasks = input.tasks.map((task) => ({ ...task, details: { ...task.details } }));
  const queueItems = input.queueItems.map((item) => ({ ...item }));
  const sourceTasks = input.sourceTasks.map((task) => ({ ...task }));
  const operations: string[] = [];
  const agentJobRunFindFirstCalls: Array<{
    where: { userId: string; jobType: string; instanceId: string };
    select: { id: true; createdAt: true };
  }> = [];
  const resetFenceLockValues: unknown[][] = [];
  const resetFenceUpsertCalls: unknown[] = [];
  const transactionOptions: unknown[] = [];
  const lockCalls: Array<{ query: string; runId: string; cloudSourceTaskIds: string[] }> = [];
  const cloudFetchRunTaskFindManyCalls: Array<{ where: Record<string, unknown>; orderBy?: unknown }> = [];
  const cloudFetchRunTaskUpdateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const cloudFetchQueueItemUpdateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const cloudFetchRunUpdateCalls: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  const tx = {
    async $queryRawUnsafe(query: string, ...values: unknown[]) {
      if (query.includes('SELECT "lastResetAt" FROM "ResetFence"')) {
        operations.push("resetFence.lock");
        resetFenceLockValues.push(values);
        return [{ lastResetAt: input.lastResetAt }];
      }
      if (query.includes('FROM "CloudFetchRunTask"')) {
        const runId = String(values[0]);
        const cloudSourceTaskIds = values.slice(1).map((value) => String(value));
        operations.push("cloudFetchRunTask.lock");
        lockCalls.push({ query, runId, cloudSourceTaskIds });
        return tasks
          .filter((task) => task.runId === runId && cloudSourceTaskIds.includes(task.cloudSourceTaskId))
          .sort((left, right) => left.cloudSourceTaskId.localeCompare(right.cloudSourceTaskId))
          .map((task) => ({
            cloudSourceTaskId: task.cloudSourceTaskId,
            status: task.status,
            details: task.details,
          }));
      }
      throw new Error(`Unexpected raw query: ${query}`);
    },
    resetFence: {
      async upsert(args: unknown) {
        resetFenceUpsertCalls.push(args);
        return { lastResetAt: input.lastResetAt };
      },
      async update() {
        throw new Error("resetFence.update should not be used");
      },
    },
    agentJobRun: {
      async findFirst(args: {
        where: { userId: string; jobType: string; instanceId: string };
        select: { id: true; createdAt: true };
      }) {
        operations.push("agentJobRun.findFirst");
        agentJobRunFindFirstCalls.push(args);
        return jobs.find((job) =>
          job.userId === args.where.userId &&
          job.jobType === args.where.jobType &&
          job.instanceId === args.where.instanceId
        ) ?? null;
      },
    },
    cloudFetchRun: {
      async findMany(args: {
        where: { createdByUserId: string; agentJobRunId: string; status: CloudFetchRunStatus };
        orderBy: Array<{ id: "asc" }>;
        select: { id: true };
      }) {
        operations.push("cloudFetchRun.findMany");
        return runs
          .filter((run) =>
            run.createdByUserId === args.where.createdByUserId &&
            run.agentJobRunId === args.where.agentJobRunId &&
            run.status === args.where.status
          )
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((run) => ({ id: run.id }));
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        operations.push("cloudFetchRun.update");
        cloudFetchRunUpdateCalls.push(args);
        const row = runs.find((run) => run.id === args.where.id);
        assert.ok(row, `Missing run ${args.where.id}`);
        Object.assign(row, args.data);
        return { ...row };
      },
    },
    cloudFetchRunTask: {
      async findMany(args: { where: Record<string, unknown>; orderBy?: unknown }) {
        operations.push("cloudFetchRunTask.findMany");
        cloudFetchRunTaskFindManyCalls.push(args);
        const where = args.where as {
          runId: string;
          status?: CloudFetchRunStatus;
          cloudSourceTaskId?: { in?: string[] };
        };
        const selectedIds = where.cloudSourceTaskId?.in;
        const rows = tasks.filter((task) =>
          task.runId === where.runId &&
          (where.status == null || task.status === where.status) &&
          (selectedIds == null || selectedIds.includes(task.cloudSourceTaskId))
        );
        return rows
          .slice()
          .sort((left, right) => left.cloudSourceTaskId.localeCompare(right.cloudSourceTaskId))
          .map((task) => ({ ...task, details: { ...task.details } }));
      },
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        operations.push("cloudFetchRunTask.updateMany");
        cloudFetchRunTaskUpdateManyCalls.push(args);
        const where = args.where as {
          runId: string;
          cloudSourceTaskId: string;
          status?: CloudFetchRunStatus;
        };
        const row = tasks.find((task) =>
          task.runId === where.runId &&
          task.cloudSourceTaskId === where.cloudSourceTaskId &&
          (where.status == null || task.status === where.status)
        );
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
    },
    cloudFetchQueueItem: {
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        operations.push("cloudFetchQueueItem.updateMany");
        cloudFetchQueueItemUpdateManyCalls.push(args);
        const where = args.where as {
          runId: string;
          cloudSourceTaskId: string;
          status: CloudFetchQueueStatus;
        };
        const row = queueItems.find((item) =>
          item.runId === where.runId &&
          item.cloudSourceTaskId === where.cloudSourceTaskId &&
          item.status === where.status
        );
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
    },
  };

  return {
    prisma: {
      async $transaction(
        callback: (client: typeof tx) => Promise<unknown>,
        options?: unknown,
      ) {
        transactionOptions.push(options ?? null);
        return callback(tx);
      },
    },
    jobs,
    runs,
    tasks,
    queueItems,
    sourceTasks,
    operations,
    agentJobRunFindFirstCalls,
    resetFenceLockValues,
    resetFenceUpsertCalls,
    transactionOptions,
    lockCalls,
    cloudFetchRunTaskFindManyCalls,
    cloudFetchRunTaskUpdateManyCalls,
    cloudFetchQueueItemUpdateManyCalls,
    cloudFetchRunUpdateCalls,
  };
}

function defaultDuplicateFixtureInput() {
  return {
    lastResetAt: new Date("2026-08-05T11:00:00.000Z"),
    jobs: [
      {
        id: "job_owned",
        userId: "user_a",
        jobType: "cloud-library-fetch",
        instanceId: "worker_a",
        createdAt: new Date("2026-08-05T11:30:00.000Z"),
      },
    ],
    runs: [
      emptyRun({ id: "run_2", createdByUserId: "user_a", agentJobRunId: "job_owned" }),
      emptyRun({ id: "run_1", createdByUserId: "user_a", agentJobRunId: "job_owned" }),
    ],
    tasks: [
      runningTask("run_2", "task_c"),
      runningTask("run_1", "task_b"),
      runningTask("run_1", "task_a"),
    ],
    queueItems: [
      leasedQueueItem("queue_c", "run_2", "task_c"),
      leasedQueueItem("queue_b", "run_1", "task_b"),
      leasedQueueItem("queue_a", "run_1", "task_a"),
    ],
    sourceTasks: [
      sourceTaskSnapshot("task_a"),
      sourceTaskSnapshot("task_b"),
      sourceTaskSnapshot("task_c"),
    ],
  };
}

function emptyRun(params: {
  id: string;
  createdByUserId: string | null;
  agentJobRunId: string | null;
  status?: CloudFetchRunStatus;
  finishedAt?: Date | null;
}): CloudFetchRunRow {
  return {
    id: params.id,
    status: params.status ?? CloudFetchRunStatus.RUNNING,
    createdByUserId: params.createdByUserId,
    agentJobRunId: params.agentJobRunId,
    finishedAt: params.finishedAt ?? null,
    tasksSucceeded: 0,
    tasksFailed: 0,
    usageTokens: null,
    usageCostUsd: null,
  };
}

function runningTask(runId: string, cloudSourceTaskId: string): CloudFetchRunTaskRow {
  return {
    runId,
    cloudSourceTaskId,
    status: CloudFetchRunStatus.RUNNING,
    finishedAt: null,
    failureReason: null,
    usageTokens: null,
    usageCostUsd: null,
    details: {},
  };
}

function finalizedTask(
  runId: string,
  cloudSourceTaskId: string,
  status: CloudFetchRunStatus,
): CloudFetchRunTaskRow {
  return {
    runId,
    cloudSourceTaskId,
    status,
    finishedAt: new Date("2026-08-05T10:30:00.000Z"),
    failureReason: status === CloudFetchRunStatus.FAILED ? "already_failed" : null,
    usageTokens: null,
    usageCostUsd: null,
    details: {},
  };
}

function leasedQueueItem(id: string, runId: string, cloudSourceTaskId: string): CloudFetchQueueItemRow {
  return {
    id,
    runId,
    cloudSourceTaskId,
    status: CloudFetchQueueStatus.LEASED,
    leasedAt: new Date("2026-08-05T11:45:00.000Z"),
    leaseExpiresAt: new Date("2026-08-05T12:15:00.000Z"),
    leaseOwner: "cloud-worker:test",
  };
}

function sourceTaskSnapshot(id: string): CloudSourceTaskSnapshot {
  return {
    id,
    consecutiveFailures: 2,
    consecutiveDeferrals: 1,
    lastFailureAt: new Date("2026-08-05T09:00:00.000Z"),
    lastFailureReason: "temporary_failure",
    lastDeferredAt: new Date("2026-08-05T09:15:00.000Z"),
    nextAttemptAt: new Date("2026-08-05T12:30:00.000Z"),
  };
}

function findTask(tasks: CloudFetchRunTaskRow[], runId: string, cloudSourceTaskId: string) {
  const row = tasks.find((task) => task.runId === runId && task.cloudSourceTaskId === cloudSourceTaskId);
  assert.ok(row, `Missing task ${runId}:${cloudSourceTaskId}`);
  return row;
}
