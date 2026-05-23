import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { importLibrariesFromHub } from "@/lib/library-hub";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const libraryIds = Array.isArray(payload?.libraryIds)
    ? payload.libraryIds.map((value: unknown) => String(value)).filter(Boolean)
    : [];

  const result = await importLibrariesFromHub({
    userId: session.user.id,
    libraryIds,
  });

  revalidatePath("/builders");
  revalidatePath("/dashboard");
  return NextResponse.json({ ...result, libraryIds });
}
