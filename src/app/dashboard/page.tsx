import Link from "next/link";
import { redirect } from "next/navigation";
import type { Digest } from "@prisma/client";
import type { ComponentType, ReactNode } from "react";
import { Archive, CheckCircle2, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  RecommendationFeed,
  type RecommendationFeedEntry,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getRecommendationTimeline,
  type RecommendationSnapshotResult,
} from "@/lib/recommendations";

type DashboardSearchParams = Promise<{ tab?: string | string[] }>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const selectedTab = firstParam(params.tab) === "subscription" ? "subscription" : "for-you";

  const [todayDigest, recentDigests, digestCount, recommendationFeed] = await Promise.all([
    prisma.digest.findFirst({
      where: {
        userId: session.user.id,
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.digest.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.digest.count({
      where: { userId: session.user.id },
    }),
    selectedTab === "for-you"
      ? getRecommendationTimeline({
          userId: session.user.id,
          itemLimit: 6,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <h1 className="sr-only">Home</h1>
        <section className="home-layout">
          <div className="home-main">
            <nav className="home-tabs" aria-label="Home feed">
              <HomeTabLink active={selectedTab === "for-you"} href="/dashboard">
                For You
              </HomeTabLink>
              <HomeTabLink active={selectedTab === "subscription"} href="/dashboard?tab=subscription">
                Subscription
              </HomeTabLink>
            </nav>
            {selectedTab === "for-you" ? (
              recommendationFeed ? (
                <RecommendationFeed
                  initialSnapshots={recommendationFeed.snapshots.map(serializeSnapshot)}
                />
              ) : (
                <ForYouUnavailable />
              )
            ) : (
              <SubscriptionFeed
                recentDigests={recentDigests}
                todayDigest={todayDigest}
              />
            )}
          </div>
          <aside className="home-rail">
            <div className="home-rail-section">
              <h2>Home</h2>
              <div className="mt-4 grid gap-3">
                <Stat icon={Sparkles} label="For You" value={recommendationFeed?.unreadRemaining ?? "Live"} />
                <Stat
                  icon={todayDigest ? CheckCircle2 : Clock3}
                  label="Subscription"
                  value={todayDigest ? "Synced" : "Waiting"}
                />
                <Stat icon={Archive} label="Archive entries" value={digestCount} />
              </div>
            </div>
            <div className="home-rail-section">
              <h2>Recent subscription</h2>
              <div className="mt-4 grid gap-3">
                {recentDigests.slice(0, 4).map((digest) => (
                  <Link className="home-rail-link" href={`/history#${digest.id}`} key={digest.id}>
                    <strong>{digest.title}</strong>
                    <span>{digest.itemCount} items · {digest.createdAt.toLocaleDateString()}</span>
                  </Link>
                ))}
                {recentDigests.length === 0 ? (
                  <p className="text-sm leading-6 text-[var(--muted-strong)]">
                    Subscription entries appear after the digest skill syncs.
                  </p>
                ) : null}
              </div>
            </div>
            <Link className="button-light button-compact gap-2" href="/builders">
              <UsersRound className="h-4 w-4" />
              Manage builders
            </Link>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}

function ForYouUnavailable() {
  return (
    <div className="empty-panel mt-6 border-dashed md:p-8">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 text-[var(--accent)]" />
        <div>
          <h2 className="font-serif text-2xl text-[var(--ink)]">For You is not ready yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
            Recommendation snapshots will appear here after the recommendation store is available.
          </p>
        </div>
      </div>
    </div>
  );
}

function HomeTabLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: ReactNode;
  href: string;
}) {
  return (
    <Link aria-current={active ? "page" : undefined} data-active={active ? "true" : undefined} href={href}>
      {children}
    </Link>
  );
}

function SubscriptionFeed({
  recentDigests,
  todayDigest,
}: {
  recentDigests: Digest[];
  todayDigest: Digest | null;
}) {
  return (
    <section className="subscription-feed">
      {todayDigest ? (
        <article className="feed-card">
          <div className="item-kicker">
            <span>Subscription</span>
            <span>{todayDigest.createdAt.toLocaleDateString()}</span>
            <span>{todayDigest.itemCount} items</span>
          </div>
          <h2 className="mt-3 font-serif text-3xl">{todayDigest.title}</h2>
          <pre className="digest-body mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-[var(--muted-strong)]">
            {todayDigest.content}
          </pre>
        </article>
      ) : (
        <div className="empty-panel border-dashed md:p-8">
          <div className="flex items-start gap-3">
            <Terminal className="mt-1 h-5 w-5 text-[var(--accent)]" />
            <div>
              <h2 className="font-serif text-2xl text-[var(--ink)]">No subscription sync today</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                Run the skill from your terminal or agent, then sync the generated subscription here.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="item-list mt-5">
        {recentDigests
          .filter((digest) => digest.id !== todayDigest?.id)
          .map((digest) => (
            <Link className="feed-card feed-card-compact" href={`/history#${digest.id}`} key={digest.id}>
              <div className="item-kicker">
                <span>Subscription</span>
                <span>{digest.createdAt.toLocaleDateString()}</span>
                <span>{digest.itemCount} items</span>
              </div>
              <h2 className="mt-2 font-serif text-2xl">{digest.title}</h2>
            </Link>
          ))}
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="stat-card">
      <Icon className="stat-card-icon" />
      <div className="min-w-0">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

function serializeSnapshot(snapshot: RecommendationSnapshotResult): RecommendationSnapshotEntry {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt.toISOString(),
    reason: snapshot.reason,
    items: snapshot.items.map(serializeRecommendation),
  };
}

function serializeRecommendation(
  result: RecommendationSnapshotResult["items"][number],
): RecommendationFeedEntry {
  return {
    score: result.score,
    reasons: result.reasons,
    rank: result.rank,
    readAt: result.readAt?.toISOString() ?? null,
    item: {
      id: result.item.id,
      title: result.item.title,
      body: result.item.body,
      url: result.item.url,
      publishedAt: result.item.publishedAt?.toISOString() ?? null,
      createdAt: result.item.createdAt.toISOString(),
      sourceName: result.item.sourceName,
      crawlingTool: result.item.crawlingTool,
      builder: result.item.builder
        ? {
            name: result.item.builder.name,
            sourceType: result.item.builder.sourceType,
            kind: result.item.builder.kind,
            sourceUrl: result.item.builder.sourceUrl,
            crawlUrl: result.item.builder.crawlUrl,
          }
        : null,
    },
  };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
