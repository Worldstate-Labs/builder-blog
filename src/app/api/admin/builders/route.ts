import { BuilderKind, BuilderScope } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { inferBuilderKind, normalizeHandle } from "@/lib/builder-keys";
import { upsertBuilder } from "@/lib/builders";
import { prisma } from "@/lib/prisma";
import { builderKindForSourceType, builderSourceLabel } from "@/lib/source-registry";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const name = String(payload?.name ?? "").trim();
  const handleInput = String(payload?.handle ?? "").trim();
  const sourceUrl = String(payload?.sourceUrl ?? "").trim();
  const sourceType = String(payload?.sourceType ?? "").trim();
  const kindInput = String(payload?.kind ?? "").trim();
  const explicitSourceType = sourceType.toLowerCase() === "auto" ? "" : sourceType;

  if (!name || (!handleInput && !sourceUrl)) {
    return NextResponse.json({ error: "Missing builder name or source" }, { status: 400 });
  }

  const handle = handleInput ? normalizeHandle(handleInput) : null;
  const kind = explicitSourceType
    ? builderKindForSourceType(explicitSourceType)
    : isBuilderKind(kindInput)
      ? kindInput
      : inferBuilderKind(sourceUrl || null, handle);
  const builder = await upsertBuilder({
    scope: BuilderScope.CENTRAL,
    kind,
    sourceType: explicitSourceType || null,
    name,
    handle,
    sourceUrl: sourceUrl || (handle ? `https://x.com/${handle}` : null),
    crawlUrl: kind === BuilderKind.BLOG || kind === BuilderKind.PODCAST ? sourceUrl : null,
    addedByUserId: session.user.id,
  });
  const builderWithCounts = await prisma.builder.findUniqueOrThrow({
    where: { id: builder.id },
    include: { _count: { select: { subscriptions: true, feedItems: true } } },
  });

  return NextResponse.json({ builder: serializeBuilder(builderWithCounts) });
}

function isBuilderKind(value: string): value is BuilderKind {
  return Object.values(BuilderKind).includes(value as BuilderKind);
}

function serializeBuilder(
  builder: Awaited<ReturnType<typeof prisma.builder.findUniqueOrThrow>> & {
    _count: { subscriptions: number; feedItems: number };
  },
) {
  return {
    id: builder.id,
    name: builder.name,
    handle: builder.handle,
    sourceUrl: builder.sourceUrl,
    crawlUrl: builder.crawlUrl,
    canonicalKey: builder.canonicalKey,
    sourceLabel: builderSourceLabel(builder),
    feedItemCount: builder._count.feedItems,
    subscriptionCount: builder._count.subscriptions,
  };
}
