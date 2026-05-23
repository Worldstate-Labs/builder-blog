import type { BuilderKind, FeedItemKind, Prisma } from "@prisma/client";

const candidateWindow = 1000;
const defaultRecommendationLimit = 20;

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

export async function getRecommendationFeed({
  userId,
  limit = defaultRecommendationLimit,
  offset = 0,
}: {
  userId: string;
  limit?: number;
  offset?: number;
}) {
  const normalizedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const [{ activePoolBuilderIds }, { prisma }] = await Promise.all([
    import("@/lib/builder-pool"),
    import("@/lib/prisma"),
  ]);
  const [poolBuilderIds, hubRows, preference, user, subscriptions, reads] =
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
    ]);
  const eligibleBuilderIds = uniqueIds([
    ...poolBuilderIds,
    ...hubRows.map((row) => row.builderId),
  ]);

  if (eligibleBuilderIds.length === 0) {
    return {
      items: [],
      nextOffset: null,
      unreadRemaining: 0,
      candidateCount: 0,
      strategy: "personalized-v1" as const,
    };
  }

  const where: Prisma.FeedItemWhereInput = {
    builderId: { in: eligibleBuilderIds },
    reads: { none: { userId } },
  };
  const [candidateCount, candidates] = await Promise.all([
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
      take: Math.max(candidateWindow, normalizedOffset + normalizedLimit * 3),
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
  const page = ranked.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  const nextOffset =
    normalizedOffset + page.length < ranked.length
      ? normalizedOffset + page.length
      : null;

  return {
    items: page,
    nextOffset,
    unreadRemaining: candidateCount,
    candidateCount: ranked.length,
    strategy: "personalized-v1" as const,
  };
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
