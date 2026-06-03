// One-time update: push the corrected DigestConfig text defaults
// into the database. The seeder only
// inserts on first run and never overwrites existing rows, so this script is how
// prompt fixes reach data that was already seeded.
//
// Design-respecting: for each field it reads the OLD value from the default
// ("global") DigestConfig row and refreshes only the per-user copies that still
// hold that untouched value, so any user customization is preserved. Then it
// updates the default row. Idempotent (re-running after it's applied is a no-op).
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/update-digest-config-defaults.mts

import { prisma } from "../src/lib/prisma";
import { DEFAULT_DIGEST_PROMPTS } from "../src/lib/digest-prompts";

async function main() {
  const def = await prisma.digestConfig.findUnique({
    where: { id: "global" },
    select: {
      digestIntro: true,
      headlinePrompt: true,
      perSourceSummaryPrompt: true,
      translate: true,
    },
  });
  if (!def) {
    console.error('No default DigestConfig ("global") row found — run the config seed first.');
    process.exit(1);
    return;
  }

  await refreshField("digestIntro", def.digestIntro, DEFAULT_DIGEST_PROMPTS.digestIntro);
  await refreshField("headlinePrompt", def.headlinePrompt, DEFAULT_DIGEST_PROMPTS.headline);
  await refreshField(
    "perSourceSummaryPrompt",
    def.perSourceSummaryPrompt,
    DEFAULT_DIGEST_PROMPTS.perSourceSummary,
  );
  await refreshField("translate", def.translate, DEFAULT_DIGEST_PROMPTS.translate);

  console.log("Done. Regenerate today's digest to see the changes.");
}

async function refreshField(
  field: "digestIntro" | "headlinePrompt" | "perSourceSummaryPrompt" | "translate",
  oldValue: string,
  newValue: string,
) {
  if (oldValue !== newValue) {
    const r = await prisma.userDigestConfig.updateMany({
      where: { [field]: oldValue },
      data: { [field]: newValue },
    });
    await prisma.digestConfig.update({
      where: { id: "global" },
      data: { [field]: newValue },
    });
    console.log(`${field}: default updated, ${r.count} user copies refreshed.`);
  } else {
    console.log(`${field}: already up to date.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
