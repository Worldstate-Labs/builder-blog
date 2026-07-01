import { NextResponse } from "next/server";
import { getAgentJobRuns } from "@/lib/agent-job-runs";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { serializeCloudFetchRun } from "@/lib/cloud-fetch-run-log";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

// The cloud runner emits the same live job progress the per-user fetch log uses
// (stage + counters), but under a distinct "cloud-library-fetch" jobType so cloud
// rounds never leak into a user's personal fetch log. Surface it so a RUNNING cloud
// round shows progress before its first checkpoint sync lands.
function extractLiveProgress(job: {
  status: string;
  details?: unknown;
  updatedAt?: string | null;
  runtime?: string | null;
}) {
  const details =
    job.details && typeof job.details === "object" ? (job.details as Record<string, unknown>) : null;
  const progress =
    details && details.progress && typeof details.progress === "object"
      ? (details.progress as Record<string, unknown>)
      : null;
  if (!progress) return null;
  const counters = (progress.counters && typeof progress.counters === "object"
    ? progress.counters
    : {}) as Record<string, unknown>;
  const current = (progress.current && typeof progress.current === "object"
    ? progress.current
    : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    stage: s(progress.stage),
    updatedAt: s(progress.updatedAt) ?? job.updatedAt ?? null,
    runtime: job.runtime ?? null,
    sourcesTotal: n(counters.sourcesTotal),
    sourcesChecked: n(counters.sourcesChecked),
    tasksPlanned: n(counters.tasksPlanned),
    tasksDone: n(counters.tasksDone),
    synced: n(counters.synced),
    failed: n(counters.failed),
    skipped: n(counters.skipped),
    currentSource: s(current.source),
  };
}

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
  const runs = rows.slice(0, PAGE_SIZE).map(serializeCloudFetchRun);

  // Live progress only on a fresh poll (not paginated history loads).
  let liveProgress = null;
  if (!before && runs.some((run) => run.status === "RUNNING")) {
    try {
      const jobRuns = await getAgentJobRuns(auth.user.id, "cloud-library-fetch", 5);
      const active = jobRuns.find((job) => job.status === "running" || job.status === "starting");
      liveProgress = active ? extractLiveProgress(active) : null;
    } catch {
      liveProgress = null;
    }
  }

  return NextResponse.json({ runs, hasMore, liveProgress });
}
