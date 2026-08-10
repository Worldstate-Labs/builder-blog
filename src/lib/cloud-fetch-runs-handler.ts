import { NextResponse } from "next/server";
import type { getAgentJobRuns as getAgentJobRunsFn } from "@/lib/agent-job-runs";
import type { serializeCloudFetchRun as serializeCloudFetchRunFn, serializeCloudWorkerHost as serializeCloudWorkerHostFn } from "@/lib/cloud-fetch-run-log";
import type { CloudPendingSourceSnapshot } from "@/lib/cloud-fetch-pending-sources";
import type { requireCloudFetchAdmin as requireCloudFetchAdminFn } from "@/lib/cloud-source-admin";

const PAGE_SIZE = 20;

type CloudFetchRunsHandlerDeps = {
  requireCloudFetchAdmin: typeof requireCloudFetchAdminFn;
  listCloudFetchRuns(args: unknown): Promise<unknown[]>;
  getAgentJobRuns: typeof getAgentJobRunsFn;
  getPendingCloudFetchSources(): Promise<CloudPendingSourceSnapshot>;
  serializeCloudFetchRun: typeof serializeCloudFetchRunFn;
  serializeCloudWorkerHost: typeof serializeCloudWorkerHostFn;
};

export function createCloudFetchRunsGetHandler(
  deps: CloudFetchRunsHandlerDeps,
) {
  return async function GET(request: Request) {
    const auth = await deps.requireCloudFetchAdmin(request);
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

    const rows = await deps.listCloudFetchRuns({
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
    const leaseBatches = rows.slice(0, PAGE_SIZE).map(deps.serializeCloudFetchRun);

    let workerHost = null;
    let pendingSources: CloudPendingSourceSnapshot | null = null;
    if (!before) {
      const pendingSourcesPromise = deps.getPendingCloudFetchSources().catch(() => null);
      try {
        const jobRuns = await deps.getAgentJobRuns(auth.user.id, "cloud-library-fetch", 5);
        const nextPendingSources = await pendingSourcesPromise;
        workerHost = deps.serializeCloudWorkerHost(
          jobRuns.find((job) => job.status === "running" || job.status === "starting")
            ?? jobRuns[0]
            ?? null,
        );
        pendingSources = nextPendingSources;
      } catch {
        workerHost = deps.serializeCloudWorkerHost(null);
        pendingSources = null;
      }
    }

    return NextResponse.json({
      leaseBatches,
      // Compatibility for callers that still use the original name.
      runs: leaseBatches,
      hasMore,
      workerHost,
      pendingSources,
      liveProgress: workerHost?.progress ?? null,
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  };
}
