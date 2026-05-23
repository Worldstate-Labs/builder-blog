import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  sharePersonalLibraryToHub,
  unsharePersonalLibraryFromHub,
} from "@/lib/library-hub";

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const isPublic = Boolean(payload?.isPublic);
  const name =
    String(payload?.name ?? "").trim() ||
    `${session.user.name || session.user.email || "Personal"} library`;

  if (!isPublic) {
    await unsharePersonalLibraryFromHub(session.user.id);
    revalidatePath("/library-hub");
    return NextResponse.json({ isPublic: false, builderCount: 0 });
  }

  const result = await sharePersonalLibraryToHub({
    userId: session.user.id,
    name,
  });

  revalidatePath("/library-hub");
  return NextResponse.json({
    isPublic: true,
    builderCount: result.builderCount,
  });
}
