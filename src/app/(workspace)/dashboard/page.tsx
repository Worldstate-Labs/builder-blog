import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { Archive, CheckCircle2, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import { ForYouRecommendationSection } from "@/components/ForYouRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const archivePageSize = 20;
const digestSummarySelect = {
  id: true,
  title: true,
  itemCount: true,
  language: true,
  createdAt: true,
};
type DigestSummaryRow = Omit<DigestSummary, "createdAt"> & { createdAt: Date };

type DashboardSearchParams = Promise<{
  archivePage?: string | string[];
  tab?: string | string[];
}>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const selectedTab = firstParam(params.tab) === "subscription" ? "subscription" : "for-you";
  const archivePage = Math.max(1, Number(firstParam(params.archivePage) ?? "1") || 1);
  const archiveSkip = (archivePage - 1) * archivePageSize;

  const [todayDigest, digestCount] = await Promise.all([
    prisma.digest.findFirst({
      where: {
        userId: session.user.id,
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
      orderBy: { createdAt: "desc" },
      select: digestSummarySelect,
    }),
    prisma.digest.count({
      where: { userId: session.user.id },
    }),
  ]);
  const archiveWhere = todayDigest
    ? { userId: session.user.id, NOT: { id: todayDigest.id } }
    : { userId: session.user.id };
  const archiveCount = Math.max(0, digestCount - (todayDigest ? 1 : 0));
  const [archiveDigests, recentArchiveDigests] = await Promise.all([
    prisma.digest.findMany({
      where: archiveWhere,
      orderBy: { createdAt: "desc" },
      skip: archiveSkip,
      take: archivePageSize,
      select: digestSummarySelect,
    }),
    prisma.digest.findMany({
      where: archiveWhere,
      orderBy: { createdAt: "desc" },
      take: 4,
      select: digestSummarySelect,
    }),
  ]);

  return (
    <div className="page-pad">
      <h1 className="sr-only">Home</h1>
      <section className="home-layout">
        <div className="home-main">
          <DashboardHomeTabs
            initialTab={selectedTab}
            forYou={<ForYouRecommendationSection />}
            subscription={
              <SubscriptionFeed
                archiveCount={archiveCount}
                archiveDigests={archiveDigests}
                archivePage={archivePage}
                todayDigest={todayDigest}
              />
            }
          />
        </div>
        <aside className="home-rail">
          <div className="home-rail-section">
            <h2>Home</h2>
            <div className="mt-4 grid gap-3">
              <Stat icon={Sparkles} label="For You" value="Live" />
              <Stat
                icon={todayDigest ? CheckCircle2 : Clock3}
                label="Subscription"
                value={todayDigest ? "Synced" : "Waiting"}
              />
              <Stat icon={Archive} label="Archive entries" value={archiveCount} />
            </div>
          </div>
          <div className="home-rail-section">
            <h2>Recent subscription</h2>
            <div className="mt-4 grid gap-3">
              {recentArchiveDigests.map((digest) => (
                <Link
                  className="home-rail-link"
                  href={`/dashboard?tab=subscription#${digest.id}`}
                  key={digest.id}
                >
                  <strong>{digest.title}</strong>
                  <span>{digest.itemCount} items · {digest.createdAt.toLocaleDateString()}</span>
                </Link>
              ))}
              {recentArchiveDigests.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--muted-strong)]">
                  Older digests appear here after another subscription sync.
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
  );
}

function SubscriptionFeed({
  archiveCount,
  archiveDigests,
  archivePage,
  todayDigest,
}: {
  archiveCount: number;
  archiveDigests: DigestSummaryRow[];
  archivePage: number;
  todayDigest: DigestSummaryRow | null;
}) {
  const visibleStart = archiveCount === 0 ? 0 : (archivePage - 1) * archivePageSize + 1;
  const visibleEnd = Math.min((archivePage - 1) * archivePageSize + archiveDigests.length, archiveCount);

  return (
    <section className="subscription-feed">
      {todayDigest ? (
        <DigestDetails digest={serializeDigestSummary(todayDigest)} mode="today" />
      ) : (
        <div className="empty-panel border-dashed md:p-8">
          <div className="flex items-start gap-3">
            <Terminal className="mt-1 h-5 w-5 text-[var(--accent)]" />
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">No subscription sync today</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                Run the skill from your terminal or agent, then sync the generated subscription here.
              </p>
            </div>
          </div>
        </div>
      )}
      <section id="digest-archive" className="digest-archive mt-8 scroll-mt-24">
        <div className="page-kicker-row">
          <p className="section-label">Digest archive</p>
          <span className="status-chip">
            Showing {visibleStart}-{visibleEnd} of {archiveCount}
          </span>
        </div>
        <div className="item-list mt-4">
          {archiveDigests.map((digest, index) => (
            <DigestDetails
              defaultOpen={index === 0}
              digest={serializeDigestSummary(digest)}
              key={digest.id}
            />
          ))}
          {archiveDigests.length === 0 ? (
            <div className="empty-panel border-dashed md:p-10">
              Historical digests will appear here after more subscription syncs.
            </div>
          ) : null}
        </div>
        {archiveCount > archivePageSize ? (
          <nav className="mt-6 flex flex-wrap gap-3" aria-label="Digest archive pagination">
            <Link
              aria-disabled={archivePage === 1}
              className={`button-light button-compact ${
                archivePage === 1 ? "pointer-events-none opacity-45" : ""
              }`}
              href={`/dashboard?tab=subscription&archivePage=${Math.max(1, archivePage - 1)}#digest-archive`}
            >
              Newer
            </Link>
            <Link
              aria-disabled={visibleEnd >= archiveCount}
              className={`button-light button-compact ${
                visibleEnd >= archiveCount ? "pointer-events-none opacity-45" : ""
              }`}
              href={`/dashboard?tab=subscription&archivePage=${archivePage + 1}#digest-archive`}
            >
              Older
            </Link>
          </nav>
        ) : null}
      </section>
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

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function serializeDigestSummary(digest: DigestSummaryRow) {
  return {
    ...digest,
    createdAt: digest.createdAt.toISOString(),
  };
}
