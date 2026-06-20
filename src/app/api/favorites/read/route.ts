import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  assertFavoritePostAccess,
  markFavoritePostRead,
} from "@/lib/feed-favorites";
import { formatZodError } from "@/lib/zod-error";

const FavoriteReadBodySchema = z.object({
  feedItemId: z.string().trim().min(1).max(64),
  markedRead: z.boolean(),
});

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = FavoriteReadBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const access = await assertFavoritePostAccess(session.user.id, parsed.data.feedItemId);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const markedReadAt = await markFavoritePostRead(
    session.user.id,
    access.identity,
    parsed.data.markedRead,
  );
  if (typeof markedReadAt === "undefined") {
    return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: "ok",
    markedReadAt: markedReadAt?.toISOString() ?? null,
  });
}
