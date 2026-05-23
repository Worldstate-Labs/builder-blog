import { redirect } from "next/navigation";
import { Sparkles, Unlink, UsersRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  RecommendationFeed,
  type RecommendationFeedEntry,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";
import { getCurrentSession } from "@/lib/auth";
import {
  getRecommendationTimeline,
  type RecommendationSnapshotResult,
} from "@/lib/recommendations";

export default async function RecommendationsPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const feed = await getRecommendationTimeline({
    userId: session.user.id,
    itemLimit: 6,
  });

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <div>
            <div className="page-kicker-row">
              <p className="section-label">Recommendation feed</p>
              <span className="status-chip">
                <Sparkles className="h-3.5 w-3.5" />
                Personalized
              </span>
            </div>
            <h1 className="mt-3 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Unread posts from the wider builder graph.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              Recommendations rank crawled posts from every shared Hub library
              and your own active library into saved snapshots. Reading a post
              updates future recommendation requests without changing the
              snapshot you are looking at.
            </p>
          </div>
          <div className="stats-panel">
            <Stat icon={Sparkles} label="Unread candidates" value={feed.unreadRemaining} />
            <Stat icon={UsersRound} label="Snapshots" value={feed.snapshots.length} />
            <Stat icon={Unlink} label="Read repeats" value="Filtered next" />
          </div>
        </section>

        <RecommendationFeed
          initialSnapshots={feed.snapshots.map(serializeSnapshot)}
        />
      </div>
    </AppShell>
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

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sparkles;
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
