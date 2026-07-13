import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { loadUserCloudFetchLog } from "@/lib/user-cloud-fetch-log-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log = await loadUserCloudFetchLog(session.user.id);
  return NextResponse.json(log, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
