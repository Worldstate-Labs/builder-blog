// One-time update: push the corrected DigestConfig text defaults
// (digestTopPrompt, digestIntro, translate) into the database. The seeder only
// inserts on first run and never overwrites existing rows, so this script is how
// prompt fixes reach data that was already seeded.
//
// Design-respecting: for each field it reads the OLD value from the default
// ("global") DigestConfig row and refreshes only the per-user copies that still
// hold that untouched value, so any user customization is preserved. Then it
// updates the default row. Idempotent (re-running after it's applied is a no-op).
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/update-digest-config-defaults.mts

import { PrismaClient } from "@prisma/client";
import { DEFAULT_DIGEST_PROMPTS } from "../src/lib/digest-prompts";

const prisma = new PrismaClient();

async function main() {
  const def = await prisma.digestConfig.findUnique({
    where: { id: "global" },
    select: { digestTopPrompt: true, digestIntro: true, translate: true },
  });
  if (!def) {
    console.error('No default DigestConfig ("global") row found — run the config seed first.');
    process.exit(1);
    return;
  }

  if (def.digestTopPrompt !== DEFAULT_DIGEST_PROMPTS.digest) {
    const r = await prisma.userDigestConfig.updateMany({
      where: { digestTopPrompt: def.digestTopPrompt },
      data: { digestTopPrompt: DEFAULT_DIGEST_PROMPTS.digest },
    });
    await prisma.digestConfig.update({
      where: { id: "global" },
      data: { digestTopPrompt: DEFAULT_DIGEST_PROMPTS.digest },
    });
    console.log(`digestTopPrompt: default updated, ${r.count} user copies refreshed.`);
  } else {
    console.log("digestTopPrompt: already up to date.");
  }

  if (def.digestIntro !== DEFAULT_DIGEST_PROMPTS.digestIntro) {
    const r = await prisma.userDigestConfig.updateMany({
      where: { digestIntro: def.digestIntro },
      data: { digestIntro: DEFAULT_DIGEST_PROMPTS.digestIntro },
    });
    await prisma.digestConfig.update({
      where: { id: "global" },
      data: { digestIntro: DEFAULT_DIGEST_PROMPTS.digestIntro },
    });
    console.log(`digestIntro: default updated, ${r.count} user copies refreshed.`);
  } else {
    console.log("digestIntro: already up to date.");
  }

  if (def.translate !== DEFAULT_DIGEST_PROMPTS.translate) {
    const r = await prisma.userDigestConfig.updateMany({
      where: { translate: def.translate },
      data: { translate: DEFAULT_DIGEST_PROMPTS.translate },
    });
    await prisma.digestConfig.update({
      where: { id: "global" },
      data: { translate: DEFAULT_DIGEST_PROMPTS.translate },
    });
    console.log(`translate: default updated, ${r.count} user copies refreshed.`);
  } else {
    console.log("translate: already up to date.");
  }

  console.log("Done. Regenerate today's digest to see the changes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
