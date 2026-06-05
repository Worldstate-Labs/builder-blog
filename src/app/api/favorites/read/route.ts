import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  assertFavoritePostAccess,
  FavoriteMissingError,
  setFavoriteMarkedRead,
} from "@/lib/feed-favorites";
import { formatZodError } from "@/lib/zod-error";

const FavoriteReadBodySchema = z.object({
  feedItemId: z.string().trim().min(1).max(64),
  markedRead: z.boolean().optional(),
});

export async function POST(request: Request) {
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

  try {
    const result = await setFavoriteMarkedRead(
      session.user.id,
      access.identity,
      parsed.data.markedRead ?? true,
    );
    return NextResponse.json({
      status: "ok",
      readAt: result.readAt?.toISOString() ?? null,
      markedReadAt: result.markedReadAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof FavoriteMissingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
