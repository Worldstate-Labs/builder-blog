import { BuilderKind } from "@prisma/client";
import { builderKindForSourceType } from "@/lib/source-registry";
import { normalizeHandle } from "@/lib/builder-keys";

export type PersonalBuilderInput = {
  kind: BuilderKind;
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
};

export function resolvePersonalBuilderInput({
  displayName,
  sourceType,
  sourceValue,
}: {
  displayName: string;
  sourceType: string;
  sourceValue: string;
}): PersonalBuilderInput | null {
  const normalizedSourceType = normalizeSourceType(sourceType) || "x";
  const value = sourceValue.trim();
  if (!value) return null;

  if (normalizedSourceType === "x") {
    const handle = handleFromXValue(value);
    if (!handle) return null;
    return {
      kind: BuilderKind.X,
      sourceType: normalizedSourceType,
      name: displayName.trim() || `@${handle}`,
      handle,
      sourceUrl: `https://x.com/${handle}`,
      crawlUrl: null,
    };
  }

  const sourceUrl = normalizedUrl(value);
  if (!sourceUrl) return null;

  return {
    kind: builderKindForSourceType(normalizedSourceType),
    sourceType: normalizedSourceType,
    name: displayName.trim() || nameFromUrl(sourceUrl),
    handle: null,
    sourceUrl,
    crawlUrl: sourceUrl,
  };
}

function handleFromXValue(value: string) {
  if (!/^https?:\/\//i.test(value)) return normalizeHandle(value);
  try {
    const url = new URL(value);
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return null;
    const [handle] = url.pathname.split("/").filter(Boolean);
    return handle ? normalizeHandle(handle) : null;
  } catch {
    return null;
  }
}

function normalizedUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol).toString();
  } catch {
    return null;
  }
}

function nameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function normalizeSourceType(sourceType: string) {
  return sourceType.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
