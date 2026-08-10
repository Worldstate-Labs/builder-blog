import { NextResponse } from "next/server";
import type { CloudFetchRunLogItem, CloudWorkerHostStatus } from "@/lib/cloud-fetch-run-log";
import type { CloudPendingSourceSnapshot } from "@/lib/cloud-fetch-pending-sources";
import type { requireCloudFetchAdmin as requireCloudFetchAdminFn } from "@/lib/cloud-source-admin";

const PAGE_SIZE = 20;

export type CloudFetchRunsQuery = {
  where:
    | Record<string, never>
    | { startedAt: { lt: Date } }
    | {
        OR: [
          { startedAt: { lt: Date } },
          { startedAt: Date; id: { lt: string } },
        ];
      };
  orderBy: [{ startedAt: "desc" }, { id: "desc" }];
  take: number;
  include: {
    tasks: {
      orderBy: { id: "asc" };
      include: { builder: { select: { name: true; sourceType: true } } };
    };
  };
};

type CloudFetchRunsHandlerDeps = {
  requireCloudFetchAdmin: typeof requireCloudFetchAdminFn;
  listCloudFetchRuns(args: CloudFetchRunsQuery): Promise<CloudFetchRunLogItem[]>;
  loadWorkerHost(userId: string): Promise<CloudWorkerHostStatus>;
  getOfflineWorkerHost(): CloudWorkerHostStatus;
  getPendingCloudFetchSources(): Promise<CloudPendingSourceSnapshot>;
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

    const leaseBatchRows = await deps.listCloudFetchRuns({
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

    const hasMore = leaseBatchRows.length > PAGE_SIZE;
    const leaseBatches = leaseBatchRows.slice(0, PAGE_SIZE);

    let workerHost: CloudWorkerHostStatus | null = null;
    let pendingSources: CloudPendingSourceSnapshot | null = null;
    if (!before) {
      const pendingSourcesPromise = deps.getPendingCloudFetchSources().catch(() => null);
      try {
        workerHost = await deps.loadWorkerHost(auth.user.id);
        const nextPendingSources = await pendingSourcesPromise;
        pendingSources = nextPendingSources;
      } catch {
        workerHost = deps.getOfflineWorkerHost();
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
