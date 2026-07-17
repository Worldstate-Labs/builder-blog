export const DUPLICATE_PERSONAL_SOURCE_ERROR =
  "This URL is already in your source library. Edit the existing source instead, or remove it before adding another source type.";

type SourceIdentityInput = {
  sourceUrl?: string | null;
  fetchUrl?: string | null;
};

export function canonicalPersonalSourceUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    // Collapse host aliases that address the same source so www/m/apex and
    // YouTube's mobile/music subdomains dedup to one identity. Dedup-only —
    // the persisted libraryKey (canonicalBuilderKey) is not affected, so this
    // just makes the conflict check stricter, never changes stored keys.
    url.hostname = url.hostname.replace(/^www\./, "");
    if (/(^|\.)youtube\.com$/.test(url.hostname)) {
      url.hostname = url.hostname.replace(/^(m|music)\./, "");
    }
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    // Fold path case to match the persisted libraryKey (canonicalBuilderKey
    // lowercases the whole value). Without this, `/@Alpha` and `/@alpha` pass
    // dedup as distinct yet collide on the stored key, silently overwriting
    // the earlier source.
    url.pathname = url.pathname.toLowerCase().replace(/\/+$/g, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function personalSourceIdentityKeys(input: SourceIdentityInput) {
  return new Set(
    [canonicalPersonalSourceUrl(input.sourceUrl), canonicalPersonalSourceUrl(input.fetchUrl)].filter(
      (key): key is string => Boolean(key),
    ),
  );
}

export async function findConflictingPersonalSource(params: {
  userId: string;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
  excludeBuilderId?: string | null;
}) {
  const incomingKeys = personalSourceIdentityKeys(params);
  if (incomingKeys.size === 0) return null;
  const { prisma } = await import("@/lib/prisma");

  const builders = await prisma.builder.findMany({
    where: {
      ownerUserId: params.userId,
      ...(params.excludeBuilderId ? { id: { not: params.excludeBuilderId } } : {}),
      OR: [{ sourceUrl: { not: null } }, { fetchUrl: { not: null } }],
    },
    select: {
      id: true,
      name: true,
      sourceType: true,
      sourceUrl: true,
      fetchUrl: true,
    },
  });

  return (
    builders.find((builder) => {
      const existingKeys = personalSourceIdentityKeys(builder);
      return [...existingKeys].some((key) => incomingKeys.has(key));
    }) ?? null
  );
}
