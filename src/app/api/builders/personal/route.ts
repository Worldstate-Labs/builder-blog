import { BuilderPoolOrigin } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import type { BuilderLibraryEventItem } from "@/lib/builder-library-events";
import { syncPersonalLibraryHubForUser } from "@/lib/library-hub";
import { resolvePersonalBuilderInput } from "@/lib/personal-builder-input";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    sourceType?: string;
    sourceValue?: string;
  } | null;
  const input = resolvePersonalBuilderInput({
    displayName: body?.name ?? "",
    sourceType: body?.sourceType ?? "x",
    sourceValue: body?.sourceValue ?? "",
  });

  if (!input) {
    return NextResponse.json({ error: "Missing builder source" }, { status: 400 });
  }

  const builder = await upsertBuilder({
    ownerUserId: session.user.id,
    addedByUserId: session.user.id,
    ...input,
  });

  await addBuilderToPool({
    userId: session.user.id,
    builderId: builder.id,
    origin: BuilderPoolOrigin.PERSONAL_SYNC,
  });

  await syncPersonalLibraryHubForUser({
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const item: BuilderLibraryEventItem = {
    allowRemove: true,
    crawlLabel: "Agent synced",
    crawlUrl: builder.crawlUrl,
    entityId: builder.entityId,
    feedItemCount: 0,
    handle: builder.handle,
    id: builder.id,
    kind: builder.kind as BuilderLibraryEventItem["kind"],
    latestPostCreatedAt: null,
    name: builder.name,
    sourceType: builder.sourceType,
    sourceUrl: builder.sourceUrl,
    subscribed: false,
  };

  return NextResponse.json({ builder: item });
}
