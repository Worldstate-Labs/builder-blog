import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
} from "@prisma/client";

import { reconcileTerminalCloudWorkerRuns } from "../src/lib/cloud-fetch-run-lifecycle";
import {
  CLOUD_WORKER_RELEASE_OUTCOME,
  releaseCloudFetchWorkerLeases,
} from "../src/lib/cloud-fetch-worker-release";

type AgentJobRunRow = {
  id: string;
  userId: string;
  jobType: string;
  instanceId: string;
  createdAt: Date;
  status: string;
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

type FindManyTaskArgs = {
  where: {
    runId: string;
    status?: CloudFetchRunStatus;
    cloudSourceTaskId?: { in: string[] };
  };
  orderBy?: Array<{ cloudSourceTaskId: "asc" }>;
  select?: {
    cloudSourceTaskId?: true;
    status?: true;
    usageTokens?: true;
    usageCostUsd?: true;
  };
};

type UpdateRunTaskArgs = {
  where: {
    runId: string;
    cloudSourceTaskId: string;
    status?: CloudFetchRunStatus;
  };
  data: {
    status: CloudFetchRunStatus;
    finishedAt: Date;
    failureReason: string;
  };
};

type UpdateQueueArgs = {
  where: {
    runId: string;
    cloudSourceTaskId: string;
    status: CloudFetchQueueStatus;
  };
  data: {
    status: CloudFetchQueueStatus;
    leasedAt: null;
    leaseExpiresAt: null;
    leaseOwner: null;
    runId: null;
  };
};

type UpdateRunArgs = {
  where: { id: string };
  data: {
    status: CloudFetchRunStatus;
    finishedAt: Date;
    tasksSucceeded: number;
    tasksFailed: number;
    usageTokens: number | null;
    usageCostUsd: number | null;
  };
};

test("release and terminal reconciliation split task ownership without duplicate run recompute and remain idempotent", async () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const fixture = createLifecycleRaceFixture();

  const [releaseResult, reconcileResult] = await Promise.all([
    releaseCloudFetchWorkerLeases({
      userId: "user_a",
      instanceId: "worker_a",
      now,
      prisma: fixture.prisma as never,
    }),
    reconcileTerminalCloudWorkerRuns({
      prisma: fixture.prisma as never,
      now,
    }),
  ]);

  assert.deepEqual(releaseResult, {
    outcome: CLOUD_WORKER_RELEASE_OUTCOME.released,
    releasedRuns: 1,
    releasedSourceTasks: 1,
    requeuedQueueItems: 1,
  });
  assert.deepEqual(reconcileResult, {
    reconciledRuns: 1,
    finalizedTasks: 1,
    requeuedQueueItems: 1,
  });
  assert.equal(fixture.lockCalls.length, 2);
  assert.deepEqual(countByActor(fixture.lockCalls), {
    reconcile: 1,
    release: 1,
  });
  for (const call of fixture.lockCalls) {
    assert.deepEqual(
      {
        runId: call.runId,
        cloudSourceTaskIds: call.cloudSourceTaskIds,
      },
      { runId: "run_1", cloudSourceTaskIds: ["task_a", "task_b"] },
    );
  }
  for (const call of fixture.lockCalls) {
    assert.match(call.query, /ORDER BY "cloudSourceTaskId" ASC\s+FOR UPDATE/);
  }
  assert.deepEqual(countByTask(fixture.runTaskUpdates), {
    task_a: 1,
    task_b: 1,
  });
  assert.deepEqual(countByTask(fixture.queueUpdates), {
    task_a: 1,
    task_b: 1,
  });
  assert.deepEqual(
    fixture.runUpdates,
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
    ],
  );
  assert.equal(findTask(fixture.tasks, "task_a").failureReason, "cloud_worker_replaced");
  assert.equal(findTask(fixture.tasks, "task_b").failureReason, "cloud_worker_stopped");
  assert.deepEqual(
    fixture.queueItems.map((item) => ({
      cloudSourceTaskId: item.cloudSourceTaskId,
      runId: item.runId,
      status: item.status,
      leaseOwner: item.leaseOwner,
    })),
    [
      {
        cloudSourceTaskId: "task_a",
        runId: null,
        status: CloudFetchQueueStatus.QUEUED,
        leaseOwner: null,
      },
      {
        cloudSourceTaskId: "task_b",
        runId: null,
        status: CloudFetchQueueStatus.QUEUED,
        leaseOwner: null,
      },
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
      {
        id: "run_1",
        status: CloudFetchRunStatus.PARTIAL,
        finishedAt: now.toISOString(),
        tasksSucceeded: 1,
        tasksFailed: 2,
      },
    ],
  );

  const runUpdateCount = fixture.runUpdates.length;
  const runTaskUpdateCount = fixture.runTaskUpdates.length;
  const queueUpdateCount = fixture.queueUpdates.length;

  const repeatRelease = await releaseCloudFetchWorkerLeases({
    userId: "user_a",
    instanceId: "worker_a",
    now,
    prisma: fixture.prisma as never,
  });
  const repeatReconcile = await reconcileTerminalCloudWorkerRuns({
    prisma: fixture.prisma as never,
    now,
  });

  assert.deepEqual(repeatRelease, {
    outcome: CLOUD_WORKER_RELEASE_OUTCOME.alreadyReleased,
    releasedRuns: 0,
    releasedSourceTasks: 0,
    requeuedQueueItems: 0,
  });
  assert.deepEqual(repeatReconcile, {
    reconciledRuns: 0,
    finalizedTasks: 0,
    requeuedQueueItems: 0,
  });
  assert.equal(fixture.runUpdates.length, runUpdateCount);
  assert.equal(fixture.runTaskUpdates.length, runTaskUpdateCount);
  assert.equal(fixture.queueUpdates.length, queueUpdateCount);
});

