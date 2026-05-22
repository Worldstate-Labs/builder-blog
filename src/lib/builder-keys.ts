import { BuilderKind } from "@prisma/client";

export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function canonicalBuilderKey(kind: BuilderKind, value: string) {
  return `${kind}:${value.trim().toLowerCase()}`;
}

export function inferBuilderKind(sourceUrl: string | null, handle: string | null) {
  if (handle) return BuilderKind.X;
  if (!sourceUrl) return BuilderKind.WEBSITE;
  if (sourceUrl.includes("youtube.com") || sourceUrl.includes("podcast")) {
    return BuilderKind.PODCAST;
  }
  if (sourceUrl.includes("blog") || sourceUrl.includes("engineering")) {
    return BuilderKind.BLOG;
  }
  return BuilderKind.WEBSITE;
}
