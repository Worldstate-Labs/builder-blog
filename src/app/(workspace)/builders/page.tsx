import { BuilderKind, BuilderPoolOrigin } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BuilderLibraryList, type BuilderLibraryListItem } from "@/components/BuilderLibraryList";
import { CountMeta } from "@/components/Count";
import {
  DigestPipelineImportForm,
  type HubDigestPipeline,
  type OwnDigestPipeline,
} from "@/components/DigestPipelineImportForm";
import { DigestPipelineVisibilityToggle } from "@/components/DigestPipelineVisibilityToggle";
import { EmptyState } from "@/components/EmptyState";
import {
  FetchLogPanel,
  type LibraryCronJobStatus,
  type LibraryFetchRunListItem,
} from "@/components/FetchLogPanel";
import { LibraryImportRemoveButton } from "@/components/LibraryImportRemoveButton";
import { LibraryVisibilityToggle } from "@/components/LibraryVisibilityToggle";
import { OwnDigestPipelineUpdatesCard } from "@/components/OwnDigestPipelineUpdatesCard";
import { PageHeader } from "@/components/PageHeader";
import { PrivateLibraryPanel } from "@/components/PrivateLibraryPanel";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import { SourceLibraryItemsArea } from "@/components/SourceLibraryItemsArea";
import { WorkspaceTopTabs, type WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { isAdminEmail } from "@/lib/admin";
import { getAgentJobRuns, getScheduledAgentJobRuns } from "@/lib/agent-job-runs";
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
  digestPipelineTitle,
  digestPipelineOwnerLabel,
  displayDigestPipelineTitle,
  displayDigestPipelineTitleForOwner,
  ensureAdminCommunityLibrary,
  ensureAdminCommunityDigestPipeline,
  ensureDefaultCommunityDigestImport,
  personalSourceLibraryName,
  recordDigestPipelineHubViews,
  sharePersonalLibraryToHub,
} from "@/lib/library-hub";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import { getMergedSourceDefinitions } from "@/lib/source-registry";

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
type BuildersPageData = Awaited<ReturnType<typeof loadBuildersPageData>>;
type DigestSourcesPageData = Awaited<ReturnType<typeof loadDigestSourcesPageData>>;
type SourcesTab = "fetch" | "digest";

type BuildersSearchParams = Promise<{
  tab?: string | string[];
}>;

const SOURCES_TABS: Array<WorkspaceTopTabItem<SourcesTab>> = [
  {
    value: "fetch",
    label: "Sources",
    href: "/builders?tab=fetch",
    panelId: "sources-panel-fetch",
    tabId: "sources-tab-fetch",
  },
  {
    value: "digest",
    label: "AI Digest",
    href: "/builders?tab=digest",
    panelId: "sources-panel-digest",
    tabId: "sources-tab-digest",
  },
];

