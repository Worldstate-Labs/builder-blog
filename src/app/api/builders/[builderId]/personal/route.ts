import { BuilderKind, FetchStatus, Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  normalizedBuilderHandle,
} from "@/lib/builder-keys";
import {
  DUPLICATE_PERSONAL_SOURCE_ERROR,
  findConflictingPersonalSource,
} from "@/lib/personal-source-identity";
import { editableSourceIdentityChanged } from "@/lib/personal-source-edit";
import {
  combineWarnings,
  hostnameOrNull,
  pickFinalName,
  probeAndEnrichSource,
  resolveAvatarDataUrl,
  type BuilderEnrichment,
  type ProbeOutcome,
} from "@/lib/builder-enrichment";
import { ensureBuilderEntity } from "@/lib/builder-entities";
import { prisma } from "@/lib/prisma";
import { resolvePersonalBuilderInput } from "@/lib/personal-builder-input";
import { validatePublicHttpUrl } from "@/lib/safe-url";
import { formatZodError } from "@/lib/zod-error";

type Params = { params: Promise<{ builderId: string }> };

const PatchSchema = z.object({
  name: z.string().trim().max(240).optional(),
  sourceType: z.string().trim().min(1).max(40).optional(),
  sourceValue: z.string().trim().min(1).max(2048).optional(),
  confirmedWarning: z.boolean().optional(),
  confirmedClearFetchedPosts: z.boolean().optional(),
});

function clearFetchedPostsWarning(count: number) {
  const label = count === 1 ? "post" : "posts";
  return `Changing this source URL will clear ${count} fetched ${label} for this source.`;
}

