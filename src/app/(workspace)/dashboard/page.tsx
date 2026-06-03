import Link from "next/link";
import { redirect } from "next/navigation";
import { type ComponentType } from "react";
import { Archive, CheckCircle2, Clock3, Sparkles, Terminal, UsersRound } from "lucide-react";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import type { DigestSourceLink } from "@/components/DigestContent";
import { DigestLogPanel } from "@/components/DigestLogPanel";
import { DigestPipelineTitleEditor } from "@/components/DigestPipelineTitleEditor";
import { DigestPipelineVisibilityToggle } from "@/components/DigestPipelineVisibilityToggle";
import {
  getDigestRuns,
  serializeDigestCronJob,
  type DigestCronJobStatus,
  type DigestRunListItem,
} from "@/lib/digest-runs";
import { FollowingRecommendationSection } from "@/components/FollowingRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { getAgentJobRuns, getScheduledAgentJobRuns, type AgentJobRunListItem } from "@/lib/agent-job-runs";
import { getCurrentSession } from "@/lib/auth";
import { displayDigestPipelineTitle } from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

const archivePageSize = 20;
const digestSummarySelect = {
  id: true,
  title: true,
  headlineSummary: true,
  itemCount: true,
  language: true,
  createdAt: true,
};
type DigestSummaryRow = Omit<DigestSummary, "createdAt"> & { createdAt: Date };
type DigestPipelineOption = {
  id: string;
  title: string;
  ownerLabel: string;
  ownerUserId: string;
  isOwnPipeline: boolean;
};

