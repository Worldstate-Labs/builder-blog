import { BuilderKind } from "@prisma/client";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  inferBuilderKind,
  normalizedBuilderHandle,
  normalizeHandle,
} from "@/lib/builder-keys";
import { ensureBuilderEntity } from "@/lib/builder-entities";
import { prisma } from "@/lib/prisma";

export {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  inferBuilderKind,
  normalizeHandle,
};

export async function upsertBuilder(params: {
  ownerUserId: string;
  kind: BuilderKind;
  sourceType?: string | null;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
  bio?: string | null;
  addedByUserId?: string | null;
}) {
  if (!params.ownerUserId) {
    throw new Error("upsertBuilder requires ownerUserId — every channel must belong to a user.");
  }
  const handle = normalizedBuilderHandle(params.kind, params.handle);
  const uniqueValue = canonicalBuilderValueForInput(params);
  const canonicalKey = canonicalBuilderKey(params.kind, uniqueValue);
  const libraryKey = builderLibraryKey({
    canonicalKey,
    ownerUserId: params.ownerUserId,
  });
  const entityId = await ensureBuilderEntity({
    kind: params.kind,
    canonicalKey,
    name: params.name,
    handle,
    bio: params.bio,
  });
  return prisma.builder.upsert({
    where: { libraryKey },
    update: {
      name: params.name,
      sourceType: params.sourceType ?? undefined,
      handle,
      sourceUrl: params.sourceUrl ?? undefined,
      fetchUrl: params.fetchUrl ?? undefined,
      bio: params.bio ?? undefined,
      entityId,
    },
    create: {
      ownerUserId: params.ownerUserId,
      kind: params.kind,
      sourceType: params.sourceType ?? undefined,
      name: params.name,
      handle,
      sourceUrl: params.sourceUrl,
      fetchUrl: params.fetchUrl,
      bio: params.bio,
      addedByUserId: params.addedByUserId,
      canonicalKey,
      libraryKey,
      entityId,
    },
  });
}
