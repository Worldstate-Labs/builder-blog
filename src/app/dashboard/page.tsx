import Link from "next/link";
import { redirect } from "next/navigation";
import type { Digest } from "@prisma/client";
import type { ComponentType, ReactNode } from "react";
import { Archive, BookOpen, CheckCircle2, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ForYouRecommendationSection } from "@/components/ForYouRecommendationSection";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const archivePageSize = 20;

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
    }),
    prisma.digest.findMany({
      where: archiveWhere,
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
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
              <ForYouRecommendationSection />
            ) : (
              <SubscriptionFeed
                archiveCount={archiveCount}
                archiveDigests={archiveDigests}
                archivePage={archivePage}
                todayDigest={todayDigest}
              />
            )}
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
    </AppShell>
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
  archiveCount,
  archiveDigests,
  archivePage,
  todayDigest,
}: {
  archiveCount: number;
  archiveDigests: Digest[];
  archivePage: number;
  todayDigest: Digest | null;
}) {
  const visibleStart = archiveCount === 0 ? 0 : (archivePage - 1) * archivePageSize + 1;
  const visibleEnd = Math.min((archivePage - 1) * archivePageSize + archiveDigests.length, archiveCount);

  return (
    <section className="subscription-feed">
      {todayDigest ? (
        <article className="feed-card">
          <div className="item-kicker">
            <span>Today digest</span>
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
      <section id="digest-archive" className="digest-archive mt-8 scroll-mt-24">
        <div className="page-kicker-row">
          <p className="section-label">Digest archive</p>
          <span className="status-chip">
            Showing {visibleStart}-{visibleEnd} of {archiveCount}
          </span>
        </div>
        <div className="item-list mt-4">
          {archiveDigests.map((digest, index) => (
            <article id={digest.id} key={digest.id} className="digest-card digest-card-compact">
              <details className="item-disclosure" open={index === 0}>
                <summary className="item-summary">
                  <span className="min-w-0">
                    <span className="item-kicker">
                      <span>{digest.createdAt.toLocaleString()}</span>
                      <span>
                        {digest.itemCount} items · {digest.language}
                      </span>
                    </span>
                    <span className="item-title">{digest.title}</span>
                  </span>
                  <span className="item-summary-action">
                    <BookOpen className="h-3.5 w-3.5" />
                    Read
                  </span>
                </summary>
                <pre className="item-details whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--muted-strong)]">
                  {digest.content}
                </pre>
              </details>
            </article>
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
