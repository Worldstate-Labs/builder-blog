// Clear the admin user's crawled posts (FeedItem) and reset each source's
// fetch state, while KEEPING the sources (Builder) themselves and the fetch
// log (LibraryFetchRun). Run:
//   set -a && . ./.env.local && set +a && npx tsx scripts/clear-admin-crawl.mts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const ADMIN_EMAIL = "jie@worldstatelabs.com";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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

  const feedItemCount = await prisma.feedItem.count({
    where: { builderId: { in: builderIds } },
  });
  console.log(`Admin: ${admin.email}`);
  console.log(`Sources (Builder) to KEEP: ${builderIds.length}`);
  console.log(`FeedItem (crawled posts) to delete: ${feedItemCount}`);

  // FeedRead.feedItemId is SetNull and RecommendationSnapshotItem.feedItemId
  // is Cascade (DB-level FKs), so children are handled automatically.
  const deleted = await prisma.feedItem.deleteMany({
    where: { builderId: { in: builderIds } },
  });

  // Reset each kept source's fetch state so the UI count is correct and the
  // next fetch starts clean. Sources and the fetch log are untouched.
  const reset = await prisma.builder.updateMany({
    where: { ownerUserId: admin.id },
    data: {
      itemCount: 0,
      lastFetchedAt: null,
      lastForcedAt: null,
      status: "IDLE",
      lastError: null,
    },
  });

  const remaining = await prisma.feedItem.count({
    where: { builderId: { in: builderIds } },
  });
  console.log("---");
  console.log(`Deleted FeedItem: ${deleted.count}`);
  console.log(`Reset Builder rows: ${reset.count}`);
  console.log(`Remaining FeedItem for admin's sources: ${remaining}`);
  console.log("Sources and fetch log preserved.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
