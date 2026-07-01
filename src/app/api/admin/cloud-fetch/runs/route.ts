import { NextResponse } from "next/server";
import { getAgentJobRuns } from "@/lib/agent-job-runs";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import {
  serializeCloudFetchRun,
  serializeCloudWorkerHost,
  type CloudWorkerHostStatus,
} from "@/lib/cloud-fetch-run-log";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  const auth = await requireCloudFetchAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : null;
  if (beforeParam && (!before || Number.isNaN(before.getTime()))) {
    return NextResponse.json({ error: "Invalid before cursor." }, { status: 400 });
  }

  const rows = await prisma.cloudFetchRun.findMany({
    where: before ? { startedAt: { lt: before } } : {},
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    include: {
      tasks: {
        orderBy: { id: "asc" },
        include: { builder: { select: { name: true, sourceType: true } } },
      },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const leaseBatches = rows.slice(0, PAGE_SIZE).map(serializeCloudFetchRun);

  // Worker-host status only belongs on a fresh poll. Paginated history loads are
  // lease-batch only so older pages do not overwrite the live host panel.
  let workerHost: CloudWorkerHostStatus | null = null;
  if (!before) {
    try {
      const jobRuns = await getAgentJobRuns(auth.user.id, "cloud-library-fetch", 5);
      workerHost = serializeCloudWorkerHost(
        jobRuns.find((job) => job.status === "running" || job.status === "starting") ??
          jobRuns[0] ??
          null,
      );
    } catch {
      workerHost = serializeCloudWorkerHost(null);
    }
  }

  return NextResponse.json({
    leaseBatches,
    // Compatibility for callers that still use the original name.
    runs: leaseBatches,
    hasMore,
    workerHost,
    liveProgress: workerHost?.progress ?? null,
  });
}
