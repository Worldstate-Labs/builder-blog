import { prisma } from "../src/lib/prisma";
import { resolveAvatarDataUrl } from "../src/lib/builder-enrichment";
import { resolveSourceAvatar } from "../src/lib/source-avatar-persistence";
import { builderKindForSourceType } from "../src/lib/source-registry";

const batchSize = Math.max(1, Number(process.env.AVATAR_BACKFILL_BATCH_SIZE ?? "100"));
const concurrency = 5;

async function inBatches<T>(rows: T[], work: (row: T) => Promise<void>) {
  for (let index = 0; index < rows.length; index += concurrency) {
    await Promise.all(rows.slice(index, index + concurrency).map(work));
  }
}

type CandidateSource = {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
};

async function backfillCandidates(
  label: string,
  findMany: () => Promise<CandidateSource[]>,
  update: (
    id: string,
    avatarUrl: string | null,
    avatarDataUrl: string | null,
  ) => Promise<unknown>,
) {
  const rows = await findMany();
  let resolved = 0;
  await inBatches(rows, async (row) => {
    const avatar = await resolveSourceAvatar({
      source: {
        ...row,
        kind: builderKindForSourceType(row.sourceType),
      },
      preferredAvatarUrl: row.avatarUrl,
      prismaClient: prisma,
    });
    const avatarDataUrl = avatar.avatarDataUrl ?? await resolveAvatarDataUrl(avatar.avatarUrl);
    if (!avatar.avatarUrl && !avatarDataUrl) return;
    await update(row.id, avatar.avatarUrl, avatarDataUrl);
    resolved += 1;
  });
  console.log(`${label}: resolved ${resolved}/${rows.length}`);
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
  await backfillCandidates(
    "source candidates",
    () => prisma.sourceCandidate.findMany({
      where: { avatarDataUrl: null },
      select: {
        id: true,
        name: true,
        sourceType: true,
        sourceUrl: true,
        fetchUrl: true,
        handle: true,
        avatarUrl: true,
      },
      take: batchSize,
    }),
    (id, avatarUrl, avatarDataUrl) => prisma.sourceCandidate.update({
      where: { id },
      data: { avatarUrl, avatarDataUrl },
    }),
  );
  await backfillCandidates(
    "backup candidates",
    () => prisma.backupSourceCandidate.findMany({
      where: { avatarDataUrl: null },
      select: {
        id: true,
        name: true,
        sourceType: true,
        sourceUrl: true,
        fetchUrl: true,
        handle: true,
        avatarUrl: true,
      },
      take: batchSize,
    }),
    (id, avatarUrl, avatarDataUrl) => prisma.backupSourceCandidate.update({
      where: { id },
      data: { avatarUrl, avatarDataUrl },
    }),
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
