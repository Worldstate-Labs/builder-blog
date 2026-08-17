import type { PrismaClient } from "@prisma/client";
import { displayLanguagePreference } from "@/lib/language-preference";

export type SourceLibraryMetadata = {
  cadenceLabel: string;
  cadenceState: "active" | "stopped";
  languageLabel: string;
};

export type SourceLibraryMetadataTarget = {
  id: string;
  ownerUserId: string | null;
  builderIds: string[];
};

type SourceLibraryCronJob = {
  status: string;
  frequencyLabel: string | null;
};

type SourceLibraryFeedPreference = {
  summaryLanguage: string | null;
};

type SourceLibraryCloudFetch = {
  frequencyLabel: string;
  summaryLanguage: string;
};

type ResolveSourceLibraryMetadataInput = {
  cronJob?: SourceLibraryCronJob | null;
  feedPreference?: SourceLibraryFeedPreference | null;
  cloudFetch?: SourceLibraryCloudFetch | null;
};

type SourceLibraryMetadataPrisma = Pick<
  PrismaClient,
  "cloudSourceSubmission" | "libraryCronJob" | "userFeedPreference"
>;

function compactCadenceLabel(value: string): string {
  return value.replace(/^every\s+(\d+)\s+hours?$/i, "Every $1 h");
}

export function resolveSourceLibraryMetadata({
  cronJob,
  feedPreference,
  cloudFetch,
}: ResolveSourceLibraryMetadataInput): SourceLibraryMetadata {
  const frequencyLabel = cronJob?.frequencyLabel?.trim() ?? "";
  const hasActiveLocalFetch = cronJob?.status === "active" && frequencyLabel.length > 0;
  const fallbackCloudFetch = hasActiveLocalFetch ? null : cloudFetch;

  return {
    cadenceLabel: hasActiveLocalFetch
      ? compactCadenceLabel(frequencyLabel)
      : fallbackCloudFetch?.frequencyLabel ?? "Stopped",
    cadenceState: hasActiveLocalFetch || fallbackCloudFetch ? "active" : "stopped",
    languageLabel: displayLanguagePreference(
      fallbackCloudFetch?.summaryLanguage ?? feedPreference?.summaryLanguage,
    ),
  };
}

export async function getSourceLibraryMetadataByLibraries(
  libraries: SourceLibraryMetadataTarget[],
  prismaClient?: SourceLibraryMetadataPrisma,
): Promise<Record<string, SourceLibraryMetadata>> {
  if (libraries.length === 0) return {};

  const ownerUserIds = uniqueStrings(libraries.map((library) => library.ownerUserId ?? ""));
  const builderIds = uniqueStrings(libraries.flatMap((library) => library.builderIds));
  const prisma = prismaClient ?? (await getPrismaClient());
  const [cronJobs, feedPreferences, cloudSubmissions] = await Promise.all([
    ownerUserIds.length > 0
      ? prisma.libraryCronJob.findMany({
          where: { userId: { in: ownerUserIds } },
          select: { userId: true, status: true, frequencyLabel: true },
        })
      : [],
    ownerUserIds.length > 0
      ? prisma.userFeedPreference.findMany({
          where: { userId: { in: ownerUserIds } },
          select: { userId: true, summaryLanguage: true },
        })
      : [],
    builderIds.length > 0
      ? prisma.cloudSourceSubmission.findMany({
          where: {
            active: true,
            OR: [
              { userBuilderId: { in: builderIds } },
              { cloudBuilderId: { in: builderIds } },
            ],
            cloudBuilder: { cloudSourceTask: { status: "ACTIVE" } },
          },
          select: {
            userBuilderId: true,
            cloudBuilderId: true,
            submittedAt: true,
            cloudBuilder: {
              select: {
                cloudSourceTask: {
                  select: {
                    status: true,
                    effectiveFrequency: true,
                    summaryLanguage: true,
                  },
                },
              },
            },
          },
        })
      : [],
  ]);

  const cronJobByUserId = new Map(cronJobs.map((cronJob) => [cronJob.userId, cronJob]));
  const feedPreferenceByUserId = new Map(
    feedPreferences.map((feedPreference) => [feedPreference.userId, feedPreference]),
  );

  return Object.fromEntries(
    libraries.map((library) => [
      library.id,
      resolveSourceLibraryMetadata({
        cronJob: library.ownerUserId
          ? cronJobByUserId.get(library.ownerUserId) ?? null
          : null,
        feedPreference: library.ownerUserId
          ? feedPreferenceByUserId.get(library.ownerUserId) ?? null
          : null,
        cloudFetch: summarizeLibraryCloudFetch(library.builderIds, cloudSubmissions),
      }),
    ]),
  );
}

function summarizeLibraryCloudFetch(
  builderIds: string[],
  submissions: Array<{
    userBuilderId: string | null;
    cloudBuilderId: string;
    submittedAt: Date;
    cloudBuilder: {
      cloudSourceTask: {
        status: string;
        effectiveFrequency: string;
        summaryLanguage: string;
      } | null;
    };
  }>,
): SourceLibraryCloudFetch | null {
  const libraryBuilderIds = new Set(builderIds);
  const matches = submissions.filter(
    (submission) =>
      (submission.userBuilderId != null && libraryBuilderIds.has(submission.userBuilderId)) ||
      libraryBuilderIds.has(submission.cloudBuilderId),
  );
  if (matches.length === 0) return null;

  const latest = matches.reduce((mostRecent, submission) =>
    submission.submittedAt > mostRecent.submittedAt ? submission : mostRecent,
  );
  const frequencies = matches.map(
    (submission) => submission.cloudBuilder.cloudSourceTask?.effectiveFrequency,
  );
  const frequencyLabel = frequencies.includes("DAILY")
    ? "Daily"
    : frequencies.includes("WEEKLY")
      ? "Weekly"
      : null;
  const summaryLanguage = latest.cloudBuilder.cloudSourceTask?.summaryLanguage;
  return frequencyLabel && summaryLanguage ? { frequencyLabel, summaryLanguage } : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function getPrismaClient(): Promise<SourceLibraryMetadataPrisma> {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}
