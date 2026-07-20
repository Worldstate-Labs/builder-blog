import { BuilderKind, BuilderPoolOrigin } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BuilderLibraryList, type BuilderLibraryListItem } from "@/components/BuilderLibraryList";
import { CountMeta, formatCount } from "@/components/Count";
import { type OwnDigestPipeline } from "@/components/DigestPipelineImportForm";
import { EmptyState } from "@/components/EmptyState";
import { FollowBriefLibraryIdentity } from "@/components/FollowBriefLibraryIdentity";
import {
  type LibraryCronJobStatus,
  type LibraryFetchRunListItem,
} from "@/components/FetchLogPanel";
import { LibraryImportRemoveButton } from "@/components/LibraryImportRemoveButton";
import { LibraryVisibilityToggle } from "@/components/LibraryVisibilityToggle";
import { OwnDigestPipelineUpdatesCard } from "@/components/OwnDigestPipelineUpdatesCard";
import { I18nText } from "@/components/I18nProvider";
import { PageHeader } from "@/components/PageHeader";
import { PrivateLibraryPanel } from "@/components/PrivateLibraryPanel";
import {
  SkillPromptActions,
  type CloudSubmissionSource,
} from "@/components/SkillPromptActions";
import { SourceLibraryItemsArea } from "@/components/SourceLibraryItemsArea";
import { SourceLibraryMetadata as SourceLibraryMetadataRow } from "@/components/SourceLibraryMetadata";
import { SourceAvatar } from "@/components/SourceAvatar";
import { SourcesTabShell } from "@/components/SourcesTabShell";
import { SourceSyncLogTabs } from "@/components/SourceSyncLogTabs";
import type { WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { adminEmails, isAdminEmail } from "@/lib/admin";
import {
  ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS,
  isAdminFetchOnlySourceType,
} from "@/lib/admin-fetch-only-sources";
import {
  getAgentJobRuns,
  getScheduledAgentJobRuns,
  loadFetchRunHistoryAgentJobs,
  type AgentJobRunListItem,
} from "@/lib/agent-job-runs";
import { getCurrentSession } from "@/lib/auth";
import {
  emptyDigestPipelineMetadata,
  getDigestPipelineMetadataByOwnerIds,
} from "@/lib/digest-pipeline-metadata";
import { getDigestRuns, serializeDigestCronJob } from "@/lib/digest-runs";
import { digestMaxPostAgeDays } from "@/lib/feed-preferences";
import {
  adminCommunityLibraryDescription,
  adminCommunityLibraryName,
  ensureAdminCommunityLibrary,
  personalSourceLibraryName,
  sharePersonalLibraryToHub,
  userImportableLibraryHubEntryWhere,
} from "@/lib/library-hub";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import { ensureSourceCandidateLibraryFromAdminSources } from "@/lib/source-candidate-library";
import {
  getSourceLibraryMetadataByOwnerIds,
  type SourceLibraryMetadata as SourceLibraryMetadataValue,
} from "@/lib/source-library-metadata";
import { getMergedSourceDefinitions } from "@/lib/source-registry";
import { loadUserCloudFetchLog } from "@/lib/user-cloud-fetch-log-data";

type BuilderWithCount = {
  id: string;
  ownerUserId: string | null;
  entityId: string | null;
  kind: BuilderKind;
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  canonicalKey: string;
  createdAt: Date;
  _count: { feedItems: number };
};

type LatestPostCreatedAtByBuilderId = Map<string, Date | null>;
type SharedAdminPostStatsByEntityId = Map<
  string,
  { count: number; latestPostCreatedAt: Date | null }
>;
type FetchTabData = Awaited<ReturnType<typeof startFetchTabData>>;
type FetchSyncData = Awaited<ReturnType<typeof loadFetchSyncData>>;
type SourceLibraryData = Awaited<ReturnType<typeof loadSourceLibraryData>>;
type DigestSourcesPageData = Awaited<ReturnType<typeof loadDigestSourcesPageData>>;
type SourcesTab = "fetch" | "digest";

type BuildersSearchParams = Promise<{
  tab?: string | string[];
}>;

const SOURCES_TABS: Array<WorkspaceTopTabItem<SourcesTab>> = [
  {
    value: "fetch",
    label: <I18nText id="tabs.sources" />,
    href: "/builders?tab=fetch",
    panelId: "sources-panel-fetch",
    tabId: "sources-tab-fetch",
  },
  {
    value: "digest",
    label: <I18nText id="tabs.aiDigest" />,
    href: "/builders?tab=digest",
    panelId: "sources-panel-digest",
    tabId: "sources-tab-digest",
  },
];
const FETCH_RUN_PAGE_SIZE = 10;
const FETCH_RUN_QUERY_SIZE = FETCH_RUN_PAGE_SIZE + 1;

export default async function BuildersPage({
  searchParams,
}: {
  searchParams: BuildersSearchParams;
}) {
  const params = await searchParams;
  const selectedTab = parseSourcesTab(firstParam(params.tab));
  const selectedTabItem = selectedSourcesTabItem(selectedTab);
  const fetchDataPromise =
    selectedTab === "fetch" ? startFetchTabData() : null;
  const digestDataPromise =
    selectedTab === "digest" ? loadDigestSourcesPageData() : null;

  return (
    <div className="page-pad">
      <PageHeader
        title={<I18nText id="workspace.sources" />}
        description={<I18nText id="workspace.sourcesDesc" />}
      />
      <div className="workspace-content-stack workspace-content-stack--tabs-first">
        <section className="sources-tab-surface">
          <SourcesTabShell
            ariaLabel="Sources and AI Brief tabs"
            digestFallback={<DigestSourcesFallback />}
            fetchFallback={<FetchSourcesFallback />}
            items={SOURCES_TABS}
            key={selectedTab}
            selectedTab={selectedTab}
          >
            {selectedTab === "fetch" ? (
              <section
                aria-labelledby={selectedTabItem.tabId}
                className="sources-tab-body sources-tab-body--fetch"
                id={selectedTabItem.panelId}
                role="tabpanel"
              >
                <Suspense fallback={<FetchSourcesFallback />}>
                  <FetchSourcesSection dataPromise={fetchDataPromise!} />
                </Suspense>
              </section>
            ) : (
              <section
                aria-labelledby={selectedTabItem.tabId}
                className="sources-tab-body sources-tab-body--digest"
                id={selectedTabItem.panelId}
                role="tabpanel"
              >
                <Suspense fallback={<DigestSourcesFallback />}>
                  <DigestSourcesSection dataPromise={digestDataPromise!} />
                </Suspense>
              </section>
            )}
          </SourcesTabShell>
        </section>
      </div>
    </div>
  );
}

async function DigestSourcesSection({
  dataPromise,
}: {
  dataPromise: Promise<DigestSourcesPageData>;
}) {
  const data = await dataPromise;
  const showStopDigestCron = data.digestCronJob?.status === "active";

  return (
    <section className="digest-source-management digest-brief-list">
      <OwnDigestPipelineUpdatesCard
        actions={
          <SkillPromptActions
            activeSchedule={data.digestCronJob}
            compactOnly
            context="digest"
            digestMaxPostAgeDays={data.digestMaxPostAgeDays}
            showStop={showStopDigestCron}
            summaryLanguage={data.summaryLanguage}
            tokens={data.activeTokens}
          />
        }
        initialCronJob={data.digestCronJob}
        initialCronRuns={data.digestCronRuns}
        initialJobRuns={data.digestJobRuns}
        initialRuns={data.digestRuns}
        initialScheduledJobRuns={data.digestScheduledJobRuns}
        pipeline={data.ownDigestPipeline}
      />
    </section>
  );
}

function DigestSourcesFallback() {
  return (
    <section
      className="digest-source-management digest-brief-list"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading AI Brief controls</span>
      <article className="own-digest-card" aria-label="Loading AI Brief controls">
        <div className="source-sync-skeleton-line is-title" />
        <div className="source-sync-skeleton-panel" />
      </article>
    </section>
  );
}

async function loadDigestSourcesPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const [
    rawTokens,
    feedPreference,
    rawDigestRuns,
    rawDigestCronRuns,
    digestJobRuns,
    digestScheduledJobRuns,
    rawDigestCronJob,
  ] = await Promise.all([
    prisma.agentToken.findMany({
      where: { userId: session.user.id, revokedAt: null },
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
      where: { userId: session.user.id },
      select: { summaryLanguage: true, digestMaxPostAgeDays: true },
    }),
    getDigestRuns(session.user.id),
    getDigestRuns(session.user.id, 25, "cron"),
    getAgentJobRuns(session.user.id, "digest-build", 25),
    getScheduledAgentJobRuns(session.user.id, "digest-cron", 25),
    prisma.digestCronJob.findUnique({
      where: { userId: session.user.id },
    }),
  ]);

  const digestMetadataByOwnerId = await getDigestPipelineMetadataByOwnerIds(
    [session.user.id],
  );
  const ownDigestMetadata =
    digestMetadataByOwnerId.get(session.user.id) ?? emptyDigestPipelineMetadata();
  const ownDigestPipeline: OwnDigestPipeline = {
    title: "Your AI Brief",
    ...ownDigestMetadata,
  };
  return {
    activeTokens: serializeAgentTokens(rawTokens),
    digestCronJob: serializeDigestCronJob(rawDigestCronJob),
    digestCronRuns: rawDigestCronRuns,
    digestJobRuns,
    digestRuns: rawDigestRuns,
    digestScheduledJobRuns,
    ownDigestPipeline,
    summaryLanguage: feedPreference?.summaryLanguage ?? null,
    digestMaxPostAgeDays: digestMaxPostAgeDays(feedPreference),
  };
}

