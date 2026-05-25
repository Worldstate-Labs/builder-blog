import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { builderLibraryState } from "@/lib/builder-library-state";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const builderIds = await activePoolBuilderIds(session.user.id);
  const state = await builderLibraryState(session.user.id, builderIds);
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