type DashboardSearchParams = Promise<{
  archivePage?: string | string[];
  pipeline?: string | string[];
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
  const pipelineId = firstParam(params.pipeline);
  const [aiDigest, homeStats] = await Promise.all([
    AiDigestFeedSlot({ userId, archivePage, pipelineId }),
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
            subscription={
              <FollowingRecommendationSection />
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
  pipelineId,
}: {
  userId: string;
  archivePage: number;
  pipelineId?: string;
}) {
  const archiveSkip = (archivePage - 1) * archivePageSize;
  const [importedDigestPipelines, ownPipelineShare] = await Promise.all([
    prisma.digestPipelineImport.findMany({
      where: { userId, pipeline: { isPublic: true } },
      include: {
        pipeline: {
          include: {
            owner: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.digestPipelineShare.findUnique({
      where: { ownerUserId: userId },
      select: { title: true, isPublic: true },
    }),
  ]);
  const ownPipelineTitle = displayDigestPipelineTitle(ownPipelineShare?.title ?? "AI Digest");
  const digestPipelineOptions: DigestPipelineOption[] = [
    {
      id: "own",
      title: ownPipelineTitle,
      ownerLabel: "Your AI Digest",
      ownerUserId: userId,
      isOwnPipeline: true,
    },
    ...importedDigestPipelines.map(({ pipeline }) => ({
      id: pipeline.id,
      title: displayDigestPipelineTitle(pipeline.title),
      ownerLabel: `Imported from ${pipeline.owner.name || pipeline.owner.email || "a FollowBrief user"}`,
      ownerUserId: pipeline.ownerUserId,
      isOwnPipeline: false,
    })),
  ];
  const selectedPipeline =
    digestPipelineOptions.find((pipeline) => pipeline.id === pipelineId) ??
    digestPipelineOptions[0];
  const digestOwnerUserId = selectedPipeline.ownerUserId;
  const isOwnPipeline = selectedPipeline.isOwnPipeline;

  const [
    latestDigest,
    digestCount,
    digestSourceLinks,
    rawTokens,
    feedPreference,
    digestRuns,
    digestCronRuns,
    digestJobRuns,
    digestScheduledJobRuns,
    digestCronJob,
  ] = await Promise.all([
      // The hero shows the user's most recent non-empty digest (any age), labeled
      // with its own date. Not a "today" window: a brief stays featured until a
      // newer one replaces it, instead of vanishing at the UTC day boundary.
      prisma.digest.findFirst({
        where: { userId: digestOwnerUserId, itemCount: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        select: digestSummarySelect,
      }),
      prisma.digest.count({ where: { userId: digestOwnerUserId, itemCount: { gt: 0 } } }),
      digestSourceLinksForUser(digestOwnerUserId),
      isOwnPipeline
        ? prisma.agentToken.findMany({
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
          })
        : Promise.resolve([]),
      isOwnPipeline
        ? prisma.userFeedPreference.findUnique({
            where: { userId },
            select: { summaryLanguage: true, digestMaxPostAgeDays: true },
          })
        : Promise.resolve(null),
      isOwnPipeline ? getDigestRuns(userId) : Promise.resolve([]),
      isOwnPipeline ? getDigestRuns(userId, 25, "cron") : Promise.resolve([]),
      isOwnPipeline ? getAgentJobRuns(userId, "digest-build", 25) : Promise.resolve([]),
      isOwnPipeline ? getScheduledAgentJobRuns(userId, "digest-cron", 25) : Promise.resolve([]),
      isOwnPipeline
        ? prisma.digestCronJob.findUnique({ where: { userId } })
        : Promise.resolve(null),
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
    ? { userId: digestOwnerUserId, itemCount: { gt: 0 }, NOT: { id: latestDigest.id } }
    : { userId: digestOwnerUserId, itemCount: { gt: 0 } };
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
      digestPipelineOptions={digestPipelineOptions}
      digestCronJob={serializeDigestCronJob(digestCronJob)}
      digestCronRuns={digestCronRuns}
      digestJobRuns={digestJobRuns}
      digestRuns={digestRuns}
      digestScheduledJobRuns={digestScheduledJobRuns}
      ownPipelineShared={ownPipelineShare?.isPublic === true}
      sourceLinks={digestSourceLinks}
      summaryLanguage={feedPreference?.summaryLanguage ?? null}
      digestMaxPostAgeDays={feedPreference?.digestMaxPostAgeDays ?? null}
      latestDigest={latestDigest}
      selectedPipeline={selectedPipeline}
    />
  );
}

function AiDigestFeed({
  activeTokens,
  archiveCount,
  archiveDigests,
  archivePage,
  digestPipelineOptions,
  digestCronJob,
  digestCronRuns,
  digestJobRuns,
  digestRuns,
  digestScheduledJobRuns,
  ownPipelineShared,
  sourceLinks,
  summaryLanguage,
  digestMaxPostAgeDays,
  latestDigest,
  selectedPipeline,
}: {
  activeTokens: AgentTokenListItem[];
  archiveCount: number;
  archiveDigests: DigestSummaryRow[];
  archivePage: number;
  digestPipelineOptions: DigestPipelineOption[];
  digestCronJob: DigestCronJobStatus | null;
  digestCronRuns: DigestRunListItem[];
  digestJobRuns: AgentJobRunListItem[];
  digestRuns: DigestRunListItem[];
  digestScheduledJobRuns: AgentJobRunListItem[];
  ownPipelineShared: boolean;
  sourceLinks: DigestSourceLink[];
  summaryLanguage: string | null;
  digestMaxPostAgeDays: number | null;
  latestDigest: DigestSummaryRow | null;
  selectedPipeline: DigestPipelineOption;
}) {
  const visibleStart = archiveCount === 0 ? 0 : (archivePage - 1) * archivePageSize + 1;
  const visibleEnd = Math.min((archivePage - 1) * archivePageSize + archiveDigests.length, archiveCount);
  const isOwnPipeline = selectedPipeline.isOwnPipeline;
  const pipelineQuery = isOwnPipeline ? "" : `&pipeline=${selectedPipeline.id}`;
  const showStopDigestCron = digestCronJob?.status === "active";

  return (
    <section className="grid gap-5">
      <DigestPipelineSelector
        options={digestPipelineOptions}
        selectedPipelineId={selectedPipeline.id}
      />
      {isOwnPipeline ? (
        <section id="digest-log" className="scroll-mt-24">
          <DigestLogPanel
            actions={
              <SkillPromptActions
                compactOnly
                context="digest"
                digestMaxPostAgeDays={digestMaxPostAgeDays}
                showStop={showStopDigestCron}
                summaryLanguage={summaryLanguage}
                tokens={activeTokens}
              />
            }
            initialCronJob={digestCronJob}
            initialCronRuns={digestCronRuns}
            initialJobRuns={digestJobRuns}
            initialRuns={digestRuns}
            initialScheduledJobRuns={digestScheduledJobRuns}
          />
        </section>
      ) : null}
      <section className="ai-digest-panel" aria-labelledby="ai-digest-heading">
        <header className="ai-digest-head">
          <div className="min-w-0">
            {isOwnPipeline ? null : <span className="fb-section-label">AI Digest</span>}
            {isOwnPipeline ? (
              <DigestPipelineTitleEditor
                headingId="ai-digest-heading"
                initialTitle={selectedPipeline.title}
              />
            ) : (
              <h2 id="ai-digest-heading" className="fb-section-heading mt-1">
                {selectedPipeline.title}
              </h2>
            )}
          </div>
          {isOwnPipeline ? (
            <DigestPipelineVisibilityToggle initialShared={ownPipelineShared} />
          ) : null}
        </header>

        <div className="ai-digest-body">
          <section className="ai-digest-section" aria-labelledby="latest-digest-heading">
            <div className="ai-digest-section-head">
              <h3 id="latest-digest-heading" className="fb-section-label m-0">
                Latest digest
              </h3>
            </div>
            {latestDigest ? (
              <DigestDetails
                digest={serializeDigestSummary(latestDigest)}
                mode="today"
                sourceLinks={sourceLinks}
              />
            ) : (
              <div className="fb-panel dashed">
                <div className="flex items-start gap-3">
                  <Terminal className="mt-1 h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
                  <div>
                    <h4 className="serif text-lg font-semibold text-[var(--ink)]">
                      No digest yet
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                      {isOwnPipeline
                        ? "Your local helper can save a brief when followed sources have new activity."
                        : "This imported digest has no saved briefs yet."}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {isOwnPipeline ? null : (
            <p className="sr-only">Imported digest view: read-only results.</p>
          )}
          <section id="digest-archive" className="ai-digest-section scroll-mt-24">
            <div className="ai-digest-section-head">
              <h3 className="fb-section-label m-0">Archived digests</h3>
              <span className="fb-chip">
                Showing {visibleStart}-{visibleEnd} of {archiveCount}
              </span>
            </div>
            {/* One expandable disclosure per archived digest, on every viewport.
                (The old mobile variant linked to #id anchors that lived only in the
                desktop-only block, so tapping a card on mobile opened nothing.) */}
            <div className="mt-4 grid gap-3">
              {archiveDigests.map((digest) => (
                <DigestDetails
                  digest={serializeDigestSummary(digest)}
                  key={digest.id}
                  sourceLinks={sourceLinks}
                />
              ))}
              {archiveDigests.length === 0 ? (
                <div className="fb-panel dashed text-sm text-[var(--muted-strong)]">
                  Non-empty digests will appear here after more updates.
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
                  href={`/dashboard?tab=ai-digest${pipelineQuery}&archivePage=${Math.max(1, archivePage - 1)}#digest-archive`}
                >
                  Newer
                </Link>
                <Link
                  aria-disabled={visibleEnd >= archiveCount}
                  className={`fb-btn light compact ${
                    visibleEnd >= archiveCount ? "pointer-events-none opacity-45" : ""
                  }`}
                  href={`/dashboard?tab=ai-digest${pipelineQuery}&archivePage=${archivePage + 1}#digest-archive`}
                >
                  Older
                </Link>
              </nav>
            ) : null}
          </section>
        </div>
      </section>
    </section>
  );
}

function DigestPipelineSelector({
  options,
  selectedPipelineId,
}: {
  options: DigestPipelineOption[];
  selectedPipelineId: string;
}) {
  if (options.length <= 1) return null;

  return (
    <section aria-label="Digest source" className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {options.map((pipeline) => {
          const active = pipeline.id === selectedPipelineId;
          const href = pipeline.isOwnPipeline
            ? "/dashboard?tab=ai-digest"
            : `/dashboard?tab=ai-digest&pipeline=${pipeline.id}`;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`fb-btn compact ${active ? "dark" : "light"}`}
              href={href}
              key={pipeline.id}
            >
              <span className="truncate">{pipeline.title}</span>
              <span className="sr-only">{pipeline.ownerLabel}</span>
            </Link>
          );
        })}
      </div>
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
        value={hasDigest ? "Updated" : "Waiting"}
      />
      <Stat icon={Sparkles} label="Following" value="Active" />
      <Stat icon={Archive} label="Saved briefs" value={archiveCount} />
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

async function digestSourceLinksForUser(userId: string): Promise<DigestSourceLink[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    include: {
      builder: {
        include: {
          entity: {
            select: {
              handle: true,
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const byEntityId = new Map<string, DigestSourceLink>();
  for (const subscription of subscriptions) {
    const builder = subscription.builder;
    if (!builder?.entity || byEntityId.has(builder.entity.id)) continue;
    byEntityId.set(builder.entity.id, {
      aliases: [builder.name],
      entityId: builder.entity.id,
      fetchUrl: builder.fetchUrl,
      handle: builder.entity.handle ?? builder.handle,
      href: `/builder/${builder.entity.id}`,
      name: builder.entity.name || builder.name,
      sourceUrl: builder.sourceUrl,
    });
  }
  return [...byEntityId.values()];
}

function parseTab(value: string | undefined) {
  if (value === "subscription") return value;
  return "ai-digest";
}

function serializeDigestSummary(digest: DigestSummaryRow) {
  return {
    ...digest,
    title: displayDigestTitle(digest.title),
    createdAt: digest.createdAt.toISOString(),
  };
}

function displayDigestTitle(title: string) {
  return title.replace(/^AI Builder Digest\b/, "AI Digest");
}
