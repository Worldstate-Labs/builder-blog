import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  assertFavoritePostAccess,
  favoritePost,
  getFavoriteSnapshot,
  unfavoritePost,
} from "@/lib/feed-favorites";
import { formatZodError } from "@/lib/zod-error";

const FavoriteBodySchema = z.object({
  feedItemId: z.string().trim().min(1).max(64),
});

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getFavoriteSnapshot(session.user.id);
  return NextResponse.json({
    snapshot,
    count: snapshot?.items.length ?? 0,
    strategy: "favorite-feed-v1",
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = FavoriteBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const access = await assertFavoritePostAccess(session.user.id, parsed.data.feedItemId);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const favorite = await favoritePost(session.user.id, access.identity);
  return NextResponse.json({
    status: "ok",
    favoritedAt: favorite.favoritedAt.toISOString(),
  });
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = FavoriteBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const access = await assertFavoritePostAccess(session.user.id, parsed.data.feedItemId);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await unfavoritePost(session.user.id, access.identity);
  return NextResponse.json({ status: "ok", favoritedAt: null });
}
