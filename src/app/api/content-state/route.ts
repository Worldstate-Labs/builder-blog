import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { contentSyncState } from "@/lib/content-sync-state";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await contentSyncState(session.user.id);
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
