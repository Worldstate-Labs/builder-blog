import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { leaseCloudFetchTasks } from "@/lib/cloud-source-scheduler";

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

  const result = await leaseCloudFetchTasks({ limit, leaseOwner });
  return NextResponse.json(result);
}
