import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ComponentType } from "react";
import { Archive, CheckCircle2, ChevronRight, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import { ForYouRecommendationSection } from "@/components/ForYouRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
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
  const userId = session.user.id;
  const params = await searchParams;
  const selectedTab = parseTab(firstParam(params.tab));
  const archivePage = Math.max(1, Number(firstParam(params.archivePage) ?? "1") || 1);

  return (
    <div className="page-pad">
      <h1 className="sr-only">Home</h1>
      <section className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <DashboardHomeTabs
            initialTab={selectedTab}
            aiDigest={
              <Suspense fallback={<AiDigestFeedSkeleton />}>
                <AiDigestFeedSlot userId={userId} archivePage={archivePage} />
              </Suspense>
            }
            forYou={<ForYouRecommendationSection scope="for-you" />}
            subscription={
              <ForYouRecommendationSection scope="subscription" />
            }
          />
        </div>
        <aside className="fb-rail at-desktop">
          <div>
            <h3>Home</h3>
            <Suspense fallback={<HomeStatsSkeleton />}>
              <HomeStatsSlot userId={userId} />
            </Suspense>
          </div>
          <div>
            <h3>Recent digest</h3>
            <Suspense fallback={<RecentDigestSkeleton />}>
              <RecentDigestSlot userId={userId} />
            </Suspense>
          </div>
          <Link className="fb-btn light compact" href="/builders">
            <UsersRound aria-hidden="true" />
            Manage sources
          </Link>
        </aside>
      </section>
    </div>
  );
}

async function AiDigestFeedSlot({
  userId,
  archivePage,
}: {
  userId: string;
  archivePage: number;
}) {
  const archiveSkip = (archivePage - 1) * archivePageSize;

  const [todayDigest, digestCount, rawTokens] = await Promise.all([
    prisma.digest.findFirst({
      where: {
        userId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      orderBy: { createdAt: "desc" },
      select: digestSummarySelect,
    }),
    prisma.digest.count({ where: { userId } }),
    prisma.agentToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        lastIp: true,
        lastUserAgent: true,
        lastHostname: true,
        lastPlatform: true,
        lastUser: true,
      },
    }),
  ]);

  const activeTokens: AgentTokenListItem[] = rawTokens.map((token) => ({
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastIp: token.lastIp ?? null,
    lastUserAgent: token.lastUserAgent ?? null,
    lastHostname: token.lastHostname ?? null,
    lastPlatform: token.lastPlatform ?? null,
    lastUser: token.lastUser ?? null,
    revokedAt: null,
  }));
  const archiveWhere = todayDigest
    ? { userId, NOT: { id: todayDigest.id } }
    : { userId };
  const archiveCount = Math.max(0, digestCount - (todayDigest ? 1 : 0));
  const archiveDigests = await prisma.digest.findMany({
    where: archiveWhere,
    orderBy: { createdAt: "desc" },
    skip: archiveSkip,
    take: archivePageSize,
    select: digestSummarySelect,
  });

  return (
    <AiDigestFeed
      activeTokens={activeTokens}
      archiveCount={archiveCount}
      archiveDigests={archiveDigests}
      archivePage={archivePage}
      todayDigest={todayDigest}
    />
  );
}

function AiDigestFeed({
  activeTokens,
  archiveCount,
  archiveDigests,
  archivePage,
  todayDigest,
}: {
  activeTokens: AgentTokenListItem[];
  archiveCount: number;
  archiveDigests: DigestSummaryRow[];
  archivePage: number;
  todayDigest: DigestSummaryRow | null;
}) {
  const visibleStart = archiveCount === 0 ? 0 : (archivePage - 1) * archivePageSize + 1;
  const visibleEnd = Math.min((archivePage - 1) * archivePageSize + archiveDigests.length, archiveCount);

  return (
    <section className="grid gap-5">
      <div className="mt-4">
        <SkillPromptActions context="digest" tokens={activeTokens} />
      </div>
      {todayDigest ? (
        <DigestDetails digest={serializeDigestSummary(todayDigest)} mode="today" />
      ) : (
        <div className="fb-panel dashed">
          <div className="flex items-start gap-3">
            <Terminal className="mt-1 h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
            <div>
              <h2 className="serif text-lg font-semibold text-[var(--ink)]">
                No subscription sync today
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                Run the skill from your terminal or agent, then sync the generated subscription here.
              </p>
            </div>
          </div>
        </div>
      )}
      <section id="digest-archive" className="mt-8 scroll-mt-24">
        <div className="flex flex-wrap items-center gap-3">
          <span className="fb-section-label">Digest archive</span>
          <span className="fb-chip">
            Showing {visibleStart}-{visibleEnd} of {archiveCount}
          </span>
        </div>
        <div className="mt-4 at-desktop gap-3 lg:grid">
          {archiveDigests.map((digest, index) => (
            <DigestDetails
              defaultOpen={index === 0}
              digest={serializeDigestSummary(digest)}
              key={digest.id}
            />
          ))}
          {archiveDigests.length === 0 ? (
            <div className="fb-panel dashed text-sm text-[var(--muted-strong)]">
              Historical digests will appear here after more subscription syncs.
            </div>
          ) : null}
        </div>
        <div className="at-mobile mt-4 overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--paper-strong)]">
          {archiveDigests.map((digest, index) => (
            <Link
              className="flex items-center justify-between px-3.5 py-3"
              href={`/dashboard?tab=ai-digest#${digest.id}`}
              key={digest.id}
              style={{ borderTop: index === 0 ? 0 : "1px solid var(--line)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="serif text-[15px] font-semibold leading-tight tracking-tight">
                  {digest.title}
                </div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">
                  {digest.itemCount} items
                </div>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]"
              />
            </Link>
          ))}
          {archiveDigests.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
              Historical digests will appear here after more subscription syncs.
            </div>
          ) : null}
        </div>
        {archiveCount > archivePageSize ? (
          <nav className="mt-6 flex flex-wrap gap-3" aria-label="Digest archive pagination">
            <Link
              aria-disabled={archivePage === 1}
              className={`fb-btn light compact ${
                archivePage === 1 ? "pointer-events-none opacity-45" : ""
              }`}
              href={`/dashboard?tab=ai-digest&archivePage=${Math.max(1, archivePage - 1)}#digest-archive`}
            >
              Newer
            </Link>
            <Link
              aria-disabled={visibleEnd >= archiveCount}
              className={`fb-btn light compact ${
                visibleEnd >= archiveCount ? "pointer-events-none opacity-45" : ""
              }`}
              href={`/dashboard?tab=ai-digest&archivePage=${archivePage + 1}#digest-archive`}
            >
              Older
            </Link>
          </nav>
        ) : null}
      </section>
    </section>
  );
}

