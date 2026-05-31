import Link from "next/link";
import { redirect } from "next/navigation";
import { type ComponentType } from "react";
import { Archive, CheckCircle2, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import { DigestLogPanel } from "@/components/DigestLogPanel";
import { getDigestRuns, type DigestRunListItem } from "@/lib/digest-runs";
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
  const [aiDigest, homeStats] = await Promise.all([
    AiDigestFeedSlot({ userId, archivePage }),
    HomeStatsSlot({ userId }),
  ]);

  return (
    <div className="page-pad">
      <h1 className="sr-only">Home</h1>
      <section className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <DashboardHomeTabs
            initialTab={selectedTab}
            aiDigest={aiDigest}
            forYou={<ForYouRecommendationSection scope="for-you" />}
            subscription={
              <ForYouRecommendationSection scope="subscription" />
            }
          />
        </div>
        <aside className="fb-rail at-desktop">
          <div>
            <h3>Status</h3>
            {homeStats}
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

  const [latestDigest, digestCount, rawTokens, feedPreference, digestRuns] = await Promise.all([
    // The hero shows the user's most recent non-empty digest (any age), labeled
    // with its own date. Not a "today" window: a brief stays featured until a
    // newer one replaces it, instead of vanishing at the UTC day boundary.
    prisma.digest.findFirst({
      where: { userId, itemCount: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      select: digestSummarySelect,
    }),
    prisma.digest.count({ where: { userId, itemCount: { gt: 0 } } }),
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
    prisma.userFeedPreference.findUnique({
      where: { userId },
      select: { summaryLanguage: true },
    }),
    getDigestRuns(userId),
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
  const archiveWhere = latestDigest
    ? { userId, itemCount: { gt: 0 }, NOT: { id: latestDigest.id } }
    : { userId, itemCount: { gt: 0 } };
  const archiveCount = Math.max(0, digestCount - (latestDigest ? 1 : 0));
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
      digestRuns={digestRuns}
      summaryLanguage={feedPreference?.summaryLanguage ?? null}
      latestDigest={latestDigest}
    />
  );
}

function AiDigestFeed({
  activeTokens,
  archiveCount,
  archiveDigests,
  archivePage,
  digestRuns,
  summaryLanguage,
  latestDigest,
}: {
  activeTokens: AgentTokenListItem[];
  archiveCount: number;
  archiveDigests: DigestSummaryRow[];
  archivePage: number;
  digestRuns: DigestRunListItem[];
  summaryLanguage: string | null;
  latestDigest: DigestSummaryRow | null;
}) {
  const visibleStart = archiveCount === 0 ? 0 : (archivePage - 1) * archivePageSize + 1;
  const visibleEnd = Math.min((archivePage - 1) * archivePageSize + archiveDigests.length, archiveCount);

  return (
    <section className="grid gap-5">
      <div className="mt-4">
        <SkillPromptActions
          context="digest"
          tokens={activeTokens}
          summaryLanguage={summaryLanguage}
        />
      </div>
      {latestDigest ? (
        <DigestDetails digest={serializeDigestSummary(latestDigest)} mode="today" />
      ) : (
        <div className="fb-panel dashed">
          <div className="flex items-start gap-3">
            <Terminal className="mt-1 h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
            <div>
              <h2 className="serif text-lg font-semibold text-[var(--ink)]">
                No digest yet
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                Your agent can sync a brief when there is new followed-source activity.
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
        {/* One expandable disclosure per archived digest, on every viewport.
            (The old mobile variant linked to #id anchors that lived only in the
            desktop-only block, so tapping a card on mobile opened nothing.) */}
        <div className="mt-4 grid gap-3">
          {archiveDigests.map((digest, index) => (
            <DigestDetails
              defaultOpen={index === 0}
              digest={serializeDigestSummary(digest)}
              key={digest.id}
            />
          ))}
          {archiveDigests.length === 0 ? (
            <div className="fb-panel dashed text-sm text-[var(--muted-strong)]">
              Non-empty digests will appear here after more syncs.
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
      <section id="digest-log" className="mt-8 scroll-mt-24">
        <DigestLogPanel initialRuns={digestRuns} />
      </section>
    </section>
  );
}

async function HomeStatsSlot({ userId }: { userId: string }) {
  const totalDigests = await prisma.digest.count({
    where: { userId, itemCount: { gt: 0 } },
  });
  // The latest digest is the hero; the rest are archive entries.
  const hasDigest = totalDigests > 0;
  const archiveCount = Math.max(0, totalDigests - (hasDigest ? 1 : 0));
  return (
    <div className="grid gap-2">
      <Stat
        icon={hasDigest ? CheckCircle2 : Clock3}
        label="Digest"
        value={hasDigest ? "Synced" : "Waiting"}
      />
      <Stat icon={Sparkles} label="Following" value="Live" />
      <Stat icon={Sparkles} label="For You" value="Live" />
      <Stat icon={Archive} label="Archive entries" value={archiveCount} />
    </div>
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
