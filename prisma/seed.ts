// Seeds admin-editable runtime config that should never be empty:
//   - SourceTypeConfig: one row per source id (x, blog, youtube, etc.)
//   - DigestConfig: the "global" singleton with digest-level prompts.
// Idempotent. Existing rows are preserved so admin hot-edits survive deploys.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ensureSourceConfigsSeeded } from "../src/lib/source-config-seed";

// Prisma 7 requires a driver adapter. Mirror src/lib/prisma.ts. Prefer
// the direct (unpooled) URL for seeding when present.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL (or DIRECT_URL) is required to seed.");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

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
