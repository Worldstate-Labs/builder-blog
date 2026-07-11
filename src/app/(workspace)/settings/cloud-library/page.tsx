import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AdminCloudFetchConfigForm } from "@/components/AdminCloudFetchConfigForm";
import { AdminCloudFetchLog } from "@/components/AdminCloudFetchLog";
import { AdminCloudFetchRunActions } from "@/components/AdminCloudFetchRunActions";
import { AdminCloudLibraryMaintenancePanel } from "@/components/AdminCloudLibraryMaintenancePanel";
import { AdminCloudLibraryExplorer } from "@/components/AdminCloudLibraryExplorer";
import { CountMeta } from "@/components/Count";
import { PageHeader } from "@/components/PageHeader";
import { getAgentJobRuns } from "@/lib/agent-job-runs";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { serializeCloudFetchRun, serializeCloudWorkerHost } from "@/lib/cloud-fetch-run-log";
import { CLOUD_FETCH_CONFIG_ID, serializeCloudFetchConfig } from "@/lib/cloud-source-config";
import {
  serializeCloudLibrary,
  serializeCloudLibrarySource,
} from "@/lib/cloud-library-overview";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

export default async function CloudLibraryManagementPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/settings");
  const userId = session.user.id;

  const [tokens, runRows, jobRuns, libraryRows, cloudConfig] = await Promise.all([
    prisma.agentToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.cloudFetchRun.findMany({
      orderBy: { startedAt: "desc" },
      take: PAGE_SIZE + 1,
      include: {
        tasks: {
          orderBy: { id: "asc" },
          include: { builder: { select: { name: true, sourceType: true } } },
        },
      },
    }),
    getAgentJobRuns(userId, "cloud-library-fetch", 5),
    prisma.cloudLanguageLibrary.findMany({
      orderBy: { summaryLanguage: "asc" },
      include: {
        owner: { select: { email: true, name: true } },
        sourceTasks: {
          orderBy: { id: "asc" },
          include: {
            runTasks: {
              orderBy: { startedAt: "desc" },
              take: 1,
              include: { builder: { select: { name: true, sourceType: true } } },
            },
            builder: {
              select: {
                entityId: true,
                kind: true,
                name: true,
                sourceType: true,
                sourceUrl: true,
                fetchUrl: true,
                avatarUrl: true,
                avatarDataUrl: true,
              },
            },
          },
        },
      },
    }),
    prisma.cloudFetchConfig.findUnique({ where: { id: CLOUD_FETCH_CONFIG_ID } }),
  ]);

  const hasMore = runRows.length > PAGE_SIZE;
  const leaseBatches = runRows.slice(0, PAGE_SIZE).map(serializeCloudFetchRun);
  const workerHost = serializeCloudWorkerHost(
    jobRuns.find((job) => job.status === "running" || job.status === "starting") ??
      jobRuns[0] ??
      null,
  );

  // Counts per cloud-owner builder, batched with groupBy to avoid N+1.
  const builderIds = libraryRows.flatMap((library) =>
    library.sourceTasks.map((task) => task.builderId),
  );
  const [submitterGroups, postGroups] = await Promise.all([
    prisma.cloudSourceSubmission.groupBy({
      by: ["cloudBuilderId"],
      where: { cloudBuilderId: { in: builderIds }, active: true },
      _count: { _all: true },
    }),
    prisma.feedItem.groupBy({
      by: ["builderId"],
      where: { builderId: { in: builderIds } },
      _count: { _all: true },
    }),
  ]);
  const submitterCountByBuilder = new Map(
    submitterGroups.map((group) => [group.cloudBuilderId, group._count._all]),
  );
  const postCountByBuilder = new Map(
    postGroups.map((group) => [group.builderId, group._count._all]),
  );
  const libraries = libraryRows.map((library) => {
    const activeSourceTasks = library.sourceTasks.filter(
      (task) => (submitterCountByBuilder.get(task.builderId) ?? 0) > 0,
    );
    return serializeCloudLibrary(
      library,
      activeSourceTasks.map((task) =>
        serializeCloudLibrarySource(task, {
          submitterCount: submitterCountByBuilder.get(task.builderId) ?? 0,
          postCount: postCountByBuilder.get(task.builderId) ?? 0,
        }),
      ),
    );
  });

  return (
    <div className="page-pad page-pad--settings">
      <PageHeader
        title="Cloud library management"
        description="Monitor the long-running worker host, its live post queue, and the source deliveries feeding it."
      />

      <div className="workspace-content-stack settings-workspace">
        <section className="settings-rules">
          <details className="settings-rules-panel fb-panel" open>
            <summary className="settings-rules-summary">
              <div className="settings-rules-summary-copy">
                <h3 className="fb-section-heading">Start cloud worker</h3>
                <p className="settings-rules-summary-desc">
                  Copy one prompt to install or restart the local worker host. It stays running,
                  waits when cloud has no work, and refills when workers are free.
                </p>
              </div>
              <span className="settings-rules-toggle-icon" aria-hidden="true">
                <ChevronDown className="settings-rules-toggle-svg" />
              </span>
            </summary>
            <div className="settings-rules-body">
              <AdminCloudFetchRunActions activeTokens={tokens} />
            </div>
          </details>

          <details className="settings-rules-panel fb-panel" open>
            <summary className="settings-rules-summary">
              <div className="settings-rules-summary-copy">
                <h3 className="fb-section-heading">Cloud fetch monitor</h3>
                <p className="settings-rules-summary-desc">
                  Live host heartbeat and queue first, source delivery history below.
                </p>
              </div>
              <span className="settings-rules-toggle-icon" aria-hidden="true">
                <ChevronDown className="settings-rules-toggle-svg" />
              </span>
            </summary>
            <div className="settings-rules-body">
              <AdminCloudFetchLog
                initialWorkerHost={workerHost}
                initialLeaseBatches={leaseBatches}
                initialHasMore={hasMore}
              />
            </div>
          </details>

          <details className="settings-rules-panel fb-panel">
            <summary className="settings-rules-summary">
              <div className="settings-rules-summary-copy">
                <h3 className="fb-section-heading">Cloud libraries</h3>
                <p className="settings-rules-summary-desc">
                  Each language library and its sources — fetch status, how many users submitted
                  each source, and how many posts it has. Expand a source for its submitters and
                  recent posts.
                </p>
              </div>
              <span className="settings-rules-summary-meta source-summary-line">
                <CountMeta
                  label={libraries.length === 1 ? "language library" : "language libraries"}
                  value={libraries.length}
                />
              </span>
              <span className="settings-rules-toggle-icon" aria-hidden="true">
                <ChevronDown className="settings-rules-toggle-svg" />
              </span>
            </summary>
            <div className="settings-rules-body">
              <AdminCloudLibraryExplorer libraries={libraries} />
            </div>
          </details>

          <details className="settings-rules-panel fb-panel">
            <summary className="settings-rules-summary">
              <div className="settings-rules-summary-copy">
                <h3 className="fb-section-heading">Cloud library maintenance</h3>
                <p className="settings-rules-summary-desc">
                  Clear generated Cloud library posts and source delivery logs without removing
                  submitted sources or language libraries.
                </p>
              </div>
              <span className="settings-rules-toggle-icon" aria-hidden="true">
                <ChevronDown className="settings-rules-toggle-svg" />
              </span>
            </summary>
            <div className="settings-rules-body">
              <AdminCloudLibraryMaintenancePanel />
            </div>
          </details>

          <details className="settings-rules-panel fb-panel">
            <summary className="settings-rules-summary">
              <div className="settings-rules-summary-copy">
                <h3 className="fb-section-heading">Cloud source fetching</h3>
                <p className="settings-rules-summary-desc">
                  Configure cloud source queueing, retry safety, and language library owners.
                </p>
              </div>
              <span className="settings-rules-toggle-icon" aria-hidden="true">
                <ChevronDown className="settings-rules-toggle-svg" />
              </span>
            </summary>
            <div className="settings-rules-body">
              <AdminCloudFetchConfigForm
                initialConfig={{
                  ...serializeCloudFetchConfig(cloudConfig),
                  updatedAt: cloudConfig?.updatedAt.toISOString() ?? new Date(0).toISOString(),
                }}
                initialLibraries={libraryRows.map((library) => ({
                  id: library.id,
                  summaryLanguage: library.summaryLanguage,
                  ownerUserId: library.ownerUserId,
                  ownerEmail: library.owner.email,
                  ownerName: library.owner.name,
                  enabled: library.enabled,
                }))}
              />
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