function createLifecycleRaceFixture() {
  const jobs: AgentJobRunRow[] = [
    {
      id: "job_owned",
      userId: "user_a",
      jobType: "cloud-library-fetch",
      instanceId: "worker_a",
      createdAt: new Date("2026-08-21T11:00:00.000Z"),
      status: "failed",
    },
  ];
  const runs: CloudFetchRunRow[] = [
    {
      id: "run_1",
      status: CloudFetchRunStatus.RUNNING,
      createdByUserId: "user_a",
      agentJobRunId: "job_owned",
      finishedAt: null,
      tasksSucceeded: 0,
      tasksFailed: 0,
      usageTokens: null,
      usageCostUsd: null,
    },
  ];
  const tasks: CloudFetchRunTaskRow[] = [
    runningTask("run_1", "task_a"),
    runningTask("run_1", "task_b"),
    finalizedTask("run_1", "task_c", CloudFetchRunStatus.SUCCEEDED),
  ];
  const queueItems: CloudFetchQueueItemRow[] = [
    leasedQueueItem("queue_a", "run_1", "task_a"),
    leasedQueueItem("queue_b", "run_1", "task_b"),
  ];
  const lockCalls: Array<{
    actor: "release" | "reconcile";
    query: string;
    runId: string;
    cloudSourceTaskIds: string[];
  }> = [];
  const runTaskUpdates: UpdateRunTaskArgs[] = [];
  const queueUpdates: UpdateQueueArgs[] = [];
  const runUpdates: UpdateRunArgs[] = [];
  const releaseUpdatedTaskA = deferred<void>();
  const reconcileFinishedTaskB = deferred<void>();
  const reconcileRecomputedRun = deferred<void>();

  const buildClient = (actor: "release" | "reconcile") => ({
    async $queryRawUnsafe(query: string, ...values: unknown[]) {
      if (query.includes('SELECT "lastResetAt" FROM "ResetFence"')) {
        return [{ lastResetAt: new Date("2026-08-21T10:00:00.000Z") }];
      }
      if (!query.includes('FROM "CloudFetchRunTask"')) {
        throw new Error(`Unexpected raw query: ${query}`);
      }
      const runId = String(values[0]);
      const cloudSourceTaskIds = values.slice(1).map((value) => String(value));
      lockCalls.push({ actor, query, runId, cloudSourceTaskIds });
      return tasks
        .filter((task) => task.runId === runId && cloudSourceTaskIds.includes(task.cloudSourceTaskId))
        .sort((left, right) => left.cloudSourceTaskId.localeCompare(right.cloudSourceTaskId))
        .map((task) => ({
          cloudSourceTaskId: task.cloudSourceTaskId,
          status: task.status,
          details: {},
        }));
    },
    resetFence: {
      async upsert() {
        return { lastResetAt: new Date("2026-08-21T10:00:00.000Z") };
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
        return jobs.find((job) =>
          job.userId === args.where.userId &&
          job.jobType === args.where.jobType &&
          job.instanceId === args.where.instanceId
        )
          ? { id: "job_owned", createdAt: new Date("2026-08-21T11:00:00.000Z") }
          : null;
      },
    },
    cloudFetchRun: {
      async findMany(args: {
        where: Record<string, unknown>;
        orderBy: Array<{ id: "asc" }>;
        select: { id: true };
      }) {
        const where = args.where as {
          id?: string;
          createdByUserId?: string;
          agentJobRunId?: string;
          status: CloudFetchRunStatus;
          agentJobRun?: { is?: { status?: { in?: string[] } } };
        };
        return runs
          .filter((run) => {
            if (typeof where.id === "string" && run.id !== where.id) return false;
            if (run.status !== where.status) return false;
            if (typeof where.createdByUserId === "string" && run.createdByUserId !== where.createdByUserId) {
              return false;
            }
            if (typeof where.agentJobRunId === "string" && run.agentJobRunId !== where.agentJobRunId) {
              return false;
            }
            const statuses = where.agentJobRun?.is?.status?.in;
            if (Array.isArray(statuses)) {
              const job = jobs.find((candidate) => candidate.id === run.agentJobRunId);
              if (!job || !statuses.includes(job.status)) return false;
            }
            return true;
          })
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((run) => ({ id: run.id }));
      },
      async update(args: UpdateRunArgs) {
        runUpdates.push(args);
        const run = runs.find((row) => row.id === args.where.id);
        assert.ok(run, `Missing run ${args.where.id}`);
        Object.assign(run, args.data);
        if (actor === "reconcile") {
          reconcileRecomputedRun.resolve();
        }
        return { ...run };
      },
    },
    cloudFetchRunTask: {
      async findMany(args: FindManyTaskArgs) {
        const selectedIds = args.where.cloudSourceTaskId?.in;
        if (actor === "reconcile" && selectedIds && selectedIds.length > 0) {
          await releaseUpdatedTaskA.promise;
        }
        return tasks
          .filter((task) =>
            task.runId === args.where.runId &&
            (args.where.status == null || task.status === args.where.status) &&
            (selectedIds == null || selectedIds.includes(task.cloudSourceTaskId))
          )
          .sort((left, right) => left.cloudSourceTaskId.localeCompare(right.cloudSourceTaskId))
          .map((task) => selectTaskRow(task, args.select));
      },
      async updateMany(args: UpdateRunTaskArgs) {
        const row = tasks.find((task) =>
          task.runId === args.where.runId &&
          task.cloudSourceTaskId === args.where.cloudSourceTaskId &&
          (args.where.status == null || task.status === args.where.status)
        );
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        runTaskUpdates.push(args);
        if (actor === "release" && args.where.cloudSourceTaskId === "task_a") {
          releaseUpdatedTaskA.resolve();
          await reconcileRecomputedRun.promise;
        }
        if (actor === "reconcile" && args.where.cloudSourceTaskId === "task_b") {
          reconcileFinishedTaskB.resolve();
        }
        return { count: 1 };
      },
    },
    cloudFetchQueueItem: {
      async updateMany(args: UpdateQueueArgs) {
        const row = queueItems.find((item) =>
          item.runId === args.where.runId &&
          item.cloudSourceTaskId === args.where.cloudSourceTaskId &&
          item.status === args.where.status
        );
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        queueUpdates.push(args);
        return { count: 1 };
      },
    },
  });

  const releaseTx = buildClient("release");
  const reconcileClient = buildClient("reconcile");

  const prisma = {
    ...reconcileClient,
    async $transaction<T>(callback: (tx: typeof releaseTx) => Promise<T>) {
      return callback(releaseTx);
    },
  };

  return {
    prisma,
    runs,
    tasks,
    queueItems,
    lockCalls,
    runTaskUpdates,
    queueUpdates,
    runUpdates,
  };
}