// PATCH /api/builders/:builderId/personal — edit the three creation
// fields (sourceType / sourceValue / display name) on a user-owned
// builder. Unknown sourceType, malformed URL, SSRF target, or
// canonical-key collision all surface as 400s with a clear `error`
// string the UI can show inline.
export async function PATCH(request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { builderId } = await params;
  const existing = await prisma.builder.findUnique({
    where: { id: builderId },
    select: {
      id: true,
      ownerUserId: true,
      name: true,
      sourceType: true,
      sourceUrl: true,
      fetchUrl: true,
      avatarDataUrl: true,
      handle: true,
    },
  });
  if (!existing || existing.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const fallbackSourceValue =
    existing.handle && existing.sourceType === "x"
      ? `@${existing.handle}`
      : (existing.sourceUrl ?? existing.handle ?? "");

  const nextName = parsed.data.name ?? existing.name;
  const nextSourceType = parsed.data.sourceType ?? existing.sourceType;
  const nextSourceValue = parsed.data.sourceValue ?? fallbackSourceValue;

  if (!nextSourceValue) {
    return NextResponse.json(
      { error: "Handle or URL is required." },
      { status: 400 },
    );
  }

  const resolution = await resolvePersonalBuilderInput({
    displayName: nextName,
    sourceType: nextSourceType,
    sourceValue: nextSourceValue,
  });
  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: resolution.reason,
        ...(resolution.suggestId ? { suggestId: resolution.suggestId } : {}),
      },
      { status: 400 },
    );
  }
  const input = resolution.value;

  for (const candidate of [input.sourceUrl, input.fetchUrl]) {
    if (!candidate) continue;
    const check = validatePublicHttpUrl(candidate);
    if (!check.ok) {
      return NextResponse.json(
        { error: `Source URL is not allowed: ${check.reason}.` },
        { status: 400 },
      );
    }
  }

  // Re-derive the canonical / library keys from the resolved input the
  // same way upsertBuilder does, so the row stays addressable by the
  // dedup key after an in-place edit.
  const kind = input.kind as BuilderKind;
  const handle = normalizedBuilderHandle(kind, input.handle);
  const canonicalValue = canonicalBuilderValueForInput({
    kind,
    handle,
    sourceUrl: input.sourceUrl ?? null,
    name: input.name,
  });
  const canonicalKey = canonicalBuilderKey(kind, canonicalValue);
  const libraryKey = builderLibraryKey({
    canonicalKey,
    ownerUserId: session.user.id,
  });

  // Re-probe + re-enrich on edit so a changed source URL/handle is
  // verified before we overwrite the row, and so the fresh name +
  // avatar are picked up in the same round-trip. Hard failures from
  // the probe surface as 400s; soft failures degrade to a warning.
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
      warning: "Source updated unverified. Local Agent retries at sync time.",
    };
  });
  if (!probe.ok) {
    return NextResponse.json(
      {
        error: probe.hardError,
        ...(probe.suggestId ? { suggestId: probe.suggestId } : {}),
      },
      { status: 400 },
    );
  }
  if (probe.requiresConfirmation && !parsed.data.confirmedWarning) {
    return NextResponse.json(
      {
        needsConfirmation: true,
        warning: probe.warning,
      },
      { status: 409 },
    );
  }
  const enrichment: BuilderEnrichment = resolution.enrichment ?? probe.enrichment;
  const finalFetchUrl = probe.discoveredFetchUrl ?? input.fetchUrl ?? null;
  const duplicateSource = await findConflictingPersonalSource({
    userId: session.user.id,
    sourceUrl: input.sourceUrl,
    fetchUrl: finalFetchUrl,
    excludeBuilderId: existing.id,
  });
  if (duplicateSource) {
    return NextResponse.json({ error: DUPLICATE_PERSONAL_SOURCE_ERROR }, { status: 409 });
  }

  const finalName = pickFinalName(parsed.data.name, input.name, enrichment.name, {
    urlSignals: [
      input.handle,
      hostnameOrNull(input.sourceUrl),
      hostnameOrNull(input.fetchUrl),
      parsed.data.sourceValue,
    ],
  });
  const avatarUrl = enrichment.avatarUrl ?? null;
  const sourceIdentityChanged = editableSourceIdentityChanged(existing, {
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    fetchUrl: finalFetchUrl,
    handle: handle ?? null,
  });
  const fetchedPostCount = sourceIdentityChanged
    ? await prisma.feedItem.count({ where: { builderId: existing.id } })
    : 0;
  if (
    sourceIdentityChanged &&
    fetchedPostCount > 0 &&
    !parsed.data.confirmedClearFetchedPosts
  ) {
    return NextResponse.json(
      {
        needsClearFetchedPostsConfirmation: true,
        feedItemCount: fetchedPostCount,
        warning: clearFetchedPostsWarning(fetchedPostCount),
      },
      { status: 409 },
    );
  }
  const avatarDataUrl = avatarUrl
    ? await resolveAvatarDataUrl(avatarUrl)
    : sourceIdentityChanged
      ? null
      : existing.avatarDataUrl;

  // Rebind the channel to the BuilderEntity for the (possibly changed)
  // canonical key, mirroring upsertBuilder. Without this an identity edit
  // leaves the row pointing at the stale entity, so newly fetched content
  // groups under the old identity in dedup, entity pages, and feed-items.
  const entityId = await ensureBuilderEntity({
    kind,
    canonicalKey,
    name: finalName,
    handle: handle ?? null,
  });

  try {
    const { updated, deletedFeedItems } = await prisma.$transaction(async (tx) => {
      const updated = await tx.builder.update({
        where: { id: existing.id },
        data: {
          name: finalName,
          handle: handle ?? null,
          sourceType: input.sourceType,
          sourceUrl: input.sourceUrl ?? null,
          // Probe-discovered RSS/Atom feed link wins over the resolver's
          // best guess when the user pasted an HTML landing page.
          fetchUrl: finalFetchUrl,
          avatarUrl,
          avatarDataUrl,
          kind,
          canonicalKey,
          libraryKey,
          entityId,
          ...(sourceIdentityChanged
            ? {
                itemCount: 0,
                lastFetchedAt: null,
                lastError: null,
                status: FetchStatus.IDLE,
              }
            : {}),
        },
      });
      const deleted = sourceIdentityChanged
        ? await tx.feedItem.deleteMany({ where: { builderId: existing.id } })
        : { count: 0 };
      return { updated, deletedFeedItems: deleted.count };
    });
    revalidateTag(`user:${session.user.id}:recs`, "default");
    const warning = combineWarnings(resolution.warning, probe.warning);
    return NextResponse.json({
      builder: updated,
      ...(deletedFeedItems ? { deletedFeedItems } : {}),
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "This source already exists in a source library. Remove the duplicate first, or pick a different source.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Could not save source." },
      { status: 500 },
    );
  }
}
