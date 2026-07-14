import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { leaseCloudFetchTasks } from "@/lib/cloud-source-scheduler";
import { prisma } from "@/lib/prisma";
import { StaleWorkerWriteError } from "@/lib/reset-fence";

export const dynamic = "force-dynamic";

const DEFAULT_LEASE_LIMIT = 10;
const MAX_LEASE_LIMIT = 100;

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const body = await request.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit ?? DEFAULT_LEASE_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LEASE_LIMIT, Math.floor(requestedLimit)))
    : DEFAULT_LEASE_LIMIT;
  const leaseOwner = typeof body?.leaseOwner === "string" && body.leaseOwner.trim()
    ? body.leaseOwner.trim().slice(0, 160)
    : `admin:${admin.user.id}`;
  const jobRunId = typeof body?.jobRunId === "string" ? body.jobRunId.trim().slice(0, 160) : "";
  if (!jobRunId) {
    return NextResponse.json(
      { error: "jobRunId is required; start a new cloud worker with the current runner." },
      { status: 409 },
    );
  }
  const jobRun = await prisma.agentJobRun.findFirst({
    where: {
      userId: admin.user.id,
      jobType: "cloud-library-fetch",
      instanceId: jobRunId,
    },
    select: { createdAt: true },
  });
  if (!jobRun) {
    return NextResponse.json(
      { error: "This cloud worker lease was reset. Start a new cloud worker." },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await leaseCloudFetchTasks({
      limit,
      leaseOwner,
      workerStartedAt: jobRun.createdAt,
    });
  } catch (error) {
    if (error instanceof StaleWorkerWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }
  return NextResponse.json(result);
}
