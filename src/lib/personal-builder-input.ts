import { BuilderKind } from "@prisma/client";
import { builderKindForSourceType } from "@/lib/source-registry";
import { normalizeHandle } from "@/lib/builder-keys";

export type PersonalBuilderInput = {
  kind: BuilderKind;
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
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
      fetchUrl: null,
    };
  }

  if (normalizedSourceType === "youtube") {
    const sourceUrl = youtubeUrlFromValue(value);
    if (!sourceUrl) return null;

    return {
      kind: builderKindForSourceType(normalizedSourceType),
      sourceType: normalizedSourceType,
      name: displayName.trim() || nameFromYouTubeUrl(sourceUrl),
      handle: null,
      sourceUrl,
      fetchUrl: null,
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
    fetchUrl: null,
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

function youtubeUrlFromValue(value: string) {
  if (!/^https?:\/\//i.test(value)) {
    const handle = value.trim().replace(/^@/, "");
    return handle ? `https://www.youtube.com/@${handle}` : null;
  }

  try {
    const url = new URL(value);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function nameFromYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    const [firstPathPart] = url.pathname.split("/").filter(Boolean);
    if (firstPathPart?.startsWith("@")) return firstPathPart.slice(1);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
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
