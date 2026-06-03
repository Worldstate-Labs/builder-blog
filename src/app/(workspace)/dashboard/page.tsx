import Link from "next/link";
import { redirect } from "next/navigation";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import type { DigestSourceLink } from "@/components/DigestContent";
import { DigestLogPanel } from "@/components/DigestLogPanel";
import { DigestPipelineTitleEditor } from "@/components/DigestPipelineTitleEditor";
import { DigestPipelineVisibilityToggle } from "@/components/DigestPipelineVisibilityToggle";
import { EmptyState } from "@/components/EmptyState";
import { CountMeta } from "@/components/Count";
import {
  getDigestRuns,
  serializeDigestCronJob,
  type DigestCronJobStatus,
  type DigestRunListItem,
} from "@/lib/digest-runs";
import { FavoritePostsSection } from "@/components/FavoritePostsSection";
import { FollowingRecommendationSection } from "@/components/FollowingRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import { PageHeader } from "@/components/PageHeader";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { getAgentJobRuns, getScheduledAgentJobRuns, type AgentJobRunListItem } from "@/lib/agent-job-runs";
import { getCurrentSession } from "@/lib/auth";
import { displayDigestPipelineTitle } from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

const digestPickerSize = 100;
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
  digest?: string | string[];
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
  const digestId = firstParam(params.digest);
  const pipelineId = firstParam(params.pipeline);
  const aiDigest = await AiDigestFeedSlot({ userId, digestId, pipelineId });

  return (
    <div className="page-pad">
      <PageHeader title="Home" />

      <section className="home-workspace">
        <DashboardHomeTabs
          initialTab={selectedTab}
          aiDigest={aiDigest}
          favorites={<FavoritePostsSection />}
          subscription={<FollowingRecommendationSection />}
        />
      </section>
    </div>
  );
}

async function AiDigestFeedSlot({
  userId,
  digestId,
  pipelineId,
}: {
  userId: string;
  digestId?: string;
  pipelineId?: string;
}) {
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
    digestSummaries,
    digestSourceLinks,
    rawTokens,
    feedPreference,
    digestRuns,
    digestCronRuns,
    digestJobRuns,
    digestScheduledJobRuns,
    digestCronJob,
  ] = await Promise.all([
      // The digest picker lists the latest digest plus archived digests in one
      // control. Keep this as summaries only; the body is fetched on demand.
      prisma.digest.findMany({
        where: { userId: digestOwnerUserId, itemCount: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: digestPickerSize,
        select: digestSummarySelect,
      }),
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
  const latestDigest = digestSummaries[0] ?? null;
  const selectedDigest =
    digestSummaries.find((digest) => digest.id === digestId) ??
    latestDigest;

  return (
    <AiDigestFeed
      activeTokens={activeTokens}
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
      digestSummaries={digestSummaries}
      latestDigest={latestDigest}
      selectedDigest={selectedDigest}
      selectedPipeline={selectedPipeline}
    />
  );
}

function AiDigestFeed({
  activeTokens,
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
  digestSummaries,
  latestDigest,
  selectedDigest,
  selectedPipeline,
}: {
  activeTokens: AgentTokenListItem[];
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
  digestSummaries: DigestSummaryRow[];
  latestDigest: DigestSummaryRow | null;
  selectedDigest: DigestSummaryRow | null;
  selectedPipeline: DigestPipelineOption;
}) {
  const isOwnPipeline = selectedPipeline.isOwnPipeline;
  const showStopDigestCron = digestCronJob?.status === "active";

  return (
    <section className="ai-digest-stack">
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
          <section className="ai-digest-section" aria-label="Selected digest">
            {selectedDigest ? (
              <DigestDetails
                digest={serializeDigestSummary(selectedDigest)}
                headerAction={
                  digestSummaries.length > 0 ? (
                    <DigestArchiveSelector
                      digests={digestSummaries}
                      isOwnPipeline={isOwnPipeline}
                      latestDigestId={latestDigest?.id ?? null}
                      selectedDigestId={selectedDigest.id}
                      selectedPipelineId={selectedPipeline.id}
                    />
                  ) : null
                }
                isLatest={selectedDigest.id === latestDigest?.id}
                mode="today"
                sourceLinks={sourceLinks}
              />
            ) : (
              <EmptyState
                className="ai-digest-empty"
                title="No digest yet"
                body={
                  isOwnPipeline
                    ? "Your local helper can save a brief when followed sources have new activity."
                    : "This imported digest has no saved briefs yet."
                }
              />
            )}
          </section>

          {isOwnPipeline ? null : (
            <p className="sr-only">Imported digest view: read-only results.</p>
          )}
        </div>
      </section>
    </section>
  );
}

function DigestArchiveSelector({
  digests,
  isOwnPipeline,
  latestDigestId,
  selectedDigestId,
  selectedPipelineId,
}: {
  digests: DigestSummaryRow[];
  isOwnPipeline: boolean;
  latestDigestId: string | null;
  selectedDigestId: string | null;
  selectedPipelineId: string;
}) {
  const selectedDigest = digests.find((digest) => digest.id === selectedDigestId) ?? digests[0];

  return (
    <details className="digest-picker">
      <summary className="digest-picker-summary">
        <span className="sr-only">Digest history</span>
        <DigestPickerItem digest={selectedDigest} isLatest={selectedDigest.id === latestDigestId} />
      </summary>
      <div className="digest-picker-menu" role="listbox" aria-label="Digest archive">
        {digests.map((digest) => (
          <Link
            aria-current={digest.id === selectedDigest.id ? "true" : undefined}
            className="digest-picker-option"
            href={digestHref({ digestId: digest.id, isOwnPipeline, selectedPipelineId })}
            key={digest.id}
            role="option"
          >
            <DigestPickerItem digest={digest} isLatest={digest.id === latestDigestId} />
          </Link>
        ))}
      </div>
    </details>
  );
}

function DigestPickerItem({
  digest,
  isLatest,
}: {
  digest: DigestSummaryRow;
  isLatest: boolean;
}) {
  return (
    <span className="digest-picker-item">
      <span className="digest-picker-date">{formatDigestPickerDate(digest.createdAt)}</span>
      <CountMeta label={digest.itemCount === 1 ? "item" : "items"} value={digest.itemCount} />
      {isLatest ? <span className="digest-latest-mark">Latest</span> : null}
    </span>
  );
}

function digestHref({
  digestId,
  isOwnPipeline,
  selectedPipelineId,
}: {
  digestId: string;
  isOwnPipeline: boolean;
  selectedPipelineId: string;
}) {
  const params = new URLSearchParams({ tab: "ai-digest", digest: digestId });
  if (!isOwnPipeline) params.set("pipeline", selectedPipelineId);
  return `/dashboard?${params.toString()}`;
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
    <section aria-label="Digest source" className="digest-source-selector">
      <div className="digest-source-list">
        {options.map((pipeline) => {
          const active = pipeline.id === selectedPipelineId;
          const href = pipeline.isOwnPipeline
            ? "/dashboard?tab=ai-digest"
            : `/dashboard?tab=ai-digest&pipeline=${pipeline.id}`;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`digest-source-pill fb-btn compact ${active ? "dark" : "light"}`}
              href={href}
              key={pipeline.id}
            >
              <span className="digest-source-title">{pipeline.title}</span>
              <span className="sr-only">{pipeline.ownerLabel}</span>
            </Link>
          );
        })}
      </div>
    </section>
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
  if (value === "favorites") return value;
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

function formatDigestPickerDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function displayDigestTitle(title: string) {
  return title.replace(/^AI Builder Digest\b/, "AI Digest");
}
