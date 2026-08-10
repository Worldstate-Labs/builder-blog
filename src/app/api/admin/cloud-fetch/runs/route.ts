import { getAgentJobRuns } from "@/lib/agent-job-runs";
import {
  serializeCloudFetchRun,
  serializeCloudWorkerHost,
} from "@/lib/cloud-fetch-run-log";
import {
  createCloudFetchRunsGetHandler,
  type CloudFetchRunsQuery,
} from "@/lib/cloud-fetch-runs-handler";
import { getPendingCloudFetchSources } from "@/lib/cloud-fetch-pending-sources";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { prisma } from "@/lib/prisma";

type PendingCloudFetchSourcesPrisma = Parameters<typeof getPendingCloudFetchSources>[0]["prisma"];

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null;
}

function readDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

const pendingCloudFetchSourcesPrisma: PendingCloudFetchSourcesPrisma = {
  cloudFetchConfig: {
    findUnique: (args) => prisma.cloudFetchConfig.findUnique(args),
  },
  cloudSourceTask: {
    findMany: () =>
      prisma.cloudSourceTask.findMany({
        where: {
          status: "ACTIVE",
          cloudLanguageLibrary: { enabled: true },
        },
        include: {
          builder: {
            select: {
              id: true,
              name: true,
              canonicalKey: true,
              sourceType: true,
            },
          },
        },
      }),
  },
  cloudSourceSubmission: {
    groupBy: async (args) => {
      const argsRecord = readRecord(args);
      const where = readRecord(argsRecord?.where);
      const builderIds = readStringArray(readRecord(where?.cloudBuilderId)?.in) ?? [];
      const rows = await prisma.cloudSourceSubmission.findMany({
        where: {
          cloudBuilderId: { in: builderIds },
          active: where?.active === true,
        },
        select: {
          cloudBuilderId: true,
        },
      });
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.cloudBuilderId, (counts.get(row.cloudBuilderId) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([cloudBuilderId, count]) => ({
        cloudBuilderId,
        _count: { _all: count },
      }));
    },
  },
  cloudFetchQueueItem: {
    findMany: async (args) => {
      const argsRecord = readRecord(args);
      const where = readRecord(argsRecord?.where);
      const status = where?.status;
      if (status === "LEASED") {
        const leaseExpiresAt = readDate(readRecord(where?.leaseExpiresAt)?.gt) ?? new Date(0);
        const rows = await prisma.cloudFetchQueueItem.findMany({
          where: {
            status: "LEASED",
            leaseExpiresAt: { gt: leaseExpiresAt },
          },
          select: {
            cloudSourceTaskId: true,
            status: true,
            dueAt: true,
            leaseExpiresAt: true,
            cloudSourceTask: {
              select: {
                estimatedTokenCost: true,
                builder: {
                  select: {
                    canonicalKey: true,
                    sourceType: true,
                  },
                },
              },
            },
          },
        });
        return rows.map((row) => ({ ...row, status: "LEASED" as const }));
      }

      const taskIds = readStringArray(readRecord(where?.cloudSourceTaskId)?.in) ?? [];
      const rows = await prisma.cloudFetchQueueItem.findMany({
        where: {
          cloudSourceTaskId: { in: taskIds },
          status: "QUEUED",
        },
        select: {
          cloudSourceTaskId: true,
          status: true,
          dueAt: true,
          leaseExpiresAt: true,
        },
      });
      return rows.map((row) => ({ ...row, status: "QUEUED" as const }));
    },
  },
  cloudFetchRunTask: {
    findMany: (args) => {
      const argsRecord = readRecord(args);
      const where = readRecord(argsRecord?.where);
      const startedAt = readDate(readRecord(where?.startedAt)?.gte) ?? new Date(0);
      const select = readRecord(argsRecord?.select);
      if (select && Object.hasOwn(select, "builder")) {
        return prisma.cloudFetchRunTask.findMany({
          where: {
            startedAt: { gte: startedAt },
          },
          select: {
            cloudSourceTaskId: true,
            status: true,
            startedAt: true,
            usageTokens: true,
            builder: {
              select: {
                canonicalKey: true,
              },
            },
          },
        });
      }

      return prisma.cloudFetchRunTask.findMany({
        where: {
          startedAt: { gte: startedAt },
        },
        select: {
          usageTokens: true,
        },
      });
    },
  },
};

async function listCloudFetchRuns(args: CloudFetchRunsQuery) {
  const rows = await prisma.cloudFetchRun.findMany({
    where: args.where,
    orderBy: args.orderBy,
    take: args.take,
    include: args.include,
  });
  return rows.map(serializeCloudFetchRun);
}

export const dynamic = "force-dynamic";

export const GET = createCloudFetchRunsGetHandler({
  requireCloudFetchAdmin,
  listCloudFetchRuns,
  loadWorkerHost: async (userId) => {
    const jobRuns = await getAgentJobRuns(userId, "cloud-library-fetch", 5);
    return serializeCloudWorkerHost(
      jobRuns.find((job) => job.status === "running" || job.status === "starting") ??
        jobRuns[0] ??
        null,
    );
  },
  getOfflineWorkerHost: () => serializeCloudWorkerHost(null),
  getPendingCloudFetchSources: () =>
    getPendingCloudFetchSources({
      prisma: pendingCloudFetchSourcesPrisma,
      now: new Date(),
    }),
});
