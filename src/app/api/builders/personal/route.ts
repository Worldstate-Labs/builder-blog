import { BuilderPoolOrigin } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  enrichBuilderFromSource,
  hostnameOrNull,
  pickFinalName,
  type BuilderEnrichment,
} from "@/lib/builder-enrichment";
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
  const resolution = await resolvePersonalBuilderInput({
    displayName: parsed.data.name ?? "",
    sourceType: parsed.data.sourceType ?? "x",
    sourceValue: parsed.data.sourceValue,
  });

  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: resolution.reason,
        // suggestId lets the client offer a one-click "switch source type
        // and retry" affordance when the value clearly belongs to a
        // different type.
        ...(resolution.suggestId ? { suggestId: resolution.suggestId } : {}),
      },
      { status: 400 },
    );
  }
  const input = resolution.value;

  // SSRF: reject sourceUrl / fetchUrl pointing at private networks, link-local,
  // loopback, or cloud metadata before we ever fetch them server-side.
  for (const candidate of [input.sourceUrl, input.fetchUrl]) {
    if (!candidate) continue;
    const check = validatePublicHttpUrl(candidate);
    if (!check.ok) {
      return NextResponse.json(
        { error: `Source URL rejected: ${check.reason}` },
        { status: 400 },
      );
    }
  }

  // Best-effort name + avatar enrichment. The podcast resolver
  // already filled `enrichment` inline (one network call covered both
  // RSS lookup and avatar); for every other source we hit the source
  // page once here. Failures are swallowed so the add flow never
  // breaks because an upstream is slow.
  const enrichment: BuilderEnrichment =
    resolution.enrichment ??
    (await enrichBuilderFromSource({
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      fetchUrl: input.fetchUrl,
      handle: input.handle,
    }).catch(() => ({})));

  const finalName = pickFinalName(parsed.data.name, input.name, enrichment.name, {
    urlSignals: [
      input.handle,
      hostnameOrNull(input.sourceUrl),
      hostnameOrNull(input.fetchUrl),
      parsed.data.sourceValue,
    ],
  });

  const builder = await upsertBuilder({
    ownerUserId: session.user.id,
    addedByUserId: session.user.id,
    ...input,
    name: finalName,
    avatarUrl: enrichment.avatarUrl ?? null,
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
    avatarUrl: builder.avatarUrl ?? null,
    fetchLabel: "Agent synced",
    fetchUrl: builder.fetchUrl,
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

  revalidateTag(`user:${session.user.id}:recs`, "default");
  return NextResponse.json({
    builder: item,
    // Non-blocking diagnostic from the resolver (e.g. Apple lookup
    // timed out; agent will retry at sync time). Client surfaces this
    // as an info banner so the user knows the row is partially
    // hydrated but still functional.
    ...(resolution.warning ? { warning: resolution.warning } : {}),
  });
}
