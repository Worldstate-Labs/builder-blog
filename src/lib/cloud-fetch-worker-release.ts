import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
} from "@prisma/client";

import { recomputeCloudFetchRun } from "@/lib/cloud-fetch-run-lifecycle";
import { lockCloudFetchRunTaskRows } from "@/lib/cloud-fetch-run-task-lock";
import { lockResetFenceForWorker } from "@/lib/reset-fence";

const CLOUD_WORKER_RELEASE_TRANSACTION_OPTIONS = {
  maxWait: 60_000,
  timeout: 60_000,
} as const;

export const CLOUD_WORKER_RELEASE_OUTCOME = {
  released: "released",
  alreadyReleased: "already_released",
} as const;

export const CLOUD_WORKER_RELEASE_ERROR = {
  jobNotFound: "cloud_release_job_not_found",
  resetFenced: "agent_job_reset_fenced",
} as const;

export const CLOUD_WORKER_RELEASE_REASONS = [
  "cloud_worker_replaced",
  "cloud_worker_stopped",
  "runtime_installation_failed",
  "runtime_auth_failed",
  "runtime_model_incompatible",
] as const;

export type CloudWorkerReleaseReason =
  typeof CLOUD_WORKER_RELEASE_REASONS[number];

export const DEFAULT_CLOUD_WORKER_RELEASE_REASON: CloudWorkerReleaseReason =
  "cloud_worker_replaced";

type CloudWorkerReleaseOutcome =
  typeof CLOUD_WORKER_RELEASE_OUTCOME[keyof typeof CLOUD_WORKER_RELEASE_OUTCOME];

type CloudWorkerReleaseResult = {
  outcome: CloudWorkerReleaseOutcome;
  releasedRuns: number;
  releasedSourceTasks: number;
  requeuedQueueItems: number;
};

type CloudWorkerReleaseDb = {
  $transaction<T>(
    callback: (tx: CloudWorkerReleaseTx) => Promise<T>,
    options?: typeof CLOUD_WORKER_RELEASE_TRANSACTION_OPTIONS,
  ): Promise<T>;
};

type CloudWorkerReleaseTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  resetFence: {
    upsert?(args: unknown): Promise<{ lastResetAt: Date }>;
    update(args: unknown): Promise<{ lastResetAt: Date }>;
  };
  agentJobRun: {
    findFirst(args: {
      where: { userId: string; jobType: "cloud-library-fetch"; instanceId: string };
      select: { id: true; createdAt: true };
    }): Promise<{ id: string; createdAt: Date } | null>;
  };
  cloudFetchRun: {
    findMany(args: {
      where: {
        createdByUserId: string;
        agentJobRunId: string;
        status: CloudFetchRunStatus;
      };
      orderBy: Array<{ id: "asc" }>;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  cloudFetchRunTask: {
    findMany(args: {
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
    }): Promise<Array<{
      cloudSourceTaskId: string;
      status: string;
      usageTokens?: number | null;
      usageCostUsd?: number | string | { toString(): string } | null;
    }>>;
    updateMany(args: {
      where: {
        runId: string;
        cloudSourceTaskId: string;
        status: CloudFetchRunStatus;
      };
      data: {
        status: CloudFetchRunStatus;
        finishedAt: Date;
        failureReason: CloudWorkerReleaseReason;
      };
    }): Promise<{ count: number }>;
  };
  cloudFetchQueueItem: {
    updateMany(args: {
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
    }): Promise<{ count: number }>;
  };
};

export class CloudWorkerReleaseJobNotFoundError extends Error {
  readonly statusCode = 409;
  readonly responseCode = CLOUD_WORKER_RELEASE_ERROR.jobNotFound;
  readonly retryable = false;

  constructor() {
    super("This cloud worker release was replaced. Start a new cloud worker.");
    this.name = "CloudWorkerReleaseJobNotFoundError";
  }
}

export async function releaseCloudFetchWorkerLeases(params: {
  userId: string;
  instanceId: string;
  reason?: CloudWorkerReleaseReason;
  prisma?: CloudWorkerReleaseDb;
  now?: Date;
}): Promise<CloudWorkerReleaseResult> {
  const prisma = params.prisma ?? await loadPrisma();
  const now = params.now ?? new Date();
  return prisma.$transaction(
    (tx) => releaseCloudFetchWorkerLeasesInTransaction({
      userId: params.userId,
      instanceId: String(params.instanceId ?? "").trim(),
      reason: params.reason ?? DEFAULT_CLOUD_WORKER_RELEASE_REASON,
      now,
      tx,
    }),
    CLOUD_WORKER_RELEASE_TRANSACTION_OPTIONS,
  );
}

export async function releaseCloudFetchWorkerLeasesInTransaction(params: {
  userId: string;
  instanceId: string;
  reason: CloudWorkerReleaseReason;
  now: Date;
  tx: CloudWorkerReleaseTx;
}): Promise<CloudWorkerReleaseResult> {
  const job = await params.tx.agentJobRun.findFirst({
    where: {
      userId: params.userId,
      jobType: "cloud-library-fetch",
      instanceId: params.instanceId,
    },
    select: { id: true, createdAt: true },
  });
  if (!job) throw new CloudWorkerReleaseJobNotFoundError();

  await lockResetFenceForWorker(params.tx, job.createdAt);

  const runs = await params.tx.cloudFetchRun.findMany({
    where: {
      createdByUserId: params.userId,
      agentJobRunId: job.id,
      status: CloudFetchRunStatus.RUNNING,
    },
    orderBy: [{ id: "asc" }],
    select: { id: true },
  });

  let releasedRuns = 0;
  let releasedSourceTasks = 0;
  let requeuedQueueItems = 0;

  for (const run of runs) {
    const runningTaskRows = await params.tx.cloudFetchRunTask.findMany({
      where: {
        runId: run.id,
        status: CloudFetchRunStatus.RUNNING,
      },
      orderBy: [{ cloudSourceTaskId: "asc" }],
      select: { cloudSourceTaskId: true },
    });
    const taskIds = runningTaskRows.map((task) => task.cloudSourceTaskId);
    if (taskIds.length === 0) continue;

    await lockCloudFetchRunTaskRows(params.tx, {
      runId: run.id,
      cloudSourceTaskIds: taskIds,
    });

    const lockedRunningTasks = await params.tx.cloudFetchRunTask.findMany({
      where: {
        runId: run.id,
        status: CloudFetchRunStatus.RUNNING,
        cloudSourceTaskId: { in: taskIds },
      },
      orderBy: [{ cloudSourceTaskId: "asc" }],
      select: { cloudSourceTaskId: true, status: true },
    });

    let runReleasedSourceTasks = 0;
    for (const task of lockedRunningTasks) {
      const releasedTask = await params.tx.cloudFetchRunTask.updateMany({
        where: {
          runId: run.id,
          cloudSourceTaskId: task.cloudSourceTaskId,
          status: CloudFetchRunStatus.RUNNING,
        },
        data: {
          status: CloudFetchRunStatus.FAILED,
          finishedAt: params.now,
          failureReason: params.reason,
        },
      });
      if (releasedTask.count === 0) continue;

      runReleasedSourceTasks += releasedTask.count;
      releasedSourceTasks += releasedTask.count;

      const requeuedItem = await params.tx.cloudFetchQueueItem.updateMany({
        where: {
          runId: run.id,
          cloudSourceTaskId: task.cloudSourceTaskId,
          status: CloudFetchQueueStatus.LEASED,
        },
        data: {
          status: CloudFetchQueueStatus.QUEUED,
          leasedAt: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          runId: null,
        },
      });
      requeuedQueueItems += requeuedItem.count;
    }

    if (runReleasedSourceTasks === 0) continue;
    releasedRuns += 1;
    await recomputeCloudFetchRun(params.tx, {
      runId: run.id,
      finishedAt: params.now,
    });
  }

  if (releasedSourceTasks === 0) {
    return {
      outcome: CLOUD_WORKER_RELEASE_OUTCOME.alreadyReleased,
      releasedRuns: 0,
      releasedSourceTasks: 0,
      requeuedQueueItems: 0,
    };
  }

  return {
    outcome: CLOUD_WORKER_RELEASE_OUTCOME.released,
    releasedRuns,
    releasedSourceTasks,
    requeuedQueueItems,
  };
}

async function loadPrisma(): Promise<CloudWorkerReleaseDb> {
  const prismaModule = await import("@/lib/prisma");
  return prismaModule.prisma as unknown as CloudWorkerReleaseDb;
}
