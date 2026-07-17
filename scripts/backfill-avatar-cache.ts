import { prisma } from "../src/lib/prisma";
import { resolveAvatarDataUrl } from "../src/lib/builder-enrichment";
import { resolveSourceAvatar } from "../src/lib/source-avatar-persistence";

const batchSize = Math.max(1, Number(process.env.AVATAR_BACKFILL_BATCH_SIZE ?? "100"));
const concurrency = 5;

async function inBatches<T>(rows: T[], work: (row: T) => Promise<void>) {
  for (let index = 0; index < rows.length; index += concurrency) {
    await Promise.all(rows.slice(index, index + concurrency).map(work));
  }
}

async function backfillModel(
  label: string,
  findMany: () => Promise<Array<{ id: string; avatarUrl: string | null }>>,
  update: (id: string, avatarDataUrl: string) => Promise<unknown>,
) {
  const rows = await findMany();
  let updated = 0;
  await inBatches(rows, async (row) => {
    const avatarDataUrl = await resolveAvatarDataUrl(row.avatarUrl);
    if (!avatarDataUrl) return;
    await update(row.id, avatarDataUrl);
    updated += 1;
  });
  console.log(`${label}: cached ${updated}/${rows.length}`);
}

async function main() {
  const builders = await prisma.builder.findMany({
    where: { avatarDataUrl: null },
    select: {
      id: true,
      kind: true,
      name: true,
      sourceType: true,
      handle: true,
      sourceUrl: true,
      fetchUrl: true,
      avatarUrl: true,
    },
    take: batchSize,
  });
  let updatedBuilders = 0;
  await inBatches(builders, async (builder) => {
    const avatar = await resolveSourceAvatar({
      source: builder,
      preferredAvatarUrl: builder.avatarUrl,
      probeWhenMissing: true,
      prismaClient: prisma,
    });
    const avatarDataUrl = avatar.avatarDataUrl ?? await resolveAvatarDataUrl(avatar.avatarUrl);
    if (!avatarDataUrl) return;
    await prisma.builder.update({
      where: { id: builder.id },
      data: { avatarUrl: avatar.avatarUrl, avatarDataUrl },
    });
    updatedBuilders += 1;
  });
  console.log(`builders: cached ${updatedBuilders}/${builders.length}`);
  await backfillModel(
    "source candidates",
    () => prisma.sourceCandidate.findMany({
      where: { avatarUrl: { not: null }, avatarDataUrl: null },
      select: { id: true, avatarUrl: true },
      take: batchSize,
    }),
    (id, avatarDataUrl) => prisma.sourceCandidate.update({ where: { id }, data: { avatarDataUrl } }),
  );
  await backfillModel(
    "backup candidates",
    () => prisma.backupSourceCandidate.findMany({
      where: { avatarUrl: { not: null }, avatarDataUrl: null },
      select: { id: true, avatarUrl: true },
      take: batchSize,
    }),
    (id, avatarDataUrl) => prisma.backupSourceCandidate.update({ where: { id }, data: { avatarDataUrl } }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
