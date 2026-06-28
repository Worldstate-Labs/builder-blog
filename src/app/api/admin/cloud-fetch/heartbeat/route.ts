import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { heartbeatCloudFetchRun } from "@/lib/cloud-source-scheduler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const body = await request.json().catch(() => ({}));
  const runId = typeof body?.runId === "string" ? body.runId.trim().slice(0, 160) : "";
  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }
  const leaseOwner =
    typeof body?.leaseOwner === "string" && body.leaseOwner.trim()
      ? body.leaseOwner.trim().slice(0, 160)
      : null;

  const result = await heartbeatCloudFetchRun({ runId, leaseOwner });
  return NextResponse.json(result);
}