export default async function BuildersPage({
  searchParams,
}: {
  searchParams: BuildersSearchParams;
}) {
  const params = await searchParams;
  const selectedTab = parseSourcesTab(firstParam(params.tab));
  const selectedTabItem = selectedSourcesTabItem(selectedTab);
  const fetchDataPromise =
    selectedTab === "fetch" ? loadBuildersPageData() : null;
  const digestDataPromise =
    selectedTab === "digest" ? loadDigestSourcesPageData() : null;

  return (
    <div className="page-pad">
      <PageHeader
        title="Sources"
        description="Follow sources, run Fetch sources, and choose what feeds AI Digest issues and Following posts."
      />
      <div className="workspace-content-stack workspace-content-stack--tabs-first">
        <section className="sources-tab-surface">
          <WorkspaceTopTabs
            ariaLabel="Sources and AI Digest tabs"
            items={SOURCES_TABS}
            selectedValue={selectedTab}
          />

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
    <section className="digest-source-management">
      <section className="your-digest-section" aria-labelledby="sources-digest-section-title">
        <div className="library-hub-toolbar">
          <div className="library-hub-toolbar-copy">
            <h2 id="sources-digest-section-title" className="fb-section-heading">
              Your AI Digest collection
            </h2>
          </div>
          <DigestPipelineVisibilityToggle initialShared={data.ownPipelineShared} />
        </div>

        <OwnDigestPipelineUpdatesCard
          actions={
            <SkillPromptActions
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

      <DigestPipelineImportForm mode="imported" pipelines={data.hubDigestPipelines} />
    </section>
  );
}

function DigestSourcesFallback() {
  return (
    <section className="digest-source-management" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading AI Digest controls</span>
      <section className="your-digest-section" aria-label="Loading your AI Digest collection">
        <div className="library-hub-toolbar">
          <div className="library-hub-toolbar-copy">
            <h2 className="fb-section-heading">
              Your AI Digest collection
            </h2>
            <div className="source-sync-skeleton-line" />
          </div>
          <div className="source-section-skeleton-chip" />
        </div>
        <div className="source-sync-skeleton-panel" />
      </section>
      <section className="digest-source-management" aria-label="Loading imported AI Digest collections">
        <div className="library-hub-toolbar">
          <div className="library-hub-toolbar-copy">
            <h2 className="fb-section-heading">
              Imported AI Digest collections
            </h2>
            <div className="source-sync-skeleton-line" />
          </div>
        </div>
        <div className="source-sync-skeleton-panel" />
      </section>
    </section>
  );
}

async function loadDigestSourcesPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  if (isAdminEmail(session.user.email)) {
    await ensureAdminCommunityDigestPipeline(session.user.id, session.user.email);
  } else {
    await ensureDefaultCommunityDigestImport(session.user.id);
  }

  const [
    rawTokens,
    feedPreference,
    rawDigestRuns,
    rawDigestCronRuns,
    digestJobRuns,
    digestScheduledJobRuns,
    rawDigestCronJob,
    ownPipelineShare,
    digestPipelineShares,
    digestPipelineImports,
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
    prisma.digestPipelineShare.findUnique({
      where: { ownerUserId: session.user.id },
      select: {
        importCount: true,
        isPublic: true,
        title: true,
        viewCount: true,
      },
    }),
    prisma.digestPipelineShare.findMany({
      where: { isPublic: true },
      include: {
        owner: { select: { name: true, email: true } },
        imports: {
          where: { userId: session.user.id },
          select: { userId: true },
        },
      },
      orderBy: [{ importCount: "desc" }, { viewCount: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.digestPipelineImport.findMany({
      where: { userId: session.user.id },
      select: { pipelineId: true },
    }),
  ]);

  await recordDigestPipelineHubViews(
    digestPipelineShares
      .filter((pipeline) => pipeline.ownerUserId !== session.user.id)
      .map((pipeline) => pipeline.id),
  );

  const importedDigestPipelineIds = new Set(
    digestPipelineImports.map((item) => item.pipelineId),
  );
  const digestMetadataByOwnerId = await getDigestPipelineMetadataByOwnerIds([
    session.user.id,
    ...digestPipelineShares.map((pipeline) => pipeline.ownerUserId),
  ]);
  const ownDigestMetadata =
    digestMetadataByOwnerId.get(session.user.id) ?? emptyDigestPipelineMetadata();
  const ownDigestPipeline: OwnDigestPipeline = {
    title: displayDigestPipelineTitle(
      ownPipelineShare?.title ?? digestPipelineTitle(session.user),
    ),
    importCount: ownPipelineShare?.importCount ?? 0,
    viewCount: ownPipelineShare?.viewCount ?? 0,
    ...ownDigestMetadata,
  };
  const hubDigestPipelines: HubDigestPipeline[] = digestPipelineShares
    .map((pipeline) => {
      const owned = pipeline.ownerUserId === session.user.id;
      const owner = pipeline.owner;
      const metadata =
        digestMetadataByOwnerId.get(pipeline.ownerUserId) ?? emptyDigestPipelineMetadata();
      return {
        id: pipeline.id,
        title: displayDigestPipelineTitleForOwner(
          pipeline.title || digestPipelineTitle(owner),
          owner,
        ),
        description: pipeline.description,
        ownerUserId: pipeline.ownerUserId,
        ownerLabel: digestPipelineOwnerLabel(owner, { owned }),
        importCount: pipeline.importCount,
        viewCount: pipeline.viewCount,
        ...metadata,
        imported:
          importedDigestPipelineIds.has(pipeline.id) || pipeline.imports.length > 0,
        owned,
      };
    })
    .sort((a, b) => Number(b.owned) - Number(a.owned));

  return {
    activeTokens: serializeAgentTokens(rawTokens),
    digestCronJob: serializeDigestCronJob(rawDigestCronJob),
    digestCronRuns: rawDigestCronRuns,
    digestJobRuns,
    digestRuns: rawDigestRuns,
    digestScheduledJobRuns,
    hubDigestPipelines,
    ownDigestPipeline,
    ownPipelineShared: ownPipelineShare?.isPublic === true,
    summaryLanguage: feedPreference?.summaryLanguage ?? null,
    digestMaxPostAgeDays: digestMaxPostAgeDays(feedPreference),
  };
}

async function loadBuildersPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = isAdminEmail(session.user.email);
  await ensureDefaultCommunityLibraryImport(session.user.id);

  const [
    poolEntries,
    subscriptions,
    importedLibraries,
    ownSharedLibrary,
    adminLibVisibility,
    rawTokens,
    rawFetchRuns,
    rawCronRuns,
    rawLibraryCronJob,
    jobRuns,
    scheduledJobRuns,
    feedPreference,
  ] = await Promise.all([
    prisma.builderPoolEntry.findMany({
      where: { userId: session.user.id, removedAt: null },
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
      where: { userId: session.user.id },
      select: { builderId: true },
    }),
    prisma.libraryImport.findMany({
      where: { userId: session.user.id },
      include: {
        hubEntry: {
          include: {
            owner: { select: { name: true, email: true } },
            items: {
              include: {
                builder: {
                  include: {
                    _count: { select: { feedItems: true } },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.libraryHubEntry.findFirst({
      where: { ownerUserId: session.user.id },
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
        where: { userId_hubEntryId: { userId: session.user.id, hubEntryId: featuredLib.id } },
        select: { hidden: true },
      });
      return { hidden: Boolean(vis?.hidden) };
    })(),
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
    prisma.libraryFetchRun.findMany({
      where: { userId: session.user.id },
      orderBy: { startedAt: "desc" },
      take: 25,
    }),
    prisma.libraryFetchRun.findMany({
      where: { userId: session.user.id, source: "cron" },
      orderBy: { startedAt: "desc" },
      take: 25,
    }),
    prisma.libraryCronJob.findUnique({
      where: { userId: session.user.id },
    }),
    getAgentJobRuns(session.user.id, "library-fetch", 25),
    getScheduledAgentJobRuns(session.user.id, "library-cron", 25),
    prisma.userFeedPreference.findUnique({
      where: { userId: session.user.id },
      select: { summaryLanguage: true, digestMaxPostAgeDays: true },
    }),
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
        entry.builder.ownerUserId === session.user.id,
    )
    .map((entry) => entry.builder)
    .sort(builderSort);
  const importedLibrarySections = importedLibraries.map((libraryImport) => {
    const isCommunityLibrary =
      libraryImport.hubEntry.isFeatured ||
      isAdminEmail(libraryImport.hubEntry.owner?.email);
    return {
      id: libraryImport.hubEntryId,
      name: isCommunityLibrary ? adminCommunityLibraryName : libraryImport.hubEntry.name,
      description: libraryImport.hubEntry.description,
      ownerName: isCommunityLibrary
        ? "FollowBrief community"
        : libraryImport.hubEntry.owner?.name ||
          libraryImport.hubEntry.owner?.email ||
          "FollowBrief",
      builders: libraryImport.hubEntry.items
        .flatMap((item) => {
          const entry = activeEntryByBuilderId.get(item.builderId);
          return entry ? [entry.builder] : [];
        })
        .sort(builderSort),
    };
  });
  const subscribedCount = poolBuilders.filter((builder) => subscribed.has(builder.id)).length;
  const fetchedItems = poolBuilders.reduce(
    (count, builder) => count + builder._count.feedItems,
    0,
  );
  const isAdminCommunityLibraryHidden = Boolean(adminLibVisibility?.hidden);
  let isPublicLibrary = isAdmin ? !isAdminCommunityLibraryHidden : Boolean(ownSharedLibrary);
  if (
    isAdmin &&
    !isAdminCommunityLibraryHidden &&
    (!ownSharedLibrary ||
      ownSharedLibrary.name !== adminCommunityLibraryName ||
      ownSharedLibrary.description !== adminCommunityLibraryDescription ||
      ownSharedLibrary._count.items !== privateBuilders.length)
  ) {
    const result = await ensureAdminCommunityLibrary(session.user.id);
    isPublicLibrary = result.isPublic;
  } else if (
    !isAdmin &&
    ownSharedLibrary &&
    ownSharedLibrary._count.items !== privateBuilders.length
  ) {
    await sharePersonalLibraryToHub({
      userId: session.user.id,
      name: ownSharedLibrary.name,
      description: ownSharedLibrary.description,
    });
  }
  const [latestPostCreatedAtByBuilderId, mergedSourceDefinitions] = await Promise.all([
    latestPostCreationTimes(poolBuilderIds),
    getMergedSourceDefinitions(),
  ]);
  const sourceLabelOptions = mergedSourceDefinitions.map((source) => ({
    id: source.id,
    label: source.label,
  }));

  const activeTokens = serializeAgentTokens(rawTokens);

  const fetchRuns: LibraryFetchRunListItem[] = rawFetchRuns.map((run) => ({
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
  const cronRuns: LibraryFetchRunListItem[] = rawCronRuns.map((run) => ({
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
    fetchedItems,
    cronRuns,
    fetchRuns,
    jobRuns,
    libraryCronJob,
    scheduledJobRuns,
    importedLibrarySections,
    isAdmin,
    isPublicLibrary,
    latestPostCreatedAtByBuilderId,
    poolBuilders,
    privateBuilders,
    sessionUserEmail: session.user.email,
    sessionUserName: session.user.name,
    sourceLabelOptions,
    subscribed,
    subscribedCount,
    summaryLanguage: feedPreference?.summaryLanguage ?? null,
    digestMaxPostAgeDays: digestMaxPostAgeDays(feedPreference),
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

async function FetchSourcesSection({
  dataPromise,
}: {
  dataPromise: Promise<BuildersPageData>;
}) {
  const data = await dataPromise;
  const showStopLibraryCron = data.libraryCronJob?.status === "active";
  const userLibraryName =
    data.isAdmin
      ? adminCommunityLibraryName
      : personalSourceLibraryName({
          name: data.sessionUserName,
          email: data.sessionUserEmail,
        });

  const fetchSyncSection = (
    <section className="sources-sync-section">
      <FetchLogPanel
        actionsPlacement="start"
        actions={
          <SkillPromptActions
            compactOnly
            context="library"
            showStop={showStopLibraryCron}
            tokens={data.activeTokens}
            summaryLanguage={data.summaryLanguage}
            digestMaxPostAgeDays={data.digestMaxPostAgeDays}
          />
        }
        initialCronJob={data.libraryCronJob}
        initialCronRuns={data.cronRuns}
        initialJobRuns={data.jobRuns}
        initialScheduledJobRuns={data.scheduledJobRuns}
        initialRuns={data.fetchRuns}
        summaryLanguage={data.summaryLanguage}
      />
    </section>
  );

  const privateSection = (
    <section className="your-library-section" aria-labelledby="sources-library-section-title">
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 id="sources-library-section-title" className="fb-section-heading">
            Your source library
          </h2>
        </div>
        <LibraryVisibilityToggle
          compact
          disabled={!data.isAdmin && data.privateBuilders.length === 0}
          initialIsPublic={data.isPublicLibrary}
          isAdminLibrary={data.isAdmin}
          name={userLibraryName}
        />
      </div>

      <PrivateLibraryPanel
        beforeBody={fetchSyncSection}
        className="your-library-panel library-section-panel"
        hideHeader
        sourceOptions={data.sourceLabelOptions}
        title="Your source library"
      >
        <BuilderLibraryList
          acceptAddedBuilders
          builders={data.privateBuilders.map((builder) =>
            builderListItem({
              allowRemove: true,
              builder,
              latestPostCreatedAt: data.latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
              subscribed: data.subscribed.has(builder.id),
            }),
          )}
          editableSourceOptions={data.sourceLabelOptions}
          emptyBody="Add sources, then run Fetch sources to feed AI Digest issues and Following posts."
          emptyTitle="No sources in your source library yet"
        />
      </PrivateLibraryPanel>
    </section>
  );

  const importedSection = (
    <section className="imported-libraries-section">
      <div className="imported-libraries-head">
        <div className="imported-libraries-copy">
          <h2 className="fb-section-heading">Imported source libraries</h2>
          <p className="library-section-copy">
            Source libraries imported from Hub.
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
            title={library.name}
            detail={library.description || `Imported from ${library.ownerName}`}
            count={library.builders.length}
            defaultOpen
            indented
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
    <section className="sources-section-stack">
      {privateSection}
      {importedSection}
    </section>
  );
}

function FetchSourcesFallback() {
  return (
    <section className="sources-section-stack" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading Sources</span>
      <section className="your-library-panel library-section-panel">
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
    </section>
  );
}

function builderListItem({
  allowRemove,
  builder,
  latestPostCreatedAt,
  subscribed,
}: {
  allowRemove: boolean;
  builder: BuilderWithCount;
  latestPostCreatedAt: Date | null;
  subscribed: boolean;
}): BuilderLibraryListItem {
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
    feedItemCount: builder._count.feedItems,
    latestPostCreatedAt: latestPostCreatedAt?.toISOString() ?? null,
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
  action,
  children,
}: {
  title: string;
  detail: string;
  badge?: string;
  count: number;
  defaultOpen?: boolean;
  indented?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      className={`library-section-panel${indented ? " library-section-panel-indented" : ""}`}
      open={defaultOpen}
    >
      <summary className="library-section-summary">
        <div className="library-section-summary-copy">
          <h3 className="fb-section-heading">{title}</h3>
          <p className="library-section-copy">{detail}</p>
        </div>
        <div className={`library-section-meta${badge ? "" : " library-section-meta--no-badge"}`}>
          {badge ? <span className="fb-kind-pill">{badge}</span> : null}
          <CountMeta label={count === 1 ? "source" : "sources"} value={count} />
          {action}
        </div>
      </summary>
      <div className="library-section-body">
        <SourceLibraryItemsArea>{children}</SourceLibraryItemsArea>
      </div>
    </details>
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
