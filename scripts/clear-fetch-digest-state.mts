// One-off maintenance: clear generated fetch and AI Digest state for every user
// while keeping users, sources, subscriptions, reads, and favorites.
//
// Run:
//   set -a && . ./.env.local && set +a && npx tsx scripts/clear-fetch-digest-state.mts
import { prisma } from "../src/lib/prisma";
import { resetFetchDigestState } from "../src/lib/fetch-digest-reset";

async function main() {
  const summary = await resetFetchDigestState(prisma);

  console.log("Reset generated fetch and AI Digest state for all users.");
  console.log(`Users: ${summary.users}`);
  console.log(`Sources reset: ${summary.resetBuilders}`);
  console.log(`Deleted FeedItem posts: ${summary.deletedFeedItems}`);
  console.log(`Deleted LibraryFetchRun logs: ${summary.deletedLibraryFetchRuns}`);
  console.log(`Deleted Digest issues: ${summary.deletedDigests}`);
  console.log(`Deleted DigestRun logs: ${summary.deletedDigestRuns}`);
  console.log(`Deleted DigestedItem markers: ${summary.deletedDigestedItems}`);
  console.log(`Deleted AgentJobRun records: ${summary.deletedAgentJobRuns}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
