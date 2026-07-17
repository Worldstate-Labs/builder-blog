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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireCloudFetchAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const beforeId = url.searchParams.get("beforeId");
  const before = beforeParam ? new Date(beforeParam) : null;
  if (beforeParam && (!before || Number.isNaN(before.getTime()))) {
    return NextResponse.json({ error: "Invalid before cursor." }, { status: 400 });
  }

  const rows = await prisma.cloudFetchRun.findMany({
    // Composite keyset cursor on (startedAt desc, id desc). startedAt is not
    // unique, so a startedAt-only cursor either skips (`lt`) or stalls (`lte`)
    // when a full page shares one millisecond. Pairing it with the tiebreak id
    // — "older startedAt, or same startedAt with a smaller id" — advances past
    // every sibling exactly once with no skip and no duplicate. Falls back to a
    // plain `lt` only if a legacy caller omits beforeId.
    where: before
      ? beforeId
        ? {
            OR: [
              { startedAt: { lt: before } },
              { startedAt: before, id: { lt: beforeId } },
            ],
          }
        : { startedAt: { lt: before } }
      : {},
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
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
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
