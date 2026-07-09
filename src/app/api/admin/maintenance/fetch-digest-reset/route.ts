import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { resetFetchDigestState } from "@/lib/fetch-digest-reset";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation.trim() : "";
  if (confirmation !== "RESET") {
    return NextResponse.json({ error: "Type RESET to confirm." }, { status: 400 });
  }

  try {
    const summary = await resetFetchDigestState();
    return NextResponse.json({ status: "reset", summary });
  } catch (error) {
    console.error("Failed to reset fetch and brief state", error);
    return NextResponse.json(
      { error: "Could not reset fetch and brief state." },
      { status: 500 },
    );
  }
}
