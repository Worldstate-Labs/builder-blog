// One-off maintenance: clear the admin user's crawled posts (FeedItem)
// and fetch log (LibraryFetchRun) while KEEPING their sources (Builder).
// Builders are reset to a pristine pre-fetch state so a fresh fetch run
// re-populates cleanly. Run: tsx scripts/clear-admin-library.mts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const ADMIN_EMAIL = "jie@worldstatelabs.com";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error(`Admin user not found: ${ADMIN_EMAIL}`);

  const builders = await prisma.builder.findMany({
    where: { ownerUserId: admin.id },
    select: { id: true },
  });
  const builderIds = builders.map((b) => b.id);

  const [feedItemCount, fetchRunCount, jobRunCount] = await Promise.all([
    prisma.feedItem.count({ where: { builderId: { in: builderIds } } }),
    prisma.libraryFetchRun.count({ where: { userId: admin.id } }),
    prisma.agentJobRun.count({ where: { userId: admin.id, jobType: "library-fetch" } }),
  ]);

  console.log(`Admin: ${admin.email} (${admin.id})`);
  console.log(`Sources (Builder) to KEEP: ${builderIds.length}`);
  console.log(`FeedItem (crawled posts) to delete: ${feedItemCount}`);
  console.log(`LibraryFetchRun (fetch log) to delete: ${fetchRunCount}`);
  console.log(`AgentJobRun library-fetch (runtime job records) to delete: ${jobRunCount}`);

  // 1. Delete crawled posts. FeedRead.feedItemId is SetNull and
  //    RecommendationSnapshotItem.feedItemId is Cascade (DB-level FKs),
  //    so children are handled automatically.
  const deletedItems = await prisma.feedItem.deleteMany({
    where: { builderId: { in: builderIds } },
  });

  // 2. Delete the fetch log rows for this user. This covers both the
    //    LibraryFetchRun rows (RunCard entries) and the AgentJobRun
    //    library-fetch records (JobRunCard entries, e.g. "Runtime exited
    //    with code 1." failures) so the fetch log panel clears fully.
  const deletedRuns = await prisma.libraryFetchRun.deleteMany({
    where: { userId: admin.id },
  });
  const deletedJobRuns = await prisma.agentJobRun.deleteMany({
    where: { userId: admin.id, jobType: "library-fetch" },
  });

  // 3. Reset each kept Builder to a pristine pre-fetch state so the
  //    next fetch run starts clean (no stale lastFetchedAt window,
  //    itemCount back to 0, status IDLE, lastError cleared).
  const resetBuilders = await prisma.builder.updateMany({
    where: { ownerUserId: admin.id },
    data: {
      itemCount: 0,
      lastFetchedAt: null,
      lastForcedAt: null,
      status: "IDLE",
      lastError: null,
    },
  });

  console.log("---");
  console.log(`Deleted FeedItem: ${deletedItems.count}`);
  console.log(`Deleted LibraryFetchRun: ${deletedRuns.count}`);
  console.log(`Deleted AgentJobRun (library-fetch): ${deletedJobRuns.count}`);
  console.log(`Reset Builder rows: ${resetBuilders.count}`);
  console.log("Sources preserved. Ready for a fresh fetch run.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
