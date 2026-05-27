import { BuilderPoolOrigin } from "@prisma/client";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import type { BuilderLibraryEventItem } from "@/lib/builder-library-events";
import { syncPersonalLibraryHubForUser } from "@/lib/library-hub";
import { resolvePersonalBuilderInput } from "@/lib/personal-builder-input";
import { validatePublicHttpUrl } from "@/lib/safe-url";

const PersonalBuilderSchema = z.object({
  name: z.string().max(240).optional(),
  sourceType: z.string().min(1).max(40).optional(),
  sourceValue: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = PersonalBuilderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const input = resolvePersonalBuilderInput({
    displayName: parsed.data.name ?? "",
    sourceType: parsed.data.sourceType ?? "x",
    sourceValue: parsed.data.sourceValue,
  });

  if (!input) {
    return NextResponse.json({ error: "Missing builder source" }, { status: 400 });
  }

  // SSRF: reject sourceUrl / crawlUrl pointing at private networks, link-local,
  // loopback, or cloud metadata before we ever fetch them server-side.
  for (const candidate of [input.sourceUrl, input.crawlUrl]) {
    if (!candidate) continue;
    const check = validatePublicHttpUrl(candidate);
    if (!check.ok) {
      return NextResponse.json(
        { error: `Source URL rejected: ${check.reason}` },
        { status: 400 },
      );
    }
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
