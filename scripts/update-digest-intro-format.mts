// One-time update: push the corrected `digestIntro` (which now spells out the
// exact Markdown structure the web app parses — `## section` / `### source` /
// `**title**`) into the database. The seeder only inserts on first run and
// never overwrites existing rows, so this script is how the fix reaches data
// that was already seeded.
//
// Design-respecting: it reads the OLD default text from the DB and refreshes
// only the per-user copies that still hold that untouched value, so any user
// who customized their own digestIntro keeps theirs. Idempotent (re-running
// after it's applied is a no-op).
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/update-digest-intro-format.mts

import { PrismaClient } from "@prisma/client";
import { DEFAULT_DIGEST_PROMPTS } from "../src/lib/digest-prompts";

const prisma = new PrismaClient();
const NEW = DEFAULT_DIGEST_PROMPTS.digestIntro;

async function main() {
  const current = await prisma.digestConfig.findUnique({
    where: { id: "global" },
    select: { digestIntro: true },
  });
  if (!current) {
    console.error('No default DigestConfig ("global") row found — run the config seed first.');
    process.exit(1);
    return;
  }
  const OLD = current.digestIntro;
  if (OLD === NEW) {
    console.log("Default digestIntro already up to date; nothing to do.");
    return;
  }

  // Refresh only the per-user copies still on the untouched old default.
  const refreshed = await prisma.userDigestConfig.updateMany({
    where: { digestIntro: OLD },
    data: { digestIntro: NEW },
  });

  // Update the default template last.
  await prisma.digestConfig.update({
    where: { id: "global" },
    data: { digestIntro: NEW },
  });

  console.log(
    `Default digestIntro updated. Per-user copies refreshed: ${refreshed.count}. ` +
      `Regenerate today's digest to see the corrected title rendering.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
