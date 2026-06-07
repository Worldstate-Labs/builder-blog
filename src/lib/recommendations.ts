import type { BuilderKind, FeedItemKind, Prisma, PrismaClient } from "@prisma/client";

const candidateWindow = 1000;
const defaultRecommendationLimit = 6;
const defaultTimelineSnapshotLimit = 3;

type RecommendationBuilder = {
  id: string;
  entityId: string | null;
  avatarUrl: string | null;
  name: string;
  handle: string | null;
  kind: BuilderKind;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  bio: string | null;
  ownerUserId: string | null;
  lastFetchedAt: Date | null;
  hubItems?: {
    hubEntry: {
      name: string;
      description: string | null;
      importCount: number;
      viewCount: number;
    };
  }[];
};

export type RecommendationCandidate = {
  id: string;
  kind: FeedItemKind;
  title: string | null;
  body: string;
  summary: string | null;
  url: string;
  publishedAt: Date | null;
  createdAt: Date;
  sourceName: string | null;
  fetchTool: string | null;
  builder: RecommendationBuilder | null;
};

export type RecommendationSignals = {
  profileText: string;
  terms: Map<string, number>;
  subscribedBuilderIds: Set<string>;
  readBuilderIds: Set<string>;
  kindAffinity: Map<string, number>;
  sourceAffinity: Map<string, number>;
};

export type RecommendationResult = {
  item: RecommendationCandidate;
  score: number;
  reasons: string[];
};

export type RecommendationSnapshotResult = {
  id: string;
  createdAt: Date;
  reason: string;
  items: Array<
    RecommendationResult & {
      favoritedAt?: Date | null;
      markedReadAt?: Date | null;
      rank: number;
      readAt: Date | null;
    }
  >;
};