function selectTaskRow(
  task: CloudFetchRunTaskRow,
  select: FindManyTaskArgs["select"],
) {
  const row: Record<string, unknown> = {};
  if (select?.cloudSourceTaskId) row.cloudSourceTaskId = task.cloudSourceTaskId;
  if (select?.status) row.status = task.status;
  if (select?.usageTokens) row.usageTokens = task.usageTokens;
  if (select?.usageCostUsd) row.usageCostUsd = task.usageCostUsd;
  if (Object.keys(select ?? {}).length === 0) {
    row.cloudSourceTaskId = task.cloudSourceTaskId;
    row.status = task.status;
    row.usageTokens = task.usageTokens;
    row.usageCostUsd = task.usageCostUsd;
  }
  return row;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function countByTask<T extends { where: { cloudSourceTaskId: string } }>(rows: T[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.where.cloudSourceTaskId] = (counts[row.where.cloudSourceTaskId] ?? 0) + 1;
  }
  return counts;
}

function countByActor<T extends { actor: string }>(rows: T[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.actor] = (counts[row.actor] ?? 0) + 1;
  }
  return counts;
}

function findTask(tasks: CloudFetchRunTaskRow[], cloudSourceTaskId: string) {
  const task = tasks.find((candidate) => candidate.cloudSourceTaskId === cloudSourceTaskId);
  assert.ok(task, `Missing task ${cloudSourceTaskId}`);
  return task;
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
    finishedAt: new Date("2026-08-21T09:00:00.000Z"),
    failureReason: null,
    usageTokens: null,
    usageCostUsd: null,
  };
}

function leasedQueueItem(id: string, runId: string, cloudSourceTaskId: string): CloudFetchQueueItemRow {
  return {
    id,
    runId,
    cloudSourceTaskId,
    status: CloudFetchQueueStatus.LEASED,
    leasedAt: new Date("2026-08-21T11:30:00.000Z"),
    leaseExpiresAt: new Date("2026-08-21T12:30:00.000Z"),
    leaseOwner: "cloud-worker:test",
  };
}
