// Seeds admin-editable runtime config that should never be empty:
//   - SourceTypeConfig: one row per source id (x, blog, youtube, etc.)
//   - DigestConfig: the "global" singleton with digest-level prompts.
// Idempotent. Existing rows are preserved so admin hot-edits survive deploys.
import { PrismaClient } from "@prisma/client";
import { ensureSourceConfigsSeeded } from "../src/lib/source-config-seed";

const prisma = new PrismaClient();

async function main() {
  await ensureSourceConfigsSeeded(prisma);
  console.log(
    "Seeded SourceTypeConfig + DigestConfig defaults (existing rows preserved).",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
