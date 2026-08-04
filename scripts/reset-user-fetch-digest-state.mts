// One-account maintenance reset. An explicit user ID or email is mandatory.
//
// Run:
//   npx tsx --env-file-if-exists=.env --env-file-if-exists=.env.local \
//     scripts/reset-user-fetch-digest-state.mts --email person@example.com
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  parseUserResetTarget,
  resolveUserResetTarget,
} from "../src/lib/user-generated-data-reset-target";

async function main() {
  const target = parseUserResetTarget(process.argv.slice(2));
  const [{ prisma }, { resetUserFetchDigestState }, { generatedDataResetSummary }] =
    await Promise.all([
      import("../src/lib/prisma"),
      import("../src/lib/fetch-digest-reset"),
      import("../src/lib/generated-data-reset-summary"),
    ]);

  try {
    const userId = await resolveUserResetTarget(target, prisma);
    const summary = await resetUserFetchDigestState(userId, prisma);

    console.log(generatedDataResetSummary(summary));
    console.log(`Deleted ${summary.deletedDigestedItems} inclusion markers.`);
    console.log(`Deleted ${summary.deletedRecommendationSnapshots} recommendation snapshots.`);
  } finally {
    await prisma.$disconnect();
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
