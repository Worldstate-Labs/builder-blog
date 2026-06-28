// Backfill the configured cloud language owner from the currently featured
// community source library. Defaults to dry-run; pass --apply to write.
//
// Run:
//   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-cloud-language-library-from-admin-library.mts --language zh
//   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-cloud-language-library-from-admin-library.mts --language zh --apply
import { prisma } from "../src/lib/prisma";
import {
  copyBuilderToCloudOwner,
  recomputeCloudSourceTask,
  syncCloudLanguageLibraryHub,
} from "../src/lib/cloud-source-library";

function argValue(name: string, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : fallback;
}

async function main() {
  const summaryLanguage = argValue("--language", "zh").trim() || "zh";
  const apply = process.argv.includes("--apply");
  const createTasks = process.argv.includes("--create-tasks");
  const dryRun = !apply;
  const now = new Date();

  const hubEntry = await prisma.libraryHubEntry.findFirst({
    where: { isFeatured: true },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { email: true } },
      items: {
        include: {
          builder: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!hubEntry) {
    throw new Error("No featured admin/community source library was found.");
  }

  const cloudLibrary = await prisma.cloudLanguageLibrary.findUnique({
    where: { summaryLanguage },
    select: { id: true, summaryLanguage: true, ownerUserId: true, enabled: true },
  });
  if (!cloudLibrary || !cloudLibrary.enabled) {
    throw new Error(`Cloud language library is not configured or enabled for ${summaryLanguage}.`);
  }

  const plannedSources = hubEntry.items.map((item) => ({
    builderId: item.builderId,
    name: item.builder.name,
    sourceType: item.builder.sourceType,
    sourceUrl: item.builder.sourceUrl ?? item.builder.fetchUrl ?? item.builder.handle ?? null,
  }));

  let copiedSources = 0;
  let tasksTouched = 0;
  if (!dryRun) {
    for (const item of hubEntry.items) {
      const cloudBuilder = await copyBuilderToCloudOwner({
        cloudOwnerUserId: cloudLibrary.ownerUserId,
        userBuilder: item.builder,
      });
      copiedSources += 1;

      if (createTasks) {
        const task = await recomputeCloudSourceTask({
          prisma,
          cloudLanguageLibraryId: cloudLibrary.id,
          builderId: cloudBuilder.id,
          summaryLanguage,
          now,
        });
        if (task) tasksTouched += 1;
      }
    }
    await syncCloudLanguageLibraryHub(summaryLanguage, prisma);
  }

  console.log(JSON.stringify(
    {
      status: "ok",
      dryRun,
      apply,
      createTasks,
      summaryLanguage,
      featuredHubEntry: {
        id: hubEntry.id,
        name: hubEntry.name,
        ownerEmail: hubEntry.owner?.email ?? null,
        sources: hubEntry.items.length,
      },
      cloudLanguageLibrary: {
        id: cloudLibrary.id,
        ownerUserId: cloudLibrary.ownerUserId,
      },
      plannedSources,
      copiedSources,
      tasksTouched,
      note: dryRun
        ? "Dry run only. Re-run with --apply to copy sources."
        : "Backfill applied.",
    },
    null,
    2,
  ));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
