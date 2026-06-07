import { redirect } from "next/navigation";
import Link from "next/link";
import { DigestArchivePicker, type DigestArchivePickerOption } from "@/components/DigestArchivePicker";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import type { DigestSourceLink } from "@/components/DigestContent";
import { EmptyState } from "@/components/EmptyState";
import {
  FollowingRecommendationSection,
  type FollowingSourceReadiness,
} from "@/components/FollowingRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { DigestPipelineSelector } from "@/components/DigestPipelineSelector";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { digestMaxPostAgeDays } from "@/lib/feed-preferences";
import {
  digestPipelineOwnerLabel,
  displayDigestPipelineTitle,
  displayDigestPipelineTitleForOwner,
  ensureDefaultCommunityDigestImport,
} from "@/lib/library-hub";
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
  hasContent: boolean;
  id: string;
  title: string;
  ownerLabel: string;
  ownerUserId: string;
  isOwnPipeline: boolean;
};
type OwnDigestReadiness = {
  activeTokens: AgentTokenListItem[];
  digestMaxPostAgeDays: number | null;
  fetchedPostCount: number;
  followedSourceCount: number;
  summarizedPostCount: number;
  summaryLanguage: string | null;
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
  const isAdmin = isAdminEmail(session.user.email);
  await ensureDefaultCommunityDigestImport(userId);
  const params = await searchParams;
  const requestedTab = firstParam(params.tab);
  if (requestedTab === "subscription") redirect("/dashboard?tab=following");
  if (requestedTab === "favorites") redirect("/dashboard");
  const selectedTab = parseTab(requestedTab);
  const digestId = firstParam(params.digest);
  const pipelineId = firstParam(params.pipeline);
  const sourceReadiness = await dashboardSourceReadinessForUser(userId);
  const aiDigest = await AiDigestFeedSlot({
    userId,
    digestId,
    pipelineId,
    ownDigestReadiness: sourceReadiness,
  });

  return (
    <div className="page-pad page-pad--reading home-page">
      <h1 className="sr-only">Home</h1>

      <section className="workspace-content-stack home-workspace">
        <DashboardHomeTabs
          initialTab={selectedTab}
          aiDigest={aiDigest}
          following={
            <FollowingRecommendationSection
              isAdmin={isAdmin}
              sourceReadiness={sourceReadiness}
            />
          }
        />
      </section>
    </div>
  );
}

async function AiDigestFeedSlot({
  userId,
  digestId,
  pipelineId,
  ownDigestReadiness,
}: {
  userId: string;
  digestId?: string;
  pipelineId?: string;
  ownDigestReadiness: OwnDigestReadiness;
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
      select: { title: true },
    }),
  ]);
  const digestOwnerIds = [
    userId,
    ...importedDigestPipelines.map(({ pipeline }) => pipeline.ownerUserId),
  ];
  const digestCounts = await prisma.digest.groupBy({
    by: ["userId"],
    where: {
      userId: { in: digestOwnerIds },
      itemCount: { gt: 0 },
    },
    _count: { _all: true },
  });
  const hasDigestContentByOwnerId = new Set(
    digestCounts
      .filter((row) => row._count._all > 0)
      .map((row) => row.userId),
  );
  const ownPipelineTitle = displayDigestPipelineTitle(ownPipelineShare?.title ?? "Digest");
  const digestPipelineOptions: DigestPipelineOption[] = [
    {
      hasContent: hasDigestContentByOwnerId.has(userId),
      id: "own",
      title: ownPipelineTitle,
      ownerLabel: "Own digest",
      ownerUserId: userId,
      isOwnPipeline: true,
    },
    ...importedDigestPipelines.map(({ pipeline }) => ({
      hasContent: hasDigestContentByOwnerId.has(pipeline.ownerUserId),
      id: pipeline.id,
      title: displayDigestPipelineTitleForOwner(pipeline.title, pipeline.owner),
      ownerLabel: digestPipelineOwnerLabel(pipeline.owner),
      ownerUserId: pipeline.ownerUserId,
      isOwnPipeline: false,
    })),
  ].sort(compareDigestPipelinePriority);
  const selectedPipeline =
    digestPipelineOptions.find((pipeline) => pipeline.id === pipelineId) ??
    digestPipelineOptions[0];
  const digestOwnerUserId = selectedPipeline.ownerUserId;

  const [
    digestSummaries,
    digestSourceLinks,
  ] = await Promise.all([
      // The digest picker lists the latest digest plus saved digests in one
      // control. Keep this as summaries only; the body is fetched on demand.
      prisma.digest.findMany({
        where: { userId: digestOwnerUserId, itemCount: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: digestPickerSize,
        select: digestSummarySelect,
      }),
      digestSourceLinksForUser(digestOwnerUserId),
    ]);

  const latestDigest = digestSummaries[0] ?? null;
  const selectedDigest =
    digestSummaries.find((digest) => digest.id === digestId) ??
    latestDigest;

  return (
    <AiDigestFeed
      digestPipelineOptions={digestPipelineOptions}
      sourceLinks={digestSourceLinks}
      digestSummaries={digestSummaries}
      latestDigest={latestDigest}
      selectedDigest={selectedDigest}
      selectedPipeline={selectedPipeline}
      ownDigestReadiness={ownDigestReadiness}
    />
  );
}