async function startFetchTabData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = isAdminEmail(session.user.email);
  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    isAdmin,
  };

  return {
    syncDataPromise: loadFetchSyncData(user),
    libraryDataPromise: loadSourceLibraryData(user),
  };
}

async function loadSourceLibraryData(user: {
  id: string;
  email: string | null | undefined;
  name: string | null | undefined;
  isAdmin: boolean;
}) {
  await ensureDefaultCommunityLibraryImport(user.id);
  const [
    poolEntries,
    subscriptions,
    importedLibraries,
    ownSharedLibrary,
    adminLibVisibility,
  ] = await Promise.all([
    prisma.builderPoolEntry.findMany({
      where: { userId: user.id, removedAt: null },
      include: {
        builder: {
          include: {
            _count: { select: { feedItems: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.subscription.findMany({
      where: { userId: user.id },
      select: { builderId: true },
    }),
    prisma.libraryImport.findMany({
      where: {
        userId: user.id,
        hubEntry: userImportableLibraryHubEntryWhere(),
      },
      include: {
        hubEntry: {
          include: {
            owner: { select: { name: true, email: true } },
            items: {
              select: { builderId: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.libraryHubEntry.findFirst({
      where: { ownerUserId: user.id },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { items: true } },
      },
    }),
    // Used to determine if the featured community library has been hidden by this user.
    (async () => {
      const featuredLib = await prisma.libraryHubEntry.findFirst({
        where: { isFeatured: true },
        select: { id: true },
      });
      if (!featuredLib) return null;
      const vis = await prisma.userLibraryVisibility.findUnique({
        where: { userId_hubEntryId: { userId: user.id, hubEntryId: featuredLib.id } },
        select: { hidden: true },
      });
      return { hidden: Boolean(vis?.hidden) };
    })(),
  ]);

  const subscribedBuilderIds = new Set(subscriptions.map((s) => s.builderId));
  const subscribed = {
    has(builderId: string) {
      return subscribedBuilderIds.has(builderId);
    },
  };
  const activeEntryByBuilderId = new Map(poolEntries.map((entry) => [entry.builderId, entry]));
  const poolBuilders = poolEntries.map((entry) => entry.builder).sort(builderSort);
  const poolBuilderIds = poolBuilders.map((builder) => builder.id);
  const privateBuilders = poolEntries
    .filter(
      (entry) =>
        entry.origin === BuilderPoolOrigin.PERSONAL_SYNC &&
        entry.builder.ownerUserId === user.id,
    )
    .map((entry) => entry.builder)
    .sort(builderSort);
  const importedLibraryOwnerUserIds = importedLibraries
    .map((libraryImport) => libraryImport.hubEntry.ownerUserId ?? "")
    .filter(Boolean);
  const importedLibraryMetadataByOwnerUserId = await getSourceLibraryMetadataByOwnerIds(importedLibraryOwnerUserIds);
  const importedLibrarySections = importedLibraries.map((libraryImport) => {
    const isCommunityLibrary =
      libraryImport.hubEntry.isFeatured ||
      isAdminEmail(libraryImport.hubEntry.owner?.email);
    return {
      id: libraryImport.hubEntryId,
      isFollowBrief: isCommunityLibrary,
      name: isCommunityLibrary ? adminCommunityLibraryName : libraryImport.hubEntry.name,
      description: libraryImport.hubEntry.description,
      ownerName: isCommunityLibrary
        ? "FollowBrief"
        : libraryImport.hubEntry.owner?.name ||
          libraryImport.hubEntry.owner?.email ||
          "FollowBrief",
      metadata: libraryImport.hubEntry.ownerUserId
        ? importedLibraryMetadataByOwnerUserId[libraryImport.hubEntry.ownerUserId] ?? null
        : null,
      builders: libraryImport.hubEntry.items
        .flatMap((item) => {
          const entry = activeEntryByBuilderId.get(item.builderId);
          return entry ? [entry.builder] : [];
        })
        .sort(builderSort),
    };
  });
  const isAdminCommunityLibraryHidden = Boolean(adminLibVisibility?.hidden);
  let isPublicLibrary = user.isAdmin ? !isAdminCommunityLibraryHidden : Boolean(ownSharedLibrary);
  if (
    user.isAdmin &&
    !isAdminCommunityLibraryHidden &&
    (!ownSharedLibrary ||
      ownSharedLibrary.name !== adminCommunityLibraryName ||
      ownSharedLibrary.description !== adminCommunityLibraryDescription ||
      ownSharedLibrary._count.items !== privateBuilders.length)
  ) {
    const result = await ensureAdminCommunityLibrary(user.id, user.email);
    isPublicLibrary = result.isPublic;
  } else if (
    !user.isAdmin &&
    ownSharedLibrary &&
    ownSharedLibrary._count.items !== privateBuilders.length
  ) {
    await sharePersonalLibraryToHub({
      userId: user.id,
      name: ownSharedLibrary.name,
      description: ownSharedLibrary.description,
    });
  }
  const [
    latestPostCreatedAtByBuilderId,
    sharedAdminPostStatsByEntityId,
    mergedSourceDefinitions,
    sourceCandidates,
  ] = await Promise.all([
    latestPostCreationTimes(poolBuilderIds),
    sharedAdminPostStatsForBuilders(poolBuilders),
    getMergedSourceDefinitions(),
    ensureSourceCandidateLibraryFromAdminSources(),
  ]);
  const sourceLabelOptions = sourceOptionsForForms(mergedSourceDefinitions);
  return {
    importedLibrarySections,
    isAdmin: user.isAdmin,
    isPublicLibrary,
    latestPostCreatedAtByBuilderId,
    sharedAdminPostStatsByEntityId,
    privateBuilders,
    sessionUserEmail: user.email,
    sessionUserName: user.name,
    sourceLabelOptions,
    sourceCandidates,
    subscribed,
  };
}

async function loadFetchSyncData(user: {
  id: string;
  isAdmin: boolean;
}) {
  const [
    rawTokens,
    rawFetchRuns,
    rawCronRuns,
    rawLibraryCronJob,
    feedPreference,
    rawCloudSubmissionSources,
    cloudFetchLog,
  ] = await Promise.all([
    prisma.agentToken.findMany({
      where: { userId: user.id, revokedAt: null },
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
    prisma.libraryFetchRun.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: FETCH_RUN_QUERY_SIZE,
    }),
    prisma.libraryFetchRun.findMany({
      where: { userId: user.id, source: "cron" },
      orderBy: { startedAt: "desc" },
      take: FETCH_RUN_QUERY_SIZE,
    }),
    prisma.libraryCronJob.findUnique({
      where: { userId: user.id },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId: user.id },
      select: { summaryLanguage: true, digestMaxPostAgeDays: true },
    }),
    prisma.builderPoolEntry.findMany({
      where: {
        userId: user.id,
        origin: BuilderPoolOrigin.PERSONAL_SYNC,
        removedAt: null,
        builder: { ownerUserId: user.id },
      },
      orderBy: { createdAt: "asc" },
      select: {
        builder: {
          select: {
            id: true,
            name: true,
            handle: true,
            sourceType: true,
            sourceUrl: true,
            fetchUrl: true,
            avatarUrl: true,
            avatarDataUrl: true,
          },
        },
      },
    }),
    loadUserCloudFetchLog(user.id),
  ]);
  const {
    jobRuns,
    scheduledJobRuns,
    hasMore: hasMoreFetchHistory,
  } = await loadFetchRunHistoryAgentJobs({
    userId: user.id,
    rows: rawFetchRuns,
    cronRows: rawCronRuns,
    before: null,
    pageSize: FETCH_RUN_PAGE_SIZE,
    querySize: FETCH_RUN_QUERY_SIZE,
  });
  const activeTokens = serializeAgentTokens(rawTokens);
  const cloudSubmissionSources: CloudSubmissionSource[] = rawCloudSubmissionSources.map(
    ({ builder }) => ({
      id: builder.id,
      name: builder.name,
      handle: builder.handle,
      sourceType: builder.sourceType,
      sourceUrl: builder.sourceUrl,
      fetchUrl: builder.fetchUrl,
      avatarUrl: builder.avatarUrl,
      avatarDataUrl: builder.avatarDataUrl,
    }),
  );
  const fetchRuns: LibraryFetchRunListItem[] = rawFetchRuns.slice(0, FETCH_RUN_PAGE_SIZE).map((run) => ({
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    durationMs: run.durationMs,
    status: run.status,
    source: run.source,
    jobRunId: run.jobRunId,
    cliVersion: run.cliVersion,
    hostname: run.hostname,
    platform: run.platform,
    buildersAttempted: run.buildersAttempted,
    itemsFetched: run.itemsFetched,
    tasksGenerated: run.tasksGenerated,
    userActionsCount: run.userActionsCount,
    errorCount: run.errorCount,
    summary: run.summary,
    details: run.details,
  }));
  const cronRuns: LibraryFetchRunListItem[] = rawCronRuns.slice(0, FETCH_RUN_PAGE_SIZE).map((run) => ({
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    durationMs: run.durationMs,
    status: run.status,
    source: run.source,
    jobRunId: run.jobRunId,
    cliVersion: run.cliVersion,
    hostname: run.hostname,
    platform: run.platform,
    buildersAttempted: run.buildersAttempted,
    itemsFetched: run.itemsFetched,
    tasksGenerated: run.tasksGenerated,
    userActionsCount: run.userActionsCount,
    errorCount: run.errorCount,
    summary: run.summary,
    details: run.details,
  }));
  const libraryCronJob: LibraryCronJobStatus | null = rawLibraryCronJob
    ? {
        id: rawLibraryCronJob.id,
        status: rawLibraryCronJob.status,
        startedAt: rawLibraryCronJob.startedAt.toISOString(),
        stoppedAt: rawLibraryCronJob.stoppedAt?.toISOString() ?? null,
        frequencyKey: rawLibraryCronJob.frequencyKey,
        frequencyLabel: rawLibraryCronJob.frequencyLabel,
        schedule: rawLibraryCronJob.schedule,
        intervalMinutes: rawLibraryCronJob.intervalMinutes,
        runtime: rawLibraryCronJob.runtime,
        overrideFetched: rawLibraryCronJob.overrideFetched,
        hostname: rawLibraryCronJob.hostname,
        platform: rawLibraryCronJob.platform,
        updatedAt: rawLibraryCronJob.updatedAt.toISOString(),
      }
    : null;

  return {
    activeTokens,
    cronRuns,
    fetchRuns,
    hasMoreFetchHistory,
    jobRuns,
    libraryCronJob,
    scheduledJobRuns,
    isAdmin: user.isAdmin,
    summaryLanguage: feedPreference?.summaryLanguage ?? null,
    digestMaxPostAgeDays: digestMaxPostAgeDays(feedPreference),
    cloudSubmissionSources,
    cloudFetchLog,
    userId: user.id,
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

function occurredAfter(value: string | null | undefined, afterMs: number): boolean {
  if (!value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= afterMs;
}

function hasStoppedLocalScheduleActivity(
  cronJob: LibraryCronJobStatus | null,
  cronRuns: LibraryFetchRunListItem[],
  scheduledJobRuns: AgentJobRunListItem[],
): boolean {
  if (!cronJob || cronJob.status === "active") return false;
  const stoppedAtMs = Date.parse(cronJob.stoppedAt ?? cronJob.updatedAt);
  if (!Number.isFinite(stoppedAtMs)) return false;

  return (
    cronRuns.some((run) => occurredAfter(run.startedAt, stoppedAtMs)) ||
    scheduledJobRuns.some((jobRun) => occurredAfter(jobRun.startedAt, stoppedAtMs))
  );
}

function sourceOptionsForForms(
  sources: Array<{ id: string; label: string }>,
) {
  return [...sources]
    .sort(
      (a, b) =>
        sourceFormOrderRank(a.id) - sourceFormOrderRank(b.id) ||
        formSourceTypeLabel(a).localeCompare(formSourceTypeLabel(b)),
    )
    .map((source) => ({
      id: source.id,
      label: formSourceTypeLabel(source),
    }));
}

function sourceFormOrderRank(sourceId: string) {
  const order = [
    "podcast",
    "blog",
    "youtube",
    "x",
    "github_trending",
    "product_hunt_top_products",
    "website",
  ];
  const index = order.indexOf(sourceId);
  return index >= 0 ? index : order.length;
}

function formSourceTypeLabel(source: { id: string; label: string }) {
  if (source.id === "blog") return "Blog / Article Feed";
  if (source.id === "podcast") return "Podcast / Audio Feed";
  return source.label;
}

async function FetchSourcesSection({
  dataPromise,
}: {
  dataPromise: Promise<FetchTabData>;
}) {
  const data = await dataPromise;
  return (
    <section className="sources-section-stack">
      <Suspense fallback={<FetchSyncFallback />}>
        <FetchSyncSection dataPromise={data.syncDataPromise} />
      </Suspense>
      <Suspense fallback={<FetchLibraryFallback />}>
        <SourceLibrarySections dataPromise={data.libraryDataPromise} />
      </Suspense>
    </section>
  );
}

async function FetchSyncSection({
  dataPromise,
}: {
  dataPromise: Promise<FetchSyncData>;
}) {
  const data = await dataPromise;
  const showStopLibraryCron =
    data.libraryCronJob?.status === "active" ||
    hasStoppedLocalScheduleActivity(data.libraryCronJob, data.cronRuns, data.scheduledJobRuns);
  const showStopCloudFetch = data.cloudFetchLog.submittedSourceCount > 0;
  const showStopFetching = showStopLibraryCron || showStopCloudFetch;

  return (
    <section
      className="sources-sync-section sources-sync-panel library-section-panel"
      aria-labelledby="source-syncing-section-title"
    >
      <div className="library-section-summary library-section-summary--static">
        <div className="library-section-summary-copy">
          <h2 id="source-syncing-section-title" className="fb-section-heading">
            Source syncing
          </h2>
          <p className="library-section-copy">
            Choose FollowBrief or your own agent to fetch and summarize sources.
          </p>
        </div>
        <SkillPromptActions
          activeSchedule={data.libraryCronJob}
          cloudSubmissionSources={data.cloudSubmissionSources}
          cloudFetchActive={showStopCloudFetch}
          compactOnly
          context="library"
          localFetchActive={showStopLibraryCron}
          showStop={showStopFetching}
          tokens={data.activeTokens}
          summaryLanguage={data.summaryLanguage}
          digestMaxPostAgeDays={data.digestMaxPostAgeDays}
        />
      </div>
      <div className="library-section-body">
        <SourceSyncLogTabs
          cloudLog={data.cloudFetchLog}
          initialCronJob={data.libraryCronJob}
          initialCronRuns={data.cronRuns}
          initialJobRuns={data.jobRuns}
          initialHasMoreHistory={data.hasMoreFetchHistory}
          initialScheduledJobRuns={data.scheduledJobRuns}
          initialRuns={data.fetchRuns}
          summaryLanguage={data.summaryLanguage}
          userId={data.userId}
        />
      </div>
    </section>
  );
}

async function SourceLibrarySections({
  dataPromise,
}: {
  dataPromise: Promise<SourceLibraryData>;
}) {
  const data = await dataPromise;
  const userLibraryName =
    data.isAdmin
      ? adminCommunityLibraryName
      : personalSourceLibraryName({
          name: data.sessionUserName,
          email: data.sessionUserEmail,
        });

  const privateSection = (
    <section className="your-library-section" aria-labelledby="sources-library-section-title">
      <PrivateLibraryPanel
        className="your-library-panel library-section-panel"
        description="You can customize when and how to fetch and summarize sources in your library"
        headingId="sources-library-section-title"
        sourceCandidates={data.sourceCandidates}
        sourceOptions={data.sourceLabelOptions}
        title="Your source library"
        visibilityToggle={
          <LibraryVisibilityToggle
            compact
            disabled={!data.isAdmin && data.privateBuilders.length === 0}
            initialIsPublic={data.isPublicLibrary}
            isAdminLibrary={data.isAdmin}
            name={userLibraryName}
          />
        }
      >
        <BuilderLibraryList
          acceptAddedBuilders
          builders={data.privateBuilders.map((builder) =>
            builderListItem({
              allowRemove: true,
              builder,
              latestPostCreatedAt: data.latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
              sharedAdminPostStatsByEntityId: data.sharedAdminPostStatsByEntityId,
              subscribed: data.subscribed.has(builder.id),
            }),
          )}
          editableSourceOptions={data.sourceLabelOptions}
          editableSourceCandidates={data.sourceCandidates}
          emptyBody="Add sources, then copy a Fetch sources prompt."
          emptyTitle="No sources yet"
        />
      </PrivateLibraryPanel>
    </section>
  );

  const importedSection = (
    <section className="imported-libraries-section imported-libraries-panel library-section-panel">
      <div className="imported-libraries-head">
        <div className="imported-libraries-copy">
          <h2 className="fb-section-heading">Imported source libraries</h2>
          <p className="library-section-copy">
            {"Source libraries imported from Hub."}
          </p>
        </div>
        {data.importedLibrarySections.length > 0 ? (
          <Link className="fb-btn light compact" href="/library-hub?tab=source-library">
            Import from Hub
          </Link>
        ) : null}
      </div>
      <div className="imported-library-stack">
        {data.importedLibrarySections.map((library) => (
          <LibrarySection
            key={library.id}
            title={
              library.isFollowBrief ? (
                <FollowBriefLibraryIdentity />
              ) : (
                library.name
              )
            }
            detail={<ImportedLibraryCollapsedMeta builders={library.builders} />}
            count={library.builders.length}
            showCount={false}
            indented
            importedMetadata={library.metadata}
            summaryClassName="library-section-panel-imported"
            action={
              <LibraryImportRemoveButton
                libraryId={library.id}
                libraryName={library.name}
              />
            }
          >
            <BuilderLibraryList
              builders={library.builders.map((builder) =>
                builderListItem({
                  allowRemove: false,
                  builder,
                  latestPostCreatedAt: data.latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
                  sharedAdminPostStatsByEntityId: data.sharedAdminPostStatsByEntityId,
                  subscribed: data.subscribed.has(builder.id),
                }),
              )}
              emptyBody="This imported source library has no active sources."
              emptyTitle="No active sources"
            />
          </LibrarySection>
        ))}
        {data.importedLibrarySections.length === 0 ? (
          <EmptyState
            actions={
              <Link className="fb-btn light compact" href="/library-hub?tab=source-library">
                Import from Hub
              </Link>
            }
            body="Import source libraries from Hub."
            title="No imported source libraries"
          />
        ) : null}
      </div>
    </section>
  );

  return (
    <>
      {privateSection}
      {importedSection}
    </>
  );
}

function FetchSourcesFallback() {
  return (
    <section className="sources-section-stack" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading Sources</span>
      <FetchSyncFallback />
      <FetchLibraryFallback />
    </section>
  );
}

function FetchSyncFallback() {
  return (
    <section className="sources-sync-section sources-sync-panel library-section-panel">
      <div className="library-section-summary library-section-summary--static">
        <div className="library-section-summary-copy source-section-skeleton-copy">
          <h2 className="fb-section-heading">Source syncing</h2>
          <div className="source-section-skeleton-desc" />
        </div>
      </div>
      <div className="library-section-body">
        <div className="source-sync-skeleton-panel" />
      </div>
    </section>
  );
}

function FetchLibraryFallback() {
  return (
    <section className="your-library-panel library-section-panel" aria-busy="true">
      <div className="source-sync-skeleton-line" />
      <div className="source-sync-skeleton-panel" />
      <div className="library-section-panel">
        <div className="library-section-summary">
          <div className="library-section-summary-copy source-section-skeleton-copy">
            <div className="source-section-skeleton-title" />
            <div className="source-section-skeleton-desc" />
          </div>
          <div className="library-section-meta">
            <div className="source-section-skeleton-chip source-section-skeleton-chip--short" />
            <div className="source-section-skeleton-chip" />
          </div>
        </div>
        <div className="library-section-body">
          <div className="source-section-skeleton-row" />
          <div className="source-section-skeleton-card" />
        </div>
      </div>
    </section>
  );
}

function builderListItem({
  allowRemove,
  builder,
  latestPostCreatedAt,
  sharedAdminPostStatsByEntityId,
  subscribed,
}: {
  allowRemove: boolean;
  builder: BuilderWithCount;
  latestPostCreatedAt: Date | null;
  sharedAdminPostStatsByEntityId: SharedAdminPostStatsByEntityId;
  subscribed: boolean;
}): BuilderLibraryListItem {
  const sharedStats = sharedAdminPostStatsForBuilder(
    builder,
    sharedAdminPostStatsByEntityId,
  );
  return {
    id: builder.id,
    entityId: builder.entityId,
    kind: builder.kind,
    sourceType: builder.sourceType,
    name: builder.name,
    handle: builder.handle,
    sourceUrl: builder.sourceUrl,
    fetchUrl: builder.fetchUrl,
    avatarUrl: builder.avatarUrl ?? null,
    avatarDataUrl: builder.avatarDataUrl ?? null,
    createdAt: builder.createdAt.toISOString(),
    feedItemCount: sharedStats?.count ?? builder._count.feedItems,
    latestPostCreatedAt:
      (sharedStats?.latestPostCreatedAt ?? latestPostCreatedAt)?.toISOString() ?? null,
    subscribed,
    allowRemove,
  };
}

function LibrarySection({
  title,
  detail,
  badge,
  count,
  defaultOpen = false,
  indented = false,
  summaryClassName,
  showCount = true,
  action,
  importedMetadata,
  children,
}: {
  title: ReactNode;
  detail: ReactNode;
  badge?: string;
  count: number;
  defaultOpen?: boolean;
  indented?: boolean;
  summaryClassName?: string;
  showCount?: boolean;
  action?: ReactNode;
  importedMetadata?: SourceLibraryMetadataValue | null;
  children: ReactNode;
}) {
  const importedMetadataRow = importedMetadata || action ? (
    <div className="library-section-meta library-section-meta--imported">
      <div className="library-section-imported-metadata">
        {importedMetadata ? <SourceLibraryMetadataRow metadata={importedMetadata} /> : null}
      </div>
      {action}
    </div>
  ) : null;

  return (
    <details
      className={`library-section-panel${indented ? " library-section-panel-indented" : ""}${summaryClassName ? ` ${summaryClassName}` : ""}`}
      open={defaultOpen}
    >
      <summary className="library-section-summary">
        <div className="library-section-summary-copy">
          <h3 className="fb-section-heading">{title}</h3>
          {importedMetadataRow}
          <div className="library-section-copy">{detail}</div>
        </div>
        {!importedMetadataRow ? (
          <div className={`library-section-meta${badge ? "" : " library-section-meta--no-badge"}`}>
            {badge ? <span className="fb-kind-pill">{badge}</span> : null}
            {showCount ? <CountMeta label={count === 1 ? "source" : "sources"} value={count} /> : null}
            {action}
          </div>
        ) : null}
      </summary>
      <div className="library-section-body">
        <SourceLibraryItemsArea>{children}</SourceLibraryItemsArea>
      </div>
    </details>
  );
}

function ImportedLibraryCollapsedMeta({
  builders,
}: {
  builders: BuilderWithCount[];
}) {
  const visibleBuilders = builders.slice(0, 4);
  const hiddenBuilderCount = Math.max(0, builders.length - visibleBuilders.length);
  const sourceLabel = `View ${formatCount(builders.length)} ${builders.length === 1 ? "source" : "sources"}`;
  return (
    <>
      <span
        aria-label={sourceLabel}
        className="imported-library-collapsed-meta"
      >
        {visibleBuilders.length > 0 ? (
          <span className="imported-library-avatar-stack" aria-hidden="true">
            {visibleBuilders.map((builder) => (
              <SourceAvatar
                className="imported-library-avatar"
                imageSize={32}
                key={builder.id}
                source={builder}
              />
            ))}
            {hiddenBuilderCount > 0 ? (
              <span className="imported-library-avatar-more">
                +{formatCount(hiddenBuilderCount)}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="imported-library-source-count">{sourceLabel}</span>
      </span>
      <ChevronDown aria-hidden="true" className="imported-library-chevron" />
    </>
  );
}

function builderSort(a: BuilderWithCount, b: BuilderWithCount) {
  // Source-type grouped, newest-first within each type. Keep this in
  // sync with BuilderLibraryList's clientBuilderSort so optimistic rows
  // keep the same section after the server data refreshes.
  const sourceCmp =
    sourceTypeSortRank(sourceTypeForBuilder(a)) -
    sourceTypeSortRank(sourceTypeForBuilder(b));
  if (sourceCmp !== 0) return sourceCmp;
  const ta = a.createdAt.getTime();
  const tb = b.createdAt.getTime();
  if (ta !== tb) return tb - ta;
  return a.name.localeCompare(b.name);
}

function sourceTypeForBuilder(
  builder: Pick<BuilderWithCount, "kind" | "sourceType">,
) {
  const explicit = normalizeBuilderSourceType(builder.sourceType);
  if (explicit) return explicit;
  if (builder.kind === BuilderKind.X) return "x";
  if (builder.kind === BuilderKind.BLOG) return "blog";
  if (builder.kind === BuilderKind.PODCAST) return "podcast";
  return "website";
}

function normalizeBuilderSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "auto") return "";
  if (normalized === "pdf") return "website";
  return normalized;
}

function sourceTypeSortRank(sourceType: string) {
  const order = [
    "blog",
    "github_trending",
    "product_hunt_top_products",
    "youtube",
    "podcast",
    "x",
    "website",
  ];
  const index = order.indexOf(sourceType);
  return index === -1 ? order.length : index;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSourcesTab(value: string | undefined): SourcesTab {
  return value === "digest" ? "digest" : "fetch";
}

function selectedSourcesTabItem(value: SourcesTab) {
  return SOURCES_TABS.find((tab) => tab.value === value) ?? SOURCES_TABS[0];
}

async function latestPostCreationTimes(builderIds: string[]): Promise<LatestPostCreatedAtByBuilderId> {
  if (builderIds.length === 0) return new Map();
  const rows = await prisma.feedItem.groupBy({
    by: ["builderId"],
    where: {
      builderId: { in: builderIds },
      publishedAt: { not: null },
    },
    _max: { publishedAt: true },
  });

  return new Map(rows.flatMap((row) => (row.builderId ? [[row.builderId, row._max.publishedAt]] : [])));
}

async function sharedAdminPostStatsForBuilders(
  builders: Array<Pick<BuilderWithCount, "entityId" | "sourceType">>,
): Promise<SharedAdminPostStatsByEntityId> {
  const entityIds = [
    ...new Set(
      builders
        .filter(
          (builder) =>
            builder.entityId && isAdminFetchOnlySourceType(builder.sourceType),
        )
        .map((builder) => builder.entityId!),
    ),
  ];
  if (entityIds.length === 0) return new Map();

  const adminBuilders = await prisma.builder.findMany({
    where: {
      entityId: { in: entityIds },
      sourceType: { in: [...ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS] },
      owner: { email: { in: adminEmails() } },
    },
    select: { id: true, entityId: true },
  });
  const entityIdByAdminBuilderId = new Map(
    adminBuilders.flatMap((builder) =>
      builder.entityId ? [[builder.id, builder.entityId] as const] : [],
    ),
  );
  const adminBuilderIds = [...entityIdByAdminBuilderId.keys()];
  if (adminBuilderIds.length === 0) return new Map();

  const rows = await prisma.feedItem.groupBy({
    by: ["builderId", "kind", "externalId"],
    where: { builderId: { in: adminBuilderIds } },
    _max: { publishedAt: true, createdAt: true },
  });

  const statsByEntityId = new Map<
    string,
    { contentKeys: Set<string>; latestPostCreatedAt: Date | null }
  >();
  for (const row of rows) {
    const entityId = row.builderId
      ? entityIdByAdminBuilderId.get(row.builderId)
      : null;
    if (!entityId) continue;
    const stats =
      statsByEntityId.get(entityId) ??
      { contentKeys: new Set<string>(), latestPostCreatedAt: null };
    stats.contentKeys.add(`${row.kind}:${row.externalId}`);
    const rowDate = row._max.publishedAt ?? row._max.createdAt;
    if (!rowDate) continue;
    if (!stats.latestPostCreatedAt || rowDate > stats.latestPostCreatedAt) {
      stats.latestPostCreatedAt = rowDate;
    }
    statsByEntityId.set(entityId, stats);
  }

  return new Map(
    Array.from(statsByEntityId, ([entityId, stats]) => [
      entityId,
      {
        count: stats.contentKeys.size,
        latestPostCreatedAt: stats.latestPostCreatedAt,
      },
    ]),
  );
}

function sharedAdminPostStatsForBuilder(
  builder: Pick<BuilderWithCount, "entityId" | "sourceType">,
  sharedAdminPostStatsByEntityId: SharedAdminPostStatsByEntityId,
) {
  if (!builder.entityId || !isAdminFetchOnlySourceType(builder.sourceType)) {
    return null;
  }
  return sharedAdminPostStatsByEntityId.get(builder.entityId) ?? null;
}
