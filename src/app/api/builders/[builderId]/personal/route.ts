import { BuilderKind, Prisma } from "@prisma/client";
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
  combineWarnings,
  hostnameOrNull,
  pickFinalName,
  probeAndEnrichSource,
  resolveAvatarDataUrl,
  type BuilderEnrichment,
  type ProbeOutcome,
} from "@/lib/builder-enrichment";
import { prisma } from "@/lib/prisma";
import { resolvePersonalBuilderInput } from "@/lib/personal-builder-input";
import { validatePublicHttpUrl } from "@/lib/safe-url";
import { formatZodError } from "@/lib/zod-error";

type Params = { params: Promise<{ builderId: string }> };

const PatchSchema = z.object({
  name: z.string().trim().max(240).optional(),
  sourceType: z.string().trim().min(1).max(40).optional(),
  sourceValue: z.string().trim().min(1).max(2048).optional(),
});

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
      { error: "sourceValue is required to resolve the source" },
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
        { error: `Source URL rejected: ${check.reason}` },
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
      warning:
        "We could not verify the source right now; it was updated and your Local Agent can retry later.",
    };
  });
  if (!probe.ok) {
    return NextResponse.json({ error: probe.hardError }, { status: 400 });
  }
  const enrichment: BuilderEnrichment = resolution.enrichment ?? probe.enrichment;

  const finalName = pickFinalName(parsed.data.name, input.name, enrichment.name, {
    urlSignals: [
      input.handle,
      hostnameOrNull(input.sourceUrl),
      hostnameOrNull(input.fetchUrl),
      parsed.data.sourceValue,
    ],
  });
  const avatarUrl = enrichment.avatarUrl ?? null;
  const sourceIdentityChanged =
    input.sourceType !== existing.sourceType ||
    (input.sourceUrl ?? null) !== (existing.sourceUrl ?? null) ||
    (input.fetchUrl ?? null) !== (existing.fetchUrl ?? null) ||
    (handle ?? null) !== (existing.handle ?? null);
  const avatarDataUrl = avatarUrl
    ? await resolveAvatarDataUrl(avatarUrl)
    : sourceIdentityChanged
      ? null
      : existing.avatarDataUrl;

  try {
    const updated = await prisma.builder.update({
      where: { id: existing.id },
      data: {
        name: finalName,
        handle: handle ?? null,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
        // Probe-discovered RSS/Atom feed link wins over the resolver's
        // best guess when the user pasted an HTML landing page.
        fetchUrl: probe.discoveredFetchUrl ?? input.fetchUrl ?? null,
        avatarUrl,
        avatarDataUrl,
        kind,
        canonicalKey,
        libraryKey,
      },
    });
    revalidateTag(`user:${session.user.id}:recs`, "default");
    const warning = combineWarnings(resolution.warning, probe.warning);
    return NextResponse.json({
      builder: updated,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "This source already exists in a library. Remove the duplicate first, or pick a different source.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