async function HomeStatsSlot({ userId }: { userId: string }) {
  const [todayDigestExists, totalDigests] = await Promise.all([
    prisma.digest.findFirst({
      where: { userId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      select: { id: true },
    }),
    prisma.digest.count({ where: { userId } }),
  ]);
  const archiveCount = Math.max(0, totalDigests - (todayDigestExists ? 1 : 0));
  return (
    <div className="grid gap-2">
      <Stat
        icon={todayDigestExists ? CheckCircle2 : Clock3}
        label="AI digest"
        value={todayDigestExists ? "Synced" : "Waiting"}
      />
      <Stat icon={Sparkles} label="Subscription" value="Live" />
      <Stat icon={Sparkles} label="For You" value="Live" />
      <Stat icon={Archive} label="Archive entries" value={archiveCount} />
    </div>
  );
}

function HomeStatsSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true" aria-live="polite">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-14 animate-pulse rounded-[10px] bg-black/10" />
      ))}
    </div>
  );
}

async function RecentDigestSlot({ userId }: { userId: string }) {
  const recent = await prisma.digest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: digestSummarySelect,
  });
  // Drop today's digest from the rail recent list.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const archiveOnly = recent
    .filter((digest) => digest.createdAt < today)
    .slice(0, 4);
  if (archiveOnly.length === 0) {
    return (
      <p className="text-sm leading-6 text-[var(--muted-strong)]">
        Older digests appear here after another subscription sync.
      </p>
    );
  }
  return (
    <div className="grid gap-1">
      {archiveOnly.map((digest) => (
        <Link
          className="fb-rail-link"
          href={`/dashboard?tab=ai-digest#${digest.id}`}
          key={digest.id}
        >
          <strong>{digest.title}</strong>
          <span>
            {digest.itemCount} items · {digest.createdAt.toLocaleDateString()}
          </span>
        </Link>
      ))}
    </div>
  );
}

function RecentDigestSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((index) => (
        <div key={index} className="grid gap-1.5 border-t border-[var(--line)] pt-2 first:border-t-0 first:pt-0">
          <div className="h-3 w-32 animate-pulse rounded bg-black/10" />
          <div className="h-2.5 w-20 animate-pulse rounded bg-black/10" />
        </div>
      ))}
    </div>
  );
}

function AiDigestFeedSkeleton() {
  return (
    <section className="grid gap-5" aria-busy="true" aria-live="polite">
      <div className="mt-4 h-12 animate-pulse rounded-[10px] bg-black/10" />
      <div className="h-72 animate-pulse rounded-[12px] bg-black/10" />
      <section className="mt-8">
        <div className="flex items-center gap-3">
          <span className="fb-section-label">Digest archive</span>
          <span className="inline-block h-5 w-32 animate-pulse rounded-full bg-black/10" />
        </div>
        <div className="mt-4 grid gap-3">
          <div className="h-20 animate-pulse rounded-[10px] bg-black/10" />
          <div className="h-20 animate-pulse rounded-[10px] bg-black/10" />
          <div className="h-20 animate-pulse rounded-[10px] bg-black/10" />
        </div>
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
    <div className="fb-stat">
      <Icon className="fb-stat-icon" aria-hidden="true" />
      <div className="min-w-0">
        <div className="fb-stat-value">{value}</div>
        <div className="fb-stat-label">{label}</div>
      </div>
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | undefined) {
  if (value === "subscription" || value === "for-you") return value;
  return "ai-digest";
}

function serializeDigestSummary(digest: DigestSummaryRow) {
  return {
    ...digest,
    createdAt: digest.createdAt.toISOString(),
  };
}
