import type { BuilderKind, FeedItemKind, Prisma } from "@prisma/client";

const candidateWindow = 1000;
const defaultRecommendationLimit = 6;
const defaultTimelineSnapshotLimit = 3;

type RecommendationBuilder = {
  id: string;
  name: string;
  handle: string | null;
  kind: BuilderKind;
  sourceType: string;
  sourceUrl: string | null;
  crawlUrl: string | null;
  bio: string | null;
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
  crawlingTool: string | null;
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
  items: Array<RecommendationResult & { rank: number; readAt: Date | null }>;
};

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
    where: { userId },
    include: snapshotInclude(userId),
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.floor(snapshotLimit)),
  });

  if (snapshots.length > 0) {
    const unreadRemaining = await unreadCandidateCount(userId);
    return {
      snapshots: snapshots.map((snapshot) => formatSnapshot(snapshot)),
      unreadRemaining,
      strategy: "snapshot-personalized-v1" as const,
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
    strategy: "snapshot-personalized-v1" as const,
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
    strategy: "snapshot-personalized-v1" as const,
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
  const [{ activePoolBuilderIds }, { prisma }] = await Promise.all([
    import("@/lib/builder-pool"),
    import("@/lib/prisma"),
  ]);
  const [poolBuilderIds, hubRows, preference, user, subscriptions, reads, snapshotRows] =
    await Promise.all([
      activePoolBuilderIds(userId),
      prisma.libraryHubItem.findMany({ select: { builderId: true } }),
      prisma.userFeedPreference.findUnique({ where: { userId } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      }),
      prisma.subscription.findMany({
        where: { userId },
        include: { builder: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.feedRead.findMany({
        where: { userId },
        include: {
          feedItem: {
            include: { builder: true },
          },
        },
        orderBy: { readAt: "desc" },
        take: 200,
      }),
      prisma.recommendationSnapshotItem.findMany({
        where: { snapshot: { userId } },
        select: { feedItemId: true },
        take: 5000,
      }),
    ]);
  const eligibleBuilderIds = uniqueIds([
    ...poolBuilderIds,
    ...hubRows.map((row) => row.builderId),
  ]);

  if (eligibleBuilderIds.length === 0) {
    return {
      snapshot: null,
      unreadRemaining: 0,
      candidateCount: 0,
    };
  }

  const unreadWhere: Prisma.FeedItemWhereInput = {
    builderId: { in: eligibleBuilderIds },
    reads: { none: { userId } },
  };
  const alreadySnapshottedFeedItemIds = uniqueIds(
    snapshotRows.map((row) => row.feedItemId),
  );
  const where: Prisma.FeedItemWhereInput = {
    ...unreadWhere,
    ...(alreadySnapshottedFeedItemIds.length > 0
      ? { id: { notIn: alreadySnapshottedFeedItemIds } }
      : {}),
  };
  const [unreadRemaining, newCandidateCount, candidates] = await Promise.all([
    prisma.feedItem.count({ where: unreadWhere }),
    prisma.feedItem.count({ where }),
    prisma.feedItem.findMany({
      where,
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
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: Math.max(candidateWindow, normalizedLimit * 3),
    }),
  ]);
  const signals = buildRecommendationSignals({
    profileText: [preference?.recommendationProfile, user?.name, user?.email]
      .filter(Boolean)
      .join(" "),
    subscriptions: subscriptions.map((subscription) => subscription.builder),
    reads: reads.map((read) => read.feedItem),
  });
  const ranked = candidates
    .map((item) => scoreRecommendation({ item, signals }))
    .sort((a, b) => b.score - a.score || compareDates(b.item, a.item));
  const page = ranked.slice(0, normalizedLimit);

  if (page.length === 0) {
    return {
      snapshot: null,
      unreadRemaining,
      candidateCount: newCandidateCount,
    };
  }

  const snapshot = await prisma.recommendationSnapshot.create({
    data: {
      userId,
      reason,
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
  const [{ activePoolBuilderIds }, { prisma }] = await Promise.all([
    import("@/lib/builder-pool"),
    import("@/lib/prisma"),
  ]);
  const [poolBuilderIds, hubRows] = await Promise.all([
    activePoolBuilderIds(userId),
    prisma.libraryHubItem.findMany({ select: { builderId: true } }),
  ]);
  const eligibleBuilderIds = uniqueIds([
    ...poolBuilderIds,
    ...hubRows.map((row) => row.builderId),
  ]);
  if (eligibleBuilderIds.length === 0) return 0;

  return prisma.feedItem.count({
    where: {
      builderId: { in: eligibleBuilderIds },
      reads: { none: { userId } },
    },
  });
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
    feedItem: RecommendationCandidate & { reads?: { readAt: Date }[] };
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
    const hubSignal = builder.hubItems?.reduce(
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
    builder.crawlUrl,
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
