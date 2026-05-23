import { redirect } from "next/navigation";
import { Sparkles, Unlink, UsersRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  RecommendationFeed,
  type RecommendationFeedEntry,
} from "@/components/RecommendationFeed";
import { getCurrentSession } from "@/lib/auth";
import { getRecommendationFeed, type RecommendationResult } from "@/lib/recommendations";

export default async function RecommendationsPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const feed = await getRecommendationFeed({
    userId: session.user.id,
    limit: 20,
    offset: 0,
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
              and your own active library, then remove posts after you read
              them.
            </p>
          </div>
          <div className="stats-panel">
            <Stat icon={Sparkles} label="Unread candidates" value={feed.unreadRemaining} />
            <Stat icon={UsersRound} label="Ranked now" value={feed.candidateCount} />
            <Stat icon={Unlink} label="Read repeats" value="Hidden" />
          </div>
        </section>

        <RecommendationFeed
          initialItems={feed.items.map(serializeRecommendation)}
          initialNextOffset={feed.nextOffset}
        />
      </div>
    </AppShell>
  );
}

function serializeRecommendation(result: RecommendationResult): RecommendationFeedEntry {
  return {
    score: result.score,
    reasons: result.reasons,
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
