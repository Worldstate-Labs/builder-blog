import { BuilderKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { inferBuilderKind, normalizeHandle } from "@/lib/builder-keys";
import { upsertBuilder } from "@/lib/builders";
import { prisma } from "@/lib/prisma";
import { builderKindForSourceType, builderSourceLabel } from "@/lib/source-registry";

const AdminBuilderSchema = z.object({
  name: z.string().trim().min(1).max(240),
  handle: z.string().trim().max(240).optional(),
  sourceUrl: z.string().trim().max(2048).optional(),
  sourceType: z.string().trim().max(40).optional(),
  kind: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = AdminBuilderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const name = parsed.data.name;
  const handleInput = parsed.data.handle?.trim() ?? "";
  const sourceUrl = parsed.data.sourceUrl?.trim() ?? "";
  const sourceType = parsed.data.sourceType?.trim() ?? "";
  const kindInput = parsed.data.kind?.trim() ?? "";
  const explicitSourceType = sourceType.toLowerCase() === "auto" ? "" : sourceType;

  if (!handleInput && !sourceUrl) {
    return NextResponse.json({ error: "Missing builder source" }, { status: 400 });
  }

  const handle = handleInput ? normalizeHandle(handleInput) : null;
  const kind = explicitSourceType
    ? builderKindForSourceType(explicitSourceType)
    : isBuilderKind(kindInput)
      ? kindInput
      : inferBuilderKind(sourceUrl || null, handle);
  const builder = await upsertBuilder({
    // Admin-added builders live inside the admin's own library (the "community library").
    ownerUserId: session.user.id,
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
