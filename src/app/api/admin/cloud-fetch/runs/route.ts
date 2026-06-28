import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { serializeCloudFetchRun } from "@/lib/cloud-fetch-run-log";
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
  const runs = rows.slice(0, PAGE_SIZE).map(serializeCloudFetchRun);
  return NextResponse.json({ runs, hasMore });
}
