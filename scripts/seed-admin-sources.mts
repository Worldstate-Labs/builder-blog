// Recreate the admin user's library sources on a fresh database after
// the Prisma→Neon migration. Reuses the exact production logic the Add
// Source API uses (resolve → upsert → pool → subscribe) so the rows are
// identical to what the UI would create. Idempotent.
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/seed-admin-sources.mts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BuilderPoolOrigin } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { resolvePersonalBuilderInput } from "../src/lib/personal-builder-input";
import { upsertBuilder } from "../src/lib/builders";
import { addBuilderToPool } from "../src/lib/builder-pool";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(here, "admin-sources.json"), "utf8"),
) as { adminEmail: string; sources: { sourceType: string; sourceValue: string }[] };

async function main() {
  // Ensure the admin user exists. Google email-linking is enabled, so a
  // later OAuth sign-in attaches to this row by email instead of making
  // a duplicate.
  const admin = await prisma.user.upsert({
    where: { email: config.adminEmail },
    update: {},
    create: { email: config.adminEmail, name: "jie", emailVerified: new Date() },
    select: { id: true, email: true },
  });
  console.log(`Admin user: ${admin.email} (${admin.id})`);

  let created = 0;
  let skipped = 0;
  for (const src of config.sources) {
    const resolution = await resolvePersonalBuilderInput({
      displayName: "",
      sourceType: src.sourceType,
      sourceValue: src.sourceValue,
    });
    if (!resolution.ok) {
      console.warn(`  SKIP ${src.sourceValue} — ${resolution.reason}`);
      skipped++;
      continue;
    }
    const input = resolution.value;
    const builder = await upsertBuilder({
      ownerUserId: admin.id,
      addedByUserId: admin.id,
      ...input,
    });
    await addBuilderToPool({
      userId: admin.id,
      builderId: builder.id,
      origin: BuilderPoolOrigin.PERSONAL_SYNC,
    });
    // Default-follow, mirroring POST /api/builders/personal.
    await prisma.subscription.upsert({
      where: { userId_builderId: { userId: admin.id, builderId: builder.id } },
      update: {},
      create: { userId: admin.id, builderId: builder.id },
    });
    if (builder.entityId) {
      await prisma.userChannelPreference.upsert({
        where: { userId_entityId: { userId: admin.id, entityId: builder.entityId } },
        update: {},
        create: {
          userId: admin.id,
          entityId: builder.entityId,
          primaryBuilderId: builder.id,
          pinnedByUser: false,
        },
      });
    }
    console.log(`  OK  ${input.kind.padEnd(8)} ${builder.name}  <${input.sourceUrl ?? input.fetchUrl ?? src.sourceValue}>`);
    created++;
  }

  const total = await prisma.builder.count({ where: { ownerUserId: admin.id } });
  console.log(`---\nCreated/updated: ${created}, skipped: ${skipped}`);
  console.log(`Admin now owns ${total} sources, all subscribed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
