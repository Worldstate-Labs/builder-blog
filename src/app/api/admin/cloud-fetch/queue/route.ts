import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { materializeDueCloudFetchQueue } from "@/lib/cloud-source-scheduler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const result = await materializeDueCloudFetchQueue();
  return NextResponse.json(result);
}