async function attachHubItems(
  candidates: CandidateList,
  prisma: PrismaClient,
): Promise<CandidateList> {
  const builderIds = [
    ...new Set(candidates.map((c) => c.builder?.id).filter((id): id is string => Boolean(id))),
  ];
  if (builderIds.length === 0) return candidates;

  const hubItems = await prisma.libraryHubItem.findMany({
    where: { builderId: { in: builderIds } },
    select: {
      builderId: true,
      hubEntry: {
        select: {
          name: true,
          description: true,
          importCount: true,
          viewCount: true,
        },
      },
    },
  });

  const hubMap = new Map<string, typeof hubItems>();
  for (const item of hubItems) {
    const list = hubMap.get(item.builderId) ?? [];
    list.push(item);
    hubMap.set(item.builderId, list);
  }

  return candidates.map((candidate) => {
    if (!candidate.builder) return candidate;
    const items = hubMap.get(candidate.builder.id) ?? [];
    return {
      ...candidate,
      builder: { ...candidate.builder, hubItems: items },
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getRecommendationTimeline({
  userId,
  snapshotLimit = defaultTimelineSnapshotLimit,
  itemLimit = defaultRecommendationLimit,
}: {
  userId: string;
  snapshotLimit?: number;
  itemLimit?: number;
}) {
  const { prisma } = await import("@/lib/prisma");
  const snapshots = await prisma.recommendationSnapshot.findMany({
    where: snapshotWhere(userId),
    include: snapshotInclude(userId),
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.floor(snapshotLimit)),
  });

  if (snapshots.length > 0) {
    const unreadRemaining = await unreadCandidateCount(userId);
    return {
      snapshots: snapshots.map((snapshot) => formatSnapshot(snapshot)),
      unreadRemaining,
      strategy: "snapshot-subscription-v1" as const,
    };
  }

  const created = await createRecommendationSnapshot({
    userId,
    limit: itemLimit,
    reason: "initial",
  });

  return {
    snapshots: created.snapshot ? [created.snapshot] : [],
    unreadRemaining: created.unreadRemaining,
    strategy: "snapshot-subscription-v1" as const,
  };
}

export async function getRecommendationFeed({
  userId,
  limit = defaultRecommendationLimit,
  reason = "recommendation",
}: {
  userId: string;
  limit?: number;
  reason?: string;
}) {
  const created = await createRecommendationSnapshot({ userId, limit, reason });
  return {
    items: created.snapshot?.items ?? [],
    snapshot: created.snapshot,
    nextOffset: created.snapshot?.items.length ? 1 : null,
    unreadRemaining: created.unreadRemaining,
    candidateCount: created.candidateCount,
    strategy: "snapshot-subscription-v1" as const,
  };
}

export async function createRecommendationSnapshot({
  userId,
  limit = defaultRecommendationLimit,
  reason = "recommendation",
}: {
  userId: string;
  limit?: number;
  reason?: string;
}): Promise<{
  snapshot: RecommendationSnapshotResult | null;
  unreadRemaining: number;
  candidateCount: number;
}> {
  const normalizedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const { prisma } = await import("@/lib/prisma");

  const cutoff = new Date(Date.now() - 90 * 86400000);

  const [user, subscriptions, reads, snapshotRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    }),
    prisma.subscription.findMany({
      where: { userId },
      select: {
        builderId: true,
        builder: {
          select: {
            id: true,
            entityId: true,
            avatarUrl: true,
            name: true,
            handle: true,
            kind: true,
            sourceType: true,
            sourceUrl: true,
            fetchUrl: true,
            bio: true,
            ownerUserId: true,
            lastFetchedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.feedRead.findMany({
      where: { userId },
      select: {
        feedItem: {
          select: {
            id: true,
            kind: true,
            title: true,
            body: true,
            summary: true,
            url: true,
            publishedAt: true,
            createdAt: true,
            sourceName: true,
            fetchTool: true,
            builder: {
              select: {
                id: true,
                entityId: true,
                avatarUrl: true,
                name: true,
                handle: true,
                kind: true,
                sourceType: true,
                sourceUrl: true,
                fetchUrl: true,
                bio: true,
                ownerUserId: true,
                lastFetchedAt: true,
              },
            },
          },
        },
      },
      orderBy: { readAt: "desc" },
      take: 50,
    }),
    prisma.recommendationSnapshotItem.findMany({
      where: { snapshot: snapshotWhere(userId) },
      select: { feedItemId: true },
      take: 5000,
    }),
  ]);

  const subscriptionBuilderIds = subscriptions.map((s) => s.builderId);

  // ---------------------------------------------------------------------------
  // Fetch candidates
  // ---------------------------------------------------------------------------

  if (subscriptionBuilderIds.length === 0) {
    return { snapshot: null, unreadRemaining: 0, candidateCount: 0 };
  }

  const rawCandidates: CandidateList = await prisma.feedItem.findMany({
    where: {
      builderId: { in: subscriptionBuilderIds },
      createdAt: { gte: cutoff },
    },
    include: {
      builder: {
        select: {
          id: true,
          entityId: true,
          avatarUrl: true,
          name: true,
          handle: true,
          kind: true,
          sourceType: true,
          sourceUrl: true,
          fetchUrl: true,
          bio: true,
          ownerUserId: true,
          lastFetchedAt: true,
        },
      },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(candidateWindow, normalizedLimit * 3),
  });

  const readEntityKeys = new Set(
    (
      await prisma.feedRead.findMany({
        where: { userId },
        select: { entityId: true, kind: true, externalId: true },
      })
    ).map((r) => `${r.entityId}:${r.kind}:${r.externalId}`),
  );

  const snapshottedEntityKeys = new Set(
    (
      await prisma.feedItem.findMany({
        where: { id: { in: uniqueIds(snapshotRows.map((row) => row.feedItemId)) } },
        select: {
          kind: true,
          externalId: true,
          builder: { select: { entityId: true } },
        },
      })
    )
      .filter((r) => r.builder?.entityId)
      .map((r) => `${r.builder!.entityId}:${r.kind}:${r.externalId}`),
  );

  const dedupGroups = new Map<string, typeof rawCandidates>();
  for (const item of rawCandidates) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const key = `${entityId}:${item.kind}:${item.externalId}`;
    if (readEntityKeys.has(key)) continue;
    if (snapshottedEntityKeys.has(key)) continue;
    const list = dedupGroups.get(key) ?? [];
    list.push(item);
    dedupGroups.set(key, list);
  }

  const unreadRemaining = dedupGroups.size;

  const candidates = await attachHubItems(
    pickPrimaryVariants(
      userId,
      dedupGroups,
      await prisma.userChannelPreference.findMany({
        where: {
          userId,
          entityId: { in: [...new Set([...dedupGroups.keys()].map((key) => key.split(":")[0]))] },
        },
        select: { entityId: true, primaryBuilderId: true },
      }),
    ),
    prisma,
  );

  return buildAndSaveSnapshot({
    userId,
    normalizedLimit,
    reason,
    candidates,
    unreadRemaining,
    subscriptions,
    reads,
    user,
    prisma,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CandidateList = Array<
  RecommendationCandidate & {
    builderId: string | null;
    externalId: string;
  }
>;

function pickPrimaryVariants(
  userId: string,
  dedupGroups: Map<string, CandidateList>,
  channelPrefs: Array<{ entityId: string; primaryBuilderId: string }>,
): CandidateList {
  const pinnedMap = new Map(channelPrefs.map((p) => [p.entityId, p.primaryBuilderId]));
  const candidates: CandidateList = [];
  for (const variants of dedupGroups.values()) {
    const first = variants[0]!;
    const entityId = first.builder!.entityId!;
    const pinned = pinnedMap.get(entityId);
    let pick: CandidateList[number] | undefined;
    if (variants.length === 1) {
      pick = variants[0]!;
    } else {
      const byBuilder = new Map(variants.map((v) => [v.builderId, v]));
      pick =
        (pinned ? byBuilder.get(pinned) : undefined) ||
        variants.find((v) => v.builder?.ownerUserId === userId) ||
        [...variants].sort((a, b) => {
          const aT = (a.builder?.lastFetchedAt ?? a.publishedAt ?? a.createdAt).getTime();
          const bT = (b.builder?.lastFetchedAt ?? b.publishedAt ?? b.createdAt).getTime();
          return bT - aT;
        })[0]!;
    }
    candidates.push(pick);
  }
  return candidates;
}

async function buildAndSaveSnapshot({
  userId,
  normalizedLimit,
  reason,
  candidates,
  unreadRemaining,
  subscriptions,
  reads,
  user,
  prisma,
}: {
  userId: string;
  normalizedLimit: number;
  reason: string;
  candidates: CandidateList;
  unreadRemaining: number;
  subscriptions: Array<{
    builderId: string;
    builder: {
      id: string;
      entityId: string | null;
      avatarUrl: string | null;
      name: string;
      handle: string | null;
      kind: BuilderKind;
      sourceType: string;
      sourceUrl: string | null;
      fetchUrl: string | null;
      bio: string | null;
      ownerUserId: string | null;
      lastFetchedAt: Date | null;
    } | null;
  }>;
  reads: Array<{
    feedItem: {
      id: string;
      kind: FeedItemKind;
      title: string | null;
      body: string;
      summary: string | null;
      url: string;
      publishedAt: Date | null;
      createdAt: Date;
      sourceName: string | null;
      fetchTool: string | null;
      builder: {
        id: string;
        entityId: string | null;
        avatarUrl: string | null;
        name: string;
        handle: string | null;
        kind: BuilderKind;
        sourceType: string;
        sourceUrl: string | null;
        fetchUrl: string | null;
        bio: string | null;
        ownerUserId: string | null;
        lastFetchedAt: Date | null;
      } | null;
    } | null;
  }>;
  user: { name: string | null; email: string | null } | null;
  prisma: PrismaClient;
}): Promise<{
  snapshot: RecommendationSnapshotResult | null;
  unreadRemaining: number;
  candidateCount: number;
}> {
  const newCandidateCount = candidates.length;

  const signals = buildRecommendationSignals({
    profileText: [user?.name, user?.email].filter(Boolean).join(" "),
    subscriptions: subscriptions
      .map((s) => s.builder)
      .filter((b): b is NonNullable<typeof b> => Boolean(b)),
    reads: reads
      .map((r) => r.feedItem)
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  });

  const ranked = candidates
    .map((item) => scoreRecommendation({ item, signals }))
    .sort((a, b) => b.score - a.score || compareDates(b.item, a.item));
  const page = ranked.slice(0, normalizedLimit);

  if (page.length === 0) {
    return { snapshot: null, unreadRemaining, candidateCount: newCandidateCount };
  }

  const snapshot = await prisma.recommendationSnapshot.create({
    data: {
      userId,
      reason: snapshotReason(reason),
      items: {
        create: page.map((result, index) => ({
          feedItemId: result.item.id,
          rank: index + 1,
          score: result.score,
          reasons: JSON.stringify(result.reasons),
        })),
      },
    },
    include: snapshotInclude(userId),
  });

  return {
    snapshot: formatSnapshot(snapshot),
    unreadRemaining,
    candidateCount: newCandidateCount,
  };
}

async function unreadCandidateCount(userId: string) {
  const { prisma } = await import("@/lib/prisma");
  const cutoff = new Date(Date.now() - 90 * 86400000);

  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    select: { builderId: true },
  });
  const builderIds = subscriptions.map((s) => s.builderId);
  if (builderIds.length === 0) return 0;
  const candidates = await prisma.feedItem.findMany({
    where: {
      builderId: { in: builderIds },
      createdAt: { gte: cutoff },
    },
    select: {
      kind: true,
      externalId: true,
      builder: { select: { entityId: true } },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: candidateWindow,
  });
  const readEntityKeys = new Set(
    (
      await prisma.feedRead.findMany({
        where: { userId },
        select: { entityId: true, kind: true, externalId: true },
      })
    ).map((r) => `${r.entityId}:${r.kind}:${r.externalId}`),
  );

  const seen = new Set<string>();
  for (const item of candidates) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const key = `${entityId}:${item.kind}:${item.externalId}`;
    if (readEntityKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
  }
  return seen.size;
}

function snapshotWhere(userId: string): Prisma.RecommendationSnapshotWhereInput {
  return {
    userId,
    reason: { startsWith: "subscription:" },
  };
}

function snapshotReason(reason: string) {
  return `subscription:${reason}`;
}

function snapshotInclude(userId: string) {
  return {
    items: {
      include: {
        feedItem: {
          include: {
            builder: {
              include: {
                hubItems: {
                  include: {
                    hubEntry: {
                      select: {
                        name: true,
                        description: true,
                        importCount: true,
                        viewCount: true,
                      },
                    },
                  },
                },
              },
            },
            reads: {
              where: { userId },
              select: { readAt: true },
              take: 1,
            },
            favorites: {
              where: { userId },
              select: { favoritedAt: true, markedReadAt: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { rank: "asc" as const },
    },
  };
}

function formatSnapshot(snapshot: {
  id: string;
  createdAt: Date;
  reason: string;
  items: Array<{
    rank: number;
    score: number;
    reasons: string;
    feedItem: RecommendationCandidate & {
      favorites?: { favoritedAt: Date; markedReadAt: Date | null }[];
      reads?: { readAt: Date }[];
    };
  }>;
}): RecommendationSnapshotResult {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    items: snapshot.items.map((item) => ({
      item: item.feedItem,
      rank: item.rank,
      score: item.score,
      reasons: parseReasons(item.reasons),
      readAt: item.feedItem.reads?.[0]?.readAt ?? null,
      favoritedAt: item.feedItem.favorites?.[0]?.favoritedAt ?? null,
      markedReadAt: item.feedItem.favorites?.[0]?.markedReadAt ?? null,
    })),
  };
}

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((reason): reason is string => typeof reason === "string")
      : [];
  } catch {
    return [];
  }
}

export function buildRecommendationSignals({
  profileText,
  subscriptions,
  reads,
}: {
  profileText: string;
  subscriptions: RecommendationBuilder[];
  reads: RecommendationCandidate[];
}): RecommendationSignals {
  const terms = new Map<string, number>();
  addTerms(terms, profileText, 3);

  const subscribedBuilderIds = new Set<string>();
  const readBuilderIds = new Set<string>();
  const kindAffinity = new Map<string, number>();
  const sourceAffinity = new Map<string, number>();

  for (const builder of subscriptions) {
    subscribedBuilderIds.add(builder.id);
    addTerms(terms, builderText(builder), 2);
    increment(kindAffinity, builder.kind, 2);
    increment(sourceAffinity, builder.sourceType, 2);
  }

  for (const read of reads) {
    if (read.builder) {
      readBuilderIds.add(read.builder.id);
      addTerms(terms, builderText(read.builder), 1);
      increment(sourceAffinity, read.builder.sourceType, 1);
    }
    increment(kindAffinity, read.kind, 1);
    addTerms(terms, itemText(read), 1);
  }

  return {
    profileText,
    terms,
    subscribedBuilderIds,
    readBuilderIds,
    kindAffinity,
    sourceAffinity,
  };
}

export function scoreRecommendation({
  item,
  signals,
  now = new Date(),
}: {
  item: RecommendationCandidate;
  signals: RecommendationSignals;
  now?: Date;
}): RecommendationResult {
  const reasons: string[] = [];
  let score = 0;
  const itemTerms = tokenize(`${item.title ?? ""} ${item.body} ${item.sourceName ?? ""}`);
  let termScore = 0;
  for (const term of itemTerms) {
    termScore += Math.min(4, signals.terms.get(term) ?? 0);
  }
  if (termScore > 0) {
    score += Math.min(24, termScore * 1.8);
    reasons.push("matches your profile and reading topics");
  }

  const builder = item.builder;
  if (builder) {
    if (signals.subscribedBuilderIds.has(builder.id)) {
      score += 18;
      reasons.push("from a subscribed builder");
    } else if (signals.readBuilderIds.has(builder.id)) {
      score += 10;
      reasons.push("from a builder you have read before");
    }

    const sourceScore = signals.sourceAffinity.get(builder.sourceType) ?? 0;
    if (sourceScore > 0) {
      score += Math.min(10, sourceScore * 1.5);
      reasons.push(`similar ${builder.sourceType} source`);
    }
    const hubSignal =
      builder.hubItems?.reduce(
        (sum, item) => sum + item.hubEntry.importCount * 2 + item.hubEntry.viewCount,
        0,
      ) ?? 0;
    if (hubSignal > 0) {
      score += Math.min(8, Math.log1p(hubSignal));
      reasons.push("popular in shared libraries");
    }
  }

  const kindScore =
    (signals.kindAffinity.get(item.kind) ?? 0) +
    (builder ? signals.kindAffinity.get(builder.kind) ?? 0 : 0);
  if (kindScore > 0) {
    score += Math.min(10, kindScore * 1.2);
    reasons.push("same content format as your activity");
  }

  const ageDays = Math.max(
    0,
    (now.getTime() - originalPostTime(item).getTime()) / (24 * 60 * 60 * 1000),
  );
  score += Math.max(0, 14 - ageDays / 3);
  if (ageDays <= 14) reasons.push("recent post");

  if (item.body.length > 800) score += 2;

  return {
    item,
    score: Number(score.toFixed(4)),
    reasons: uniqueIds(reasons).slice(0, 4),
  };
}

export function originalPostTime(item: Pick<RecommendationCandidate, "publishedAt" | "createdAt">) {
  return item.publishedAt ?? item.createdAt;
}

function addTerms(target: Map<string, number>, text: string, weight: number) {
  for (const term of tokenize(text)) {
    increment(target, term, weight);
  }
}

function tokenize(text: string) {
  return new Set(
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu)
      ?.filter((term) => !stopTerms.has(term) && term.length > 2)
      .slice(0, 240) ?? [],
  );
}

function increment(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function builderText(builder: RecommendationBuilder) {
  return [
    builder.name,
    builder.handle,
    builder.sourceType,
    builder.bio,
    builder.sourceUrl,
    builder.fetchUrl,
  ]
    .filter(Boolean)
    .join(" ");
}

function itemText(item: RecommendationCandidate) {
  return [item.title, item.body, item.sourceName, item.url].filter(Boolean).join(" ");
}

function compareDates(a: RecommendationCandidate, b: RecommendationCandidate) {
  return originalPostTime(a).getTime() - originalPostTime(b).getTime();
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values));
}

const stopTerms = new Set([
  "about",
  "after",
  "again",
  "and",
  "are",
  "for",
  "from",
  "has",
  "into",
  "not",
  "the",
  "this",
  "with",
  "you",
  "your",
]);
