import { BuilderKind, BuilderPoolOrigin } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BuilderLibraryList, type BuilderLibraryListItem } from "@/components/BuilderLibraryList";
import { BuilderLibraryStats } from "@/components/BuilderLibraryStats";
import { CountMeta } from "@/components/Count";
import { DigestLogPanel } from "@/components/DigestLogPanel";
import {
  DigestPipelineImportForm,
  OwnDigestPipelineCard,
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
import { MobileSourcesSwitcher } from "@/components/MobileSourcesSwitcher";
import { PageHeader } from "@/components/PageHeader";
import { PrivateLibraryPanel } from "@/components/PrivateLibraryPanel";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { isAdminEmail } from "@/lib/admin";
import { getAgentJobRuns, getScheduledAgentJobRuns } from "@/lib/agent-job-runs";
import { getCurrentSession } from "@/lib/auth";
import { getDigestRuns, serializeDigestCronJob } from "@/lib/digest-runs";
import {
  adminCommunityLibraryDescription,
  adminCommunityLibraryName,
  digestPipelineTitle,
  displayDigestPipelineTitle,
  ensureAdminCommunityLibrary,
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

export default async function BuildersPage({
  searchParams,
}: {
  searchParams: BuildersSearchParams;
}) {
  const params = await searchParams;
  const selectedTab = parseSourcesTab(firstParam(params.tab));
  const dataPromise = loadBuildersPageData();
  const digestDataPromise =
    selectedTab === "digest" ? loadDigestSourcesPageData() : null;

  return (
    <div className="page-pad">
      <PageHeader title="Sources" />

      <div className="workspace-content-stack">
        <section className="sources-tab-surface">
          <SourcesSubtabs selectedTab={selectedTab} />

          {selectedTab === "fetch" ? (
            <section className="sources-tab-body sources-tab-body--fetch">
              <Suspense fallback={<BuilderStatsFallback />}>
                <BuilderStatsSlot dataPromise={dataPromise} />
              </Suspense>

              <Suspense fallback={<FetchSourcesFallback />}>
                <FetchSourcesSection dataPromise={dataPromise} />
              </Suspense>
            </section>
          ) : (
            <section className="sources-tab-body sources-tab-body--digest">
              <Suspense fallback={<DigestSourcesFallback />}>
                <DigestSourcesSection dataPromise={digestDataPromise ?? loadDigestSourcesPageData()} />
              </Suspense>
            </section>
          )}
        </section>
      </div>
    </div>
  );
}

function SourcesSubtabs({ selectedTab }: { selectedTab: SourcesTab }) {
  return (
    <nav
      className="fb-segmented-tabs sources-subtabs"
      aria-label="Source management"
      role="tablist"
    >
      <Link
        aria-selected={selectedTab === "fetch"}
        className="fb-btn compact"
        data-active={selectedTab === "fetch" ? "true" : undefined}
        href="/builders"
        role="tab"
      >
        Fetch
      </Link>
      <Link
        aria-selected={selectedTab === "digest"}
        className="fb-btn compact"
        data-active={selectedTab === "digest" ? "true" : undefined}
        href="/builders?tab=digest"
        role="tab"
      >
        Digest
      </Link>
    </nav>
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
      <section className="your-digest-panel fb-panel" aria-labelledby="sources-digest-section-title">
        <div className="library-hub-toolbar">
          <div className="library-hub-toolbar-copy">
            <h2 id="sources-digest-section-title" className="fb-section-heading">
              Your digest
            </h2>
          </div>
          <DigestPipelineVisibilityToggle initialShared={data.ownPipelineShared} />
        </div>

        <section className="sources-sync-section">
          <DigestLogPanel
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
          />
        </section>

        <OwnDigestPipelineCard pipeline={data.ownDigestPipeline} />
      </section>

      <DigestPipelineImportForm pipelines={data.hubDigestPipelines} />
    </section>
  );
}

function DigestSourcesFallback() {
  return (
    <section className="digest-source-management" aria-live="polite" aria-busy="true">
      <div className="source-sync-skeleton-panel" />
      <div className="source-sync-skeleton-panel" />
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

  const digestCounts = await Promise.all(
    digestPipelineShares.map(async (pipeline) => {
      const [digestCount, latestDigest] = await Promise.all([
        prisma.digest.count({ where: { userId: pipeline.ownerUserId, itemCount: { gt: 0 } } }),
        prisma.digest.findFirst({
          where: { userId: pipeline.ownerUserId, itemCount: { gt: 0 } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      return [pipeline.id, { digestCount, latestDigestAt: latestDigest?.createdAt ?? null }] as const;
    }),
  );
  const digestCountByPipelineId = new Map(digestCounts);
  const importedDigestPipelineIds = new Set(
    digestPipelineImports.map((item) => item.pipelineId),
  );
  const [ownDigestCount, ownLatestDigest] = await Promise.all([
    prisma.digest.count({ where: { userId: session.user.id, itemCount: { gt: 0 } } }),
    prisma.digest.findFirst({
      where: { userId: session.user.id, itemCount: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const ownDigestPipeline: OwnDigestPipeline = {
    title: displayDigestPipelineTitle(
      ownPipelineShare?.title ?? digestPipelineTitle(session.user),
    ),
    importCount: ownPipelineShare?.importCount ?? 0,
    viewCount: ownPipelineShare?.viewCount ?? 0,
    digestCount: ownDigestCount,
    latestDigestAt: ownLatestDigest?.createdAt.toISOString() ?? null,
  };
  const hubDigestPipelines: HubDigestPipeline[] = digestPipelineShares
    .map((pipeline) => {
      const owned = pipeline.ownerUserId === session.user.id;
      const owner = pipeline.owner;
      const stats = digestCountByPipelineId.get(pipeline.id);
      return {
        id: pipeline.id,
        title: displayDigestPipelineTitle(pipeline.title || digestPipelineTitle(owner)),
        description: pipeline.description,
        ownerUserId: pipeline.ownerUserId,
        ownerLabel: owned
          ? "Shared by you."
          : `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`,
        importCount: pipeline.importCount,
        viewCount: pipeline.viewCount,
        digestCount: stats?.digestCount ?? 0,
        latestDigestAt: stats?.latestDigestAt?.toISOString() ?? null,
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
    digestMaxPostAgeDays: feedPreference?.digestMaxPostAgeDays ?? null,
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
  const importedLibrarySections = importedLibraries.map((libraryImport) => ({
    id: libraryImport.hubEntryId,
    name: libraryImport.hubEntry.name,
    description: libraryImport.hubEntry.description,
    ownerName:
      libraryImport.hubEntry.owner?.name ||
      libraryImport.hubEntry.owner?.email ||
      "FollowBrief",
    builders: libraryImport.hubEntry.items
      .flatMap((item) => {
        const entry = activeEntryByBuilderId.get(item.builderId);
        return entry ? [entry.builder] : [];
      })
      .sort(builderSort),
  }));
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
    digestMaxPostAgeDays: feedPreference?.digestMaxPostAgeDays ?? null,
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

async function BuilderStatsSlot({
  dataPromise,
}: {
  dataPromise: Promise<BuildersPageData>;
}) {
  const data = await dataPromise;

  return (
    <BuilderLibraryStats
      initialFetchedItems={data.fetchedItems}
      initialInLibrary={data.poolBuilders.length}
      initialSubscribed={data.subscribedCount}
    />
  );
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
      : `${data.sessionUserName || data.sessionUserEmail || "Personal"} library`;

  const fetchSyncSection = (
    <section className="sources-sync-section">
      <FetchLogPanel
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
      />
    </section>
  );

  const privateSection = (
    <PrivateLibraryPanel
      beforeBody={fetchSyncSection}
      className="your-library-panel fb-panel"
      count={data.privateBuilders.length}
      headingId="sources-library-section-title"
      sourceOptions={data.sourceLabelOptions}
      title="Your library"
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
            subscribed: data.subscribed.has(builder.id),
          }),
        )}
        editableSourceOptions={data.sourceLabelOptions}
        emptyBody="Add a source, or run your local helper to import private sources."
        emptyTitle="No personal sources yet"
      />
    </PrivateLibraryPanel>
  );

  const importedSection = (
    <section className="imported-libraries-section">
      <div className="imported-libraries-head at-desktop">
        <h2 className="fb-section-heading">Imported libraries</h2>
        <p className="library-section-copy">
          Sources grouped by the shared library they came from.
        </p>
      </div>
      <div className="imported-library-stack">
        {data.importedLibrarySections.map((library) => (
          <LibrarySection
            key={library.id}
            title={library.name}
            detail={library.description || `Imported from ${library.ownerName}`}
            badge="imported"
            count={library.builders.length}
            defaultOpen
            indented
            action={
              <LibraryImportRemoveButton
                builderCount={library.builders.length}
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
              emptyBody="No active sources from this imported library."
            />
          </LibrarySection>
        ))}
        {data.importedLibrarySections.length === 0 ? (
          <EmptyState body="Import shared libraries from the Hub to see them here." />
        ) : null}
      </div>
    </section>
  );

  return (
    <section className="sources-section-stack">
      <MobileSourcesSwitcher
        privateLabel="Your library"
        importedLabel="Imported"
        privateSection={privateSection}
        importedSection={importedSection}
      />
    </section>
  );
}

function BuilderStatsFallback() {
  return (
    <div className="page-toolbar" aria-live="polite" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="source-stat-skeleton" />
      ))}
    </div>
  );
}

function FetchSourcesFallback() {
  return (
    <section className="sources-section-stack" aria-live="polite" aria-busy="true">
      <section className="your-library-panel fb-panel">
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
  badge: string;
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
          <h2 className="fb-section-heading">{title}</h2>
          <p className="library-section-copy">{detail}</p>
        </div>
        <div className="library-section-meta">
          <span className="fb-kind-pill">{badge}</span>
          <CountMeta label={count === 1 ? "source" : "sources"} value={count} />
          {action}
        </div>
      </summary>
      <div className="library-section-body">{children}</div>
    </details>
  );
}

function builderSort(a: BuilderWithCount, b: BuilderWithCount) {
  // Kind-grouped, newest-first within each kind. The user prefers
  // scanning by source type (all X together, all podcasts together);
  // within a group the most-recently-added row sits at the top, so a
  // newly added builder lands at the top of its KIND group — not
  // necessarily the top of the page. Name is the deterministic
  // tiebreaker when createdAt is identical (e.g. seeded rows).
  const kindCmp = a.kind.localeCompare(b.kind);
  if (kindCmp !== 0) return kindCmp;
  const ta = a.createdAt.getTime();
  const tb = b.createdAt.getTime();
  if (ta !== tb) return tb - ta;
  return a.name.localeCompare(b.name);
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSourcesTab(value: string | undefined): SourcesTab {
  return value === "digest" ? "digest" : "fetch";
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
