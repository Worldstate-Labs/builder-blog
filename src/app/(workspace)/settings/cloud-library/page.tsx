import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AdminCloudFetchLog } from "@/components/AdminCloudFetchLog";
import { AdminCloudFetchRunActions } from "@/components/AdminCloudFetchRunActions";
import { AdminCloudLibraryExplorer } from "@/components/AdminCloudLibraryExplorer";
import { CountMeta } from "@/components/Count";
import { PageHeader } from "@/components/PageHeader";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { serializeCloudFetchRun } from "@/lib/cloud-fetch-run-log";
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

  const [tokens, runRows, libraryRows] = await Promise.all([
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
    prisma.cloudLanguageLibrary.findMany({
      orderBy: { summaryLanguage: "asc" },
      include: {
        owner: { select: { email: true } },
        sourceTasks: {
          orderBy: { id: "asc" },
          include: {
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
  ]);

  const hasMore = runRows.length > PAGE_SIZE;
  const runs = runRows.slice(0, PAGE_SIZE).map(serializeCloudFetchRun);

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
  const libraries = libraryRows.map((library) =>
    serializeCloudLibrary(
      library,
      library.sourceTasks.map((task) =>
        serializeCloudLibrarySource(task, {
          submitterCount: submitterCountByBuilder.get(task.builderId) ?? 0,
          postCount: postCountByBuilder.get(task.builderId) ?? 0,
        }),
      ),
    ),
  );

  return (
    <div className="page-pad page-pad--settings">
      <PageHeader
        title="Cloud library management"
        description="Trigger the cloud source fetch from your local agent, review each polling round, and inspect every cloud library's sources."
      />

      <div className="workspace-content-stack settings-workspace">
        <section className="settings-rules">
          <details className="settings-rules-panel fb-panel" open>
            <summary className="settings-rules-summary">
              <div className="settings-rules-summary-copy">
                <h3 className="fb-section-heading">Run cloud fetch</h3>
                <p className="settings-rules-summary-desc">
                  Pick a frequency, copy the prompt, and send it to your local agent. The agent
                  authenticates as you and runs the cloud fetch — once, or on a recurring schedule.
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
                <h3 className="fb-section-heading">Cloud fetch log</h3>
                <p className="settings-rules-summary-desc">
                  Each entry is one polling round — a leased batch of cloud source tasks. Expand an
                  entry to see per-source outcomes.
                </p>
              </div>
              <span className="settings-rules-toggle-icon" aria-hidden="true">
                <ChevronDown className="settings-rules-toggle-svg" />
              </span>
            </summary>
            <div className="settings-rules-body">
              <AdminCloudFetchLog initialRuns={runs} initialHasMore={hasMore} />
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
        </section>
      </div>
    </div>
  );
}
