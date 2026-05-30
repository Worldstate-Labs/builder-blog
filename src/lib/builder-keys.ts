import { BuilderKind } from "@prisma/client";

export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function canonicalBuilderKey(kind: BuilderKind, value: string) {
  return `${kind}:${value.trim().toLowerCase()}`;
}

export function normalizedBuilderHandle(kind: BuilderKind, handle?: string | null) {
  if (kind !== BuilderKind.X || !handle) return null;
  return normalizeHandle(handle);
}

export function canonicalBuilderValueForInput(params: {
  kind: BuilderKind;
  handle?: string | null;
  sourceUrl?: string | null;
  name: string;
}) {
  const handle = normalizedBuilderHandle(params.kind, params.handle);
  return handle ?? params.sourceUrl ?? params.name;
}

/**
 * libraryKey identifies a specific channel (Builder facet) inside its owner's library.
 * After the central → admin migration, every builder has a non-null ownerUserId, so the
 * key always takes the `user:<ownerUserId>:<canonicalKey>` form.
 */
export function builderLibraryKey(params: {
  canonicalKey: string;
  ownerUserId: string;
}) {
  if (!params.ownerUserId) {
    throw new Error("builderLibraryKey requires ownerUserId");
  }
  return `user:${params.ownerUserId}:${params.canonicalKey}`;
}
