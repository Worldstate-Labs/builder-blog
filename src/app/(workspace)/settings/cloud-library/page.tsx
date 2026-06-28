import { redirect } from "next/navigation";
import { AdminCloudFetchLog } from "@/components/AdminCloudFetchLog";
import { AdminCloudFetchRunActions } from "@/components/AdminCloudFetchRunActions";
import { AdminCloudLibraryExplorer } from "@/components/AdminCloudLibraryExplorer";
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
          include: { builder: { select: { name: true, sourceType: true, sourceUrl: true } } },
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
        description="Run the cloud source fetch from your local agent and review each polling round."
      />

      <div className="workspace-content-stack settings-workspace">
        <section className="settings-rules">
          <div className="settings-rules-panel fb-panel">
            <div className="settings-rules-body">
              <h3 className="fb-section-heading">Run cloud fetch</h3>
              <p className="settings-rules-summary-desc">
                Copy a prompt and send it to your local agent. Recurring polling installs a
                schedule that leases and fetches a batch every interval; run-once leases and
                fetches a single batch.
              </p>
              <AdminCloudFetchRunActions activeTokens={tokens} />
            </div>
          </div>
        </section>

        <section className="settings-rules">
          <div className="settings-rules-panel fb-panel">
            <div className="settings-rules-body">
              <h3 className="fb-section-heading">Cloud fetch log</h3>
              <p className="settings-rules-summary-desc">
                Each row is one polling round — a leased batch of cloud source tasks the
                runner fetched and synced. Expand a row to see per-source outcomes.
              </p>
              <AdminCloudFetchLog initialRuns={runs} initialHasMore={hasMore} />
            </div>
          </div>
        </section>

        <section className="settings-rules">
          <div className="settings-rules-panel fb-panel">
            <div className="settings-rules-body">
              <h3 className="fb-section-heading">Cloud libraries</h3>
              <p className="settings-rules-summary-desc">
                Each language library and its sources, with fetch status, how many users
                submitted each source, and how many posts it has fetched. Expand a source to
                see its submitters and recent posts.
              </p>
              <AdminCloudLibraryExplorer libraries={libraries} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
