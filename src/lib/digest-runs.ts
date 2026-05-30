import { prisma } from "@/lib/prisma";

// One post that a digest run actually covered. Resolved from DigestedItem
// (the per-user "this post was included" markers) joined to the FeedItem it
// presented, so the log can show exactly what went into each digest.
export type DigestRunItem = {
  kind: string;
  title: string | null;
  url: string | null;
  source: string | null;
};

// One digest generation, newest first. The Digest table already records every
// generation (including empty "no new updates" ones), so this is the diagnostic
// counterpart to the content-focused digest archive — the digest analogue of
// the library fetch log.
export type DigestRunListItem = {
  id: string;
  createdAt: string;
  source: string;
  status: string;
  language: string;
  itemCount: number;
  title: string;
  periodStart: string;
  periodEnd: string;
  items: DigestRunItem[];
};

const DIGEST_RUN_LIMIT = 25;
const ITEMS_PER_RUN = 100;

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export async function getDigestRuns(
  userId: string,
  limit = DIGEST_RUN_LIMIT,
): Promise<DigestRunListItem[]> {
  const digests = await prisma.digest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      source: true,
      status: true,
      language: true,
      itemCount: true,
      title: true,
      periodStart: true,
      periodEnd: true,
    },
  });
  if (digests.length === 0) return [];

  const digestIds = digests.map((d) => d.id);
  const marks = await prisma.digestedItem.findMany({
    where: { userId, digestId: { in: digestIds } },
    orderBy: { digestedAt: "asc" },
    select: {
      digestId: true,
      kind: true,
      externalId: true,
      feedItem: { select: { title: true, url: true, sourceName: true } },
      entity: { select: { name: true } },
    },
  });

  const itemsByDigest = new Map<string, DigestRunItem[]>();
  for (const mark of marks) {
    if (!mark.digestId) continue;
    const list = itemsByDigest.get(mark.digestId) ?? [];
    if (list.length >= ITEMS_PER_RUN) continue;
    list.push({
      kind: mark.kind,
      title: mark.feedItem?.title ?? null,
      url: mark.feedItem?.url ?? (looksLikeUrl(mark.externalId) ? mark.externalId : null),
      source: mark.feedItem?.sourceName ?? mark.entity?.name ?? null,
    });
    itemsByDigest.set(mark.digestId, list);
  }

  return digests.map((d) => ({
    id: d.id,
    createdAt: d.createdAt.toISOString(),
    source: d.source,
    status: String(d.status),
    language: d.language,
    itemCount: d.itemCount,
    title: d.title,
    periodStart: d.periodStart.toISOString(),
    periodEnd: d.periodEnd.toISOString(),
    items: itemsByDigest.get(d.id) ?? [],
  }));
}
