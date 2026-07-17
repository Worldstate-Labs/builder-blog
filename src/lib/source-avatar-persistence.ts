import type { BuilderKind } from "@prisma/client";
import {
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
} from "@/lib/builder-keys";
import {
  probeAndEnrichSource,
  toSafeAvatarUrl,
} from "@/lib/builder-enrichment";

type SourceAvatarIdentity = {
  kind: BuilderKind;
  name: string;
  sourceType?: string | null;
  handle?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
};

export type CandidateAvatarLookup = {
  sourceCandidate: {
    findUnique(args: unknown): Promise<{
      avatarUrl: string | null;
      avatarDataUrl: string | null;
    } | null>;
  };
};

export async function resolveSourceAvatar({
  source,
  preferredAvatarUrl,
  preferredAvatarDataUrl,
  probeWhenMissing = false,
  prismaClient,
}: {
  source: SourceAvatarIdentity;
  preferredAvatarUrl?: string | null;
  preferredAvatarDataUrl?: string | null;
  probeWhenMissing?: boolean;
  prismaClient?: CandidateAvatarLookup;
}) {
  const sourceKey = canonicalBuilderKey(
    source.kind,
    canonicalBuilderValueForInput({
      kind: source.kind,
      handle: source.handle,
      sourceUrl: source.sourceUrl,
      name: source.name,
    }),
  );
  const candidate = prismaClient
    ? await prismaClient.sourceCandidate.findUnique({
        where: { sourceKey },
        select: { avatarUrl: true, avatarDataUrl: true },
      })
    : null;

  const preferredUrl = toSafeAvatarUrl(preferredAvatarUrl);
  const candidateUrl = toSafeAvatarUrl(candidate?.avatarUrl);
  if (preferredUrl) {
    return {
      avatarUrl: preferredUrl,
      avatarDataUrl:
        preferredAvatarDataUrl ??
        (preferredUrl === candidateUrl ? candidate?.avatarDataUrl ?? null : null),
    };
  }
  if (candidateUrl || candidate?.avatarDataUrl) {
    return {
      avatarUrl: candidateUrl,
      avatarDataUrl: candidate?.avatarDataUrl ?? null,
    };
  }
  if (!probeWhenMissing) {
    return { avatarUrl: fallbackSourceAvatarUrl(source), avatarDataUrl: null };
  }

  const probe = await probeAndEnrichSource({
    sourceType: source.sourceType ?? "website",
    sourceUrl: source.sourceUrl ?? null,
    fetchUrl: source.fetchUrl ?? null,
    handle: source.handle ?? null,
  });
  return {
    avatarUrl:
      toSafeAvatarUrl(probe.enrichment.avatarUrl) ?? fallbackSourceAvatarUrl(source),
    avatarDataUrl: null,
  };
}

function fallbackSourceAvatarUrl(source: SourceAvatarIdentity) {
  if (source.sourceType === "x" || source.sourceType === "youtube") return null;
  const sourceUrl = source.sourceUrl ?? source.fetchUrl;
  if (!sourceUrl) return null;
  try {
    const domain = new URL(sourceUrl).hostname;
    if (!domain) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  } catch {
    return null;
  }
}
