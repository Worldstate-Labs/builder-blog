import { BuilderPoolOrigin } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  combineWarnings,
  hostnameOrNull,
  pickFinalName,
  probeAndEnrichSource,
  type BuilderEnrichment,
  type ProbeOutcome,
} from "@/lib/builder-enrichment";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import type { BuilderLibraryEventItem } from "@/lib/builder-library-events";
import { syncPersonalLibraryHubForUser } from "@/lib/library-hub";
import { resolvePersonalBuilderInput } from "@/lib/personal-builder-input";
import { prisma } from "@/lib/prisma";
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

  // Probe the upstream for reachability and pull display name + avatar
  // in the same network round-trip. The probe classifies failures into
  // hard (reject the add with a user-facing reason) and soft (accept
  // but warn). The resolver may have already pre-resolved an
  // enrichment payload (Apple Podcasts → iTunes); we still run the
  // probe because the iTunes-resolved RSS can be dead.
  const probe = await probeAndEnrichSource({
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    fetchUrl: input.fetchUrl,
    handle: input.handle,
  }).catch((error): ProbeOutcome => {
    console.warn("[personal-builder] probe threw", { error });
    return {
      ok: true,
      enrichment: {},
      warning:
        "We couldn't verify the source right now; it was added but the agent will retry.",
    };
  });
  if (!probe.ok) {
    return NextResponse.json({ error: probe.hardError }, { status: 400 });
  }
  // Resolver-supplied enrichment (Apple Podcasts iTunes result) wins
  // over the probe's enrichment when present, since iTunes carries
  // richer fields than RSS first-bytes ever can.
  const enrichment: BuilderEnrichment = resolution.enrichment ?? probe.enrichment;

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
    // If the probe auto-discovered an RSS/Atom feed link on the HTML
    // page the user pasted, persist that as the fetchUrl so the CLI
    // hits the real feed at sync time instead of re-scraping HTML.
    fetchUrl: probe.discoveredFetchUrl ?? input.fetchUrl ?? null,
  });

  await addBuilderToPool({
    userId: session.user.id,
    builderId: builder.id,
    origin: BuilderPoolOrigin.PERSONAL_SYNC,
  });

  // Default-follow: every freshly-added personal source is subscribed
  // immediately so it shows up in the digest without a second click.
  // The user can still toggle it off via the per-row Subscribe button.
  await prisma.subscription.upsert({
    where: { userId_builderId: { userId: session.user.id, builderId: builder.id } },
    update: {},
    create: { userId: session.user.id, builderId: builder.id },
  });
  if (builder.entityId) {
    await prisma.userChannelPreference.upsert({
      where: { userId_entityId: { userId: session.user.id, entityId: builder.entityId } },
      update: {},
      create: {
        userId: session.user.id,
        entityId: builder.entityId,
        primaryBuilderId: builder.id,
        pinnedByUser: false,
      },
    });
  }

  await syncPersonalLibraryHubForUser({
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const item: BuilderLibraryEventItem = {
    allowRemove: true,
    avatarUrl: builder.avatarUrl ?? null,
    createdAt: builder.createdAt.toISOString(),
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
    subscribed: true,
  };

  revalidateTag(`user:${session.user.id}:recs`, "default");
  // Non-blocking diagnostic: combine the resolver warning (e.g. Apple
  // lookup timed out) with the probe warning (e.g. blog page returned
  // 503) into a single sentence. Either or both may be present.
  const warning = combineWarnings(resolution.warning, probe.warning);
  return NextResponse.json({
    builder: item,
    ...(warning ? { warning } : {}),
  });
}
