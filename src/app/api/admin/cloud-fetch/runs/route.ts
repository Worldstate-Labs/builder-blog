import { getAgentJobRuns } from "@/lib/agent-job-runs";
import {
  serializeCloudFetchRun,
  serializeCloudWorkerHost,
} from "@/lib/cloud-fetch-run-log";
import { createCloudFetchRunsGetHandler } from "@/lib/cloud-fetch-runs-handler";
import { getPendingCloudFetchSources } from "@/lib/cloud-fetch-pending-sources";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { prisma } from "@/lib/prisma";

type PendingCloudFetchSourcesParams = Parameters<typeof getPendingCloudFetchSources>[0];

export const dynamic = "force-dynamic";

export const GET = createCloudFetchRunsGetHandler({
  requireCloudFetchAdmin,
  listCloudFetchRuns: (args) => prisma.cloudFetchRun.findMany(args as never),
  getAgentJobRuns,
  getPendingCloudFetchSources: () =>
    getPendingCloudFetchSources({
      prisma: prisma as unknown as PendingCloudFetchSourcesParams["prisma"],
      now: new Date(),
    }),
  serializeCloudFetchRun,
  serializeCloudWorkerHost,
});
