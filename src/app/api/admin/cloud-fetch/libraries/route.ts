import { NextResponse } from "next/server";
import { getCloudLibraryAdminSnapshot } from "@/lib/cloud-library-overview-data";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireCloudFetchAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const snapshot = await getCloudLibraryAdminSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
