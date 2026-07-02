import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { resetCloudLibraryGeneratedState } from "@/lib/cloud-library-reset";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireCloudFetchAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation.trim() : "";
  if (confirmation !== "RESET") {
    return NextResponse.json({ error: "Type RESET to confirm." }, { status: 400 });
  }

  try {
    const summary = await resetCloudLibraryGeneratedState();
    return NextResponse.json({ status: "reset", summary });
  } catch (error) {
    console.error("Failed to reset cloud library generated state", error);
    return NextResponse.json(
      { error: "Could not reset cloud library generated state." },
      { status: 500 },
    );
  }
}
