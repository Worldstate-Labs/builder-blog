import type { PrismaClient } from "@prisma/client";
import { displayLanguagePreference } from "@/lib/language-preference";

export type SourceLibraryMetadata = {
  cadenceLabel: string;
  cadenceState: "active" | "stopped";
  languageLabel: string;
};

type SourceLibraryCronJob = {
  status: string;
  frequencyLabel: string | null;
};

type SourceLibraryFeedPreference = {
  summaryLanguage: string | null;
};

type ResolveSourceLibraryMetadataInput = {
  cronJob?: SourceLibraryCronJob | null;
  feedPreference?: SourceLibraryFeedPreference | null;
};

type SourceLibraryMetadataPrisma = Pick<
  PrismaClient,
  "libraryCronJob" | "userFeedPreference"
>;

export function resolveSourceLibraryMetadata({
  cronJob,
  feedPreference,
}: ResolveSourceLibraryMetadataInput): SourceLibraryMetadata {
  const frequencyLabel = cronJob?.frequencyLabel?.trim() ?? "";
  const isActive = cronJob?.status === "active" && frequencyLabel.length > 0;

  return {
    cadenceLabel: isActive ? frequencyLabel : "Stopped",
    cadenceState: isActive ? "active" : "stopped",
    languageLabel: displayLanguagePreference(feedPreference?.summaryLanguage),
  };
}

export async function getSourceLibraryMetadataByOwnerIds(
  ownerUserIds: string[],
  prismaClient?: SourceLibraryMetadataPrisma,
): Promise<Record<string, SourceLibraryMetadata>> {
  const uniqueOwnerIds = [...new Set(ownerUserIds.map((value) => value.trim()).filter(Boolean))];
  if (uniqueOwnerIds.length === 0) {
    return {};
  }

  const prisma = prismaClient ?? (await getPrismaClient());
  const [cronJobs, feedPreferences] = await Promise.all([
    prisma.libraryCronJob.findMany({
      where: { userId: { in: uniqueOwnerIds } },
      select: { userId: true, status: true, frequencyLabel: true },
    }),
    prisma.userFeedPreference.findMany({
      where: { userId: { in: uniqueOwnerIds } },
      select: { userId: true, summaryLanguage: true },
    }),
  ]);

  const cronJobByUserId = new Map(cronJobs.map((cronJob) => [cronJob.userId, cronJob]));
  const feedPreferenceByUserId = new Map(
    feedPreferences.map((feedPreference) => [feedPreference.userId, feedPreference]),
  );

  const metadataByOwnerId = new Map(
    uniqueOwnerIds.map((ownerUserId) => [
      ownerUserId,
      resolveSourceLibraryMetadata({
        cronJob: cronJobByUserId.get(ownerUserId) ?? null,
        feedPreference: feedPreferenceByUserId.get(ownerUserId) ?? null,
      }),
    ]),
  );

  return Object.fromEntries(metadataByOwnerId);
}

async function getPrismaClient(): Promise<SourceLibraryMetadataPrisma> {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}