function compareDigestPipelinePriority(a: DigestPipelineOption, b: DigestPipelineOption) {
  if (a.hasContent !== b.hasContent) return a.hasContent ? -1 : 1;
  if (a.isOwnPipeline !== b.isOwnPipeline) return a.isOwnPipeline ? -1 : 1;
  return 0;
}

function AiDigestFeed({
  digestPipelineOptions,
  sourceLinks,
  digestSummaries,
  latestDigest,
  ownDigestReadiness,
  selectedDigest,
  selectedPipeline,
}: {
  digestPipelineOptions: DigestPipelineOption[];
  sourceLinks: DigestSourceLink[];
  digestSummaries: DigestSummaryRow[];
  latestDigest: DigestSummaryRow | null;
  ownDigestReadiness: OwnDigestReadiness;
  selectedDigest: DigestSummaryRow | null;
  selectedPipeline: DigestPipelineOption;
}) {
  const isOwnPipeline = selectedPipeline.isOwnPipeline;
  const digestArchiveOptions = digestSummaries.map(serializeDigestArchiveOption);

  return (
    <section className="ai-digest-stack">
      <DigestControlBar
        digestArchiveOptions={digestArchiveOptions}
        isOwnPipeline={isOwnPipeline}
        latestDigestId={latestDigest?.id ?? null}
        options={digestPipelineOptions}
        selectedDigestId={selectedDigest?.id ?? null}
        selectedPipeline={selectedPipeline}
        selectedPipelineId={selectedPipeline.id}
      />
      <section className="ai-digest-panel">
        <div className="ai-digest-body">
          <section className="ai-digest-section" aria-label="Selected digest">
            {selectedDigest ? (
              <DigestDetails
                digest={serializeDigestSummary(selectedDigest)}
                isLatest={selectedDigest.id === latestDigest?.id}
                mode="today"
                sourceLinks={sourceLinks}
              />
            ) : (
              <DigestEmptyState
                isOwnPipeline={isOwnPipeline}
                readiness={ownDigestReadiness}
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

function DigestEmptyState({
  isOwnPipeline,
  readiness,
}: {
  isOwnPipeline: boolean;
  readiness: OwnDigestReadiness;
}) {
  if (!isOwnPipeline) {
    return (
      <EmptyState
        className="ai-digest-empty"
        title="No AI Digest yet"
        body="This imported AI Digest has no saved briefs yet."
      />
    );
  }

  if (readiness.followedSourceCount === 0) {
    return (
      <EmptyState
        actions={
          <Link className="fb-btn dark compact" href="/builders">
            Go to Sources
          </Link>
        }
        className="ai-digest-empty is-actionable"
        title="No followed sources yet"
        body="Follow a source from the Sources page, or add a new one to start building digests."
      />
    );
  }

  if (readiness.summarizedPostCount > 0) {
    return (
      <EmptyState
        actions={
          <SkillPromptActions
            compactOnly
            context="digest"
            digestMaxPostAgeDays={readiness.digestMaxPostAgeDays}
            showStop={false}
            summaryLanguage={readiness.summaryLanguage}
            tokens={readiness.activeTokens}
          />
        }
        className="ai-digest-empty is-actionable"
        title="No AI Digest yet"
        body="Ask your Local Agent to build an AI Digest from the summarized posts in your followed sources."
      />
    );
  }

  const hasFetchedPosts = readiness.fetchedPostCount > 0;

  return (
    <EmptyState
      actions={
        <SkillPromptActions
          compactOnly
          context="library"
          digestMaxPostAgeDays={readiness.digestMaxPostAgeDays}
          showStop={false}
          summaryLanguage={readiness.summaryLanguage}
          tokens={readiness.activeTokens}
        />
      }
      className="ai-digest-empty is-actionable"
      title={hasFetchedPosts ? "No summarized posts yet" : "No fetched posts yet"}
      body={
        hasFetchedPosts
          ? "Ask your Local Agent to fetch and summarize your followed sources before building a digest."
          : "Ask your Local Agent to fetch and summarize your followed sources so there is material for an AI Digest."
      }
    />
  );
}

function DigestControlBar({
  digestArchiveOptions,
  isOwnPipeline,
  latestDigestId,
  options,
  selectedDigestId,
  selectedPipeline,
  selectedPipelineId,
}: {
  digestArchiveOptions: DigestArchivePickerOption[];
  isOwnPipeline: boolean;
  latestDigestId: string | null;
  options: DigestPipelineOption[];
  selectedDigestId: string | null;
  selectedPipeline: DigestPipelineOption;
  selectedPipelineId: string;
}) {
  return (
    <section
      aria-label="AI Digest selection"
      className="digest-control-bar"
    >
      <div className="digest-control-field">
        <span className="digest-control-label">
          AI Digest
        </span>
        <DigestPipelineSelector
          options={options}
          selectedPipeline={selectedPipeline}
          selectedPipelineId={selectedPipelineId}
        />
      </div>
      <div className="digest-control-field">
        <span className="digest-control-label">
          Saved AI Digests
        </span>
        {digestArchiveOptions.length > 0 ? (
          <div className="digest-control-picker">
            <DigestArchivePicker
              digests={digestArchiveOptions}
              isOwnPipeline={isOwnPipeline}
              latestDigestId={latestDigestId}
              selectedDigestId={selectedDigestId}
              selectedPipelineId={selectedPipelineId}
            />
          </div>
        ) : (
          <span className="digest-control-empty">
            No saved AI Digests
          </span>
        )}
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
      avatarUrl: builder.avatarUrl,
      entityId: builder.entity.id,
      fetchUrl: builder.fetchUrl,
      handle: builder.entity.handle ?? builder.handle,
      href: `/builder/${builder.entity.id}`,
      name: builder.entity.name || builder.name,
      sourceUrl: builder.sourceUrl,
      sourceType: builder.sourceType,
    });
  }
  return [...byEntityId.values()];
}

function parseTab(value: string | undefined) {
  if (value === "following") return value;
  if (value === "subscription") return "following";
  return "ai-digest";
}

function serializeDigestSummary(digest: DigestSummaryRow) {
  return {
    ...digest,
    title: displayDigestTitle(digest.title),
    createdAt: digest.createdAt.toISOString(),
  };
}

function serializeDigestArchiveOption(digest: DigestSummaryRow): DigestArchivePickerOption {
  return {
    createdAt: digest.createdAt.toISOString(),
    id: digest.id,
    itemCount: digest.itemCount,
  };
}

function displayDigestTitle(title: string) {
  return title.replace(/^AI Builder Digest\b/, "AI Digest");
}

async function dashboardSourceReadinessForUser(
  userId: string,
): Promise<OwnDigestReadiness & FollowingSourceReadiness> {
  const [
    rawTokens,
    feedPreference,
    followedSourceCount,
    fetchedPostCount,
    summarizedPostCount,
  ] = await Promise.all([
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
      select: { summaryLanguage: true, digestMaxPostAgeDays: true },
    }),
    prisma.subscription.count({ where: { userId } }),
    prisma.feedItem.count({
      where: {
        builder: { subscriptions: { some: { userId } } },
      },
    }),
    prisma.feedItem.count({
      where: {
        builder: { subscriptions: { some: { userId } } },
        summary: { not: null },
      },
    }),
  ]);

  return {
    activeTokens: serializeAgentTokens(rawTokens),
    digestMaxPostAgeDays: digestMaxPostAgeDays(feedPreference),
    fetchedPostCount,
    followedSourceCount,
    summarizedPostCount,
    summaryLanguage: feedPreference?.summaryLanguage ?? null,
  };
}

function serializeAgentTokens(
  tokens: Array<{
    id: string;
    name: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    lastIp: string | null;
    lastUserAgent: string | null;
    lastHostname: string | null;
    lastPlatform: string | null;
    lastUser: string | null;
  }>,
): AgentTokenListItem[] {
  return tokens.map((token) => ({
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
}
