import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { importLibrariesFromHub, removeLibraryImportFromHub } from "@/lib/library-hub";

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

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const libraryId = typeof payload?.libraryId === "string" ? payload.libraryId : "";
  if (!libraryId) {
    return NextResponse.json({ error: "Missing libraryId" }, { status: 400 });
  }

  const result = await removeLibraryImportFromHub({
    userId: session.user.id,
    libraryId,
  });

  revalidatePath("/builders");
  revalidatePath("/dashboard");
  revalidatePath("/library-hub");
  return NextResponse.json({ ...result, libraryId });
}
