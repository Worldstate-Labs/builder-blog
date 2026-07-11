import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AdminCloudFetchConfigForm } from "@/components/AdminCloudFetchConfigForm";
import { AdminCloudFetchLog } from "@/components/AdminCloudFetchLog";
import { AdminCloudFetchRunActions } from "@/components/AdminCloudFetchRunActions";
import { AdminCloudLibrariesPanel } from "@/components/AdminCloudLibrariesPanel";
import { AdminCloudLibraryLiveProvider } from "@/components/AdminCloudLibraryLiveProvider";
import { AdminCloudLibraryMaintenancePanel } from "@/components/AdminCloudLibraryMaintenancePanel";
import { PageHeader } from "@/components/PageHeader";
import { getAgentJobRuns } from "@/lib/agent-job-runs";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { serializeCloudFetchRun, serializeCloudWorkerHost } from "@/lib/cloud-fetch-run-log";
import { CLOUD_FETCH_CONFIG_ID, serializeCloudFetchConfig } from "@/lib/cloud-source-config";
import { getCloudLibraryAdminSnapshot } from "@/lib/cloud-library-overview-data";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

export default async function CloudLibraryManagementPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/settings");
  const userId = session.user.id;

  const [tokens, runRows, jobRuns, cloudLibrarySnapshot, cloudConfig] = await Promise.all([
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
    getCloudLibraryAdminSnapshot(),
    prisma.cloudFetchConfig.findUnique({ where: { id: CLOUD_FETCH_CONFIG_ID } }),
  ]);

  const hasMore = runRows.length > PAGE_SIZE;
  const leaseBatches = runRows.slice(0, PAGE_SIZE).map(serializeCloudFetchRun);
  const workerHost = serializeCloudWorkerHost(
    jobRuns.find((job) => job.status === "running" || job.status === "starting") ??
      jobRuns[0] ??
      null,
  );

  return (
    <div className="page-pad page-pad--settings">
      <PageHeader
        title="Cloud library management"
        description="Monitor the long-running worker host, its live post queue, and the source deliveries feeding it."
      />

      <AdminCloudLibraryLiveProvider initialSnapshot={cloudLibrarySnapshot}>
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

          <AdminCloudLibrariesPanel />

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
              />
            </div>
          </details>
        </section>
        </div>
      </AdminCloudLibraryLiveProvider>
    </div>
  );
}
