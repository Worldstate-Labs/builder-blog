import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { Archive, CheckCircle2, ChevronRight, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import { ForYouRecommendationSection } from "@/components/ForYouRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { SkillPromptActions } from "@/components/SkillPromptActions";
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
  const selectedTab = parseTab(firstParam(params.tab));
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
      <section className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <DashboardHomeTabs
            initialTab={selectedTab}
            aiDijest={
              <AiDijestFeed
                archiveCount={archiveCount}
                archiveDigests={archiveDigests}
                archivePage={archivePage}
                todayDigest={todayDigest}
              />
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
            <div className="grid gap-2">
              <Stat
                icon={todayDigest ? CheckCircle2 : Clock3}
                label="AI dijest"
                value={todayDigest ? "Synced" : "Waiting"}
              />
              <Stat icon={Sparkles} label="For You" value="Live" />
              <Stat icon={Sparkles} label="Subscription" value="Live" />
              <Stat icon={Archive} label="Archive entries" value={archiveCount} />
            </div>
          </div>
          <div>
            <h3>Recent dijest</h3>
            <div className="grid gap-1">
              {recentArchiveDigests.map((digest) => (
                <Link
                  className="fb-rail-link"
                  href={`/dashboard?tab=ai-dijest#${digest.id}`}
                  key={digest.id}
                >
                  <strong>{digest.title}</strong>
                  <span>
                    {digest.itemCount} items · {digest.createdAt.toLocaleDateString()}
                  </span>
                </Link>
              ))}
              {recentArchiveDigests.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--muted-strong)]">
                  Older digests appear here after another subscription sync.
                </p>
              ) : null}
            </div>
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

function AiDijestFeed({
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
    <section className="grid gap-5">
      <div className="mt-4">
        <SkillPromptActions context="digest" />
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
              href={`/dashboard?tab=ai-dijest#${digest.id}`}
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
              href={`/dashboard?tab=ai-dijest&archivePage=${Math.max(1, archivePage - 1)}#digest-archive`}
            >
              Newer
            </Link>
            <Link
              aria-disabled={visibleEnd >= archiveCount}
              className={`fb-btn light compact ${
                visibleEnd >= archiveCount ? "pointer-events-none opacity-45" : ""
              }`}
              href={`/dashboard?tab=ai-dijest&archivePage=${archivePage + 1}#digest-archive`}
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
  return "ai-dijest";
}

function serializeDigestSummary(digest: DigestSummaryRow) {
  return {
    ...digest,
    createdAt: digest.createdAt.toISOString(),
  };
}
