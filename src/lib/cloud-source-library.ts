import { BuilderPoolOrigin, type BuilderKind, type PrismaClient } from "@prisma/client";
import type { CloudFetchFrequency } from "@/lib/cloud-source-contracts";
import { displayLanguagePreference } from "@/lib/language-preference";

const CLOUD_SOURCE_CANDIDATE_SEED = "cloud_source_library";

export type CloudCopyableBuilder = {
  kind: BuilderKind | string;
  sourceType?: string | null;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
  avatarUrl?: string | null;
  avatarDataUrl?: string | null;
  bio?: string | null;
};

type UpsertBuilderForCloudCopy = (params: {
  ownerUserId: string;
  kind: BuilderKind | string;
  sourceType?: string | null;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
  avatarUrl?: string | null;
  avatarDataUrl?: string | null;
  bio?: string | null;
  addedByUserId?: string | null;
}) => Promise<{ id: string }>;

type CloudSourceCandidateBuilder = {
  id: string;
  canonicalKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
};

type CloudSourceCandidatePrisma = {
  builder: {
    findUnique(args: unknown): Promise<CloudSourceCandidateBuilder | null>;
  };
  sourceCandidate: {
    upsert(args: unknown): Promise<unknown>;
  };
};

export class CloudSourceSubmissionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CloudSourceSubmissionError";
    this.status = status;
  }
}

export async function copyBuilderToCloudOwner(params: {
  cloudOwnerUserId: string;
  userBuilder: CloudCopyableBuilder;
  upsert?: UpsertBuilderForCloudCopy;
}) {
  const upsert = params.upsert ?? (await defaultCloudBuilderUpsert());
  return upsert({
    ownerUserId: params.cloudOwnerUserId,
    kind: params.userBuilder.kind,
    sourceType: params.userBuilder.sourceType ?? null,
    name: params.userBuilder.name,
    handle: params.userBuilder.handle ?? null,
    sourceUrl: params.userBuilder.sourceUrl ?? null,
    fetchUrl: params.userBuilder.fetchUrl ?? null,
    avatarUrl: params.userBuilder.avatarUrl ?? null,
    avatarDataUrl: params.userBuilder.avatarDataUrl ?? null,
    bio: params.userBuilder.bio ?? null,
    addedByUserId: null,
  });
}

async function defaultCloudBuilderUpsert(): Promise<UpsertBuilderForCloudCopy> {
  const builders = await import("@/lib/builders");
  return builders.upsertBuilder as UpsertBuilderForCloudCopy;
}

export function effectiveCloudFetchFrequency(frequencies: CloudFetchFrequency[]) {
  if (frequencies.includes("DAILY")) return "DAILY";
  if (frequencies.includes("WEEKLY")) return "WEEKLY";
  return null;
}

export function cloudLanguageLibraryHubName(summaryLanguage: string) {
  return `Community source library - ${displayLanguagePreference(summaryLanguage)}`;
}

export async function resolveCloudLanguageLibrary(params: {
  summaryLanguage: string;
  prisma?: PrismaClient;
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const cloudLibrary = await prisma.cloudLanguageLibrary.findUnique({
    where: { summaryLanguage: params.summaryLanguage },
    select: { id: true, summaryLanguage: true, ownerUserId: true, hubEntryId: true, enabled: true },
  });
  if (!cloudLibrary || !cloudLibrary.enabled) {
    throw new CloudSourceSubmissionError(
      `Cloud source library is not configured for ${params.summaryLanguage}.`,
      404,
    );
  }
  return cloudLibrary;
}

export async function submitUserPrivateLibraryToCloud(params: {
  userId: string;
  frequency: CloudFetchFrequency;
  summaryLanguage: string;
  now?: Date;
  prisma?: PrismaClient;
  copyBuilderUpsert?: UpsertBuilderForCloudCopy;
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const now = params.now ?? new Date();
  const cloudLibrary = await resolveCloudLanguageLibrary({
    summaryLanguage: params.summaryLanguage,
    prisma,
  });
  const privateSources = await prisma.builderPoolEntry.findMany({
    where: {
      userId: params.userId,
      origin: BuilderPoolOrigin.PERSONAL_SYNC,
      removedAt: null,
      builder: { ownerUserId: params.userId },
    },
    include: { builder: true },
    orderBy: { createdAt: "asc" },
  });
  if (privateSources.length === 0) {
    throw new CloudSourceSubmissionError("Add at least one private source before submitting to Cloud.");
  }

  let tasksTouched = 0;
  for (const source of privateSources) {
    const cloudBuilder = await copyBuilderToCloudOwner({
      cloudOwnerUserId: cloudLibrary.ownerUserId,
      userBuilder: source.builder,
      upsert: params.copyBuilderUpsert,
    });
    await prisma.cloudSourceSubmission.upsert({
      where: {
        userId_cloudBuilderId: {
          userId: params.userId,
          cloudBuilderId: cloudBuilder.id,
        },
      },
      update: {
        userBuilderId: source.builderId,
        summaryLanguage: params.summaryLanguage,
        frequency: params.frequency,
        active: true,
      },
      create: {
        userId: params.userId,
        userBuilderId: source.builderId,
        cloudBuilderId: cloudBuilder.id,
        summaryLanguage: params.summaryLanguage,
        frequency: params.frequency,
        active: true,
      },
    });
    const task = await recomputeCloudSourceTask({
      prisma,
      cloudLanguageLibraryId: cloudLibrary.id,
      builderId: cloudBuilder.id,
      summaryLanguage: params.summaryLanguage,
      now,
    });
    if (task) tasksTouched += 1;
  }

  await syncCloudLanguageLibraryHub(params.summaryLanguage, prisma);
  return {
    sourcesSubmitted: privateSources.length,
    tasksSubmitted: tasksTouched,
    frequency: params.frequency,
    summaryLanguage: params.summaryLanguage,
  };
}

export async function recomputeCloudSourceTask(params: {
  prisma: PrismaClient;
  cloudLanguageLibraryId: string;
  builderId: string;
  summaryLanguage: string;
  now: Date;
}) {
  const submissions = await params.prisma.cloudSourceSubmission.findMany({
    where: { cloudBuilderId: params.builderId, active: true },
    select: { frequency: true, submittedAt: true },
  });
  const effectiveFrequency = effectiveCloudFetchFrequency(
    submissions.map((submission) => submission.frequency),
  );
  if (!effectiveFrequency) {
    await params.prisma.cloudSourceTask.updateMany({
      where: { builderId: params.builderId },
      data: { status: "PAUSED" },
    });
    return null;
  }
  const earliestSubmittedAt = submissions.reduce<Date | null>((earliest, submission) => {
    if (!earliest || submission.submittedAt < earliest) return submission.submittedAt;
    return earliest;
  }, null);
  const mustSucceedBy = new Date(
    (earliestSubmittedAt ?? params.now).getTime() + cloudFrequencyIntervalMs(effectiveFrequency),
  );
  return params.prisma.cloudSourceTask.upsert({
    where: { builderId: params.builderId },
    update: {
      cloudLanguageLibraryId: params.cloudLanguageLibraryId,
      summaryLanguage: params.summaryLanguage,
      effectiveFrequency,
      status: "ACTIVE",
    },
    create: {
      cloudLanguageLibraryId: params.cloudLanguageLibraryId,
      builderId: params.builderId,
      summaryLanguage: params.summaryLanguage,
      effectiveFrequency,
      status: "ACTIVE",
      nextAttemptAt: params.now,
      mustSucceedBy,
    },
  });
}

export async function syncCloudLanguageLibraryHub(
  summaryLanguage: string,
  prismaClient?: PrismaClient,
) {
  const prisma = prismaClient ?? (await getPrismaClient());
  const cloudLibrary = await resolveCloudLanguageLibrary({ summaryLanguage, prisma });
  const libraryHub = await import("@/lib/library-hub");
  const result = await libraryHub.sharePersonalLibraryToHub({
    userId: cloudLibrary.ownerUserId,
    name: cloudLanguageLibraryHubName(summaryLanguage),
    description: `Cloud source library for ${displayLanguagePreference(summaryLanguage)} summaries.`,
    prismaClient: prisma,
  });
  await prisma.cloudLanguageLibrary.update({
    where: { id: cloudLibrary.id },
    data: { hubEntryId: result.entry.id },
  });
  return result;
}

export async function upsertSourceCandidateFromCloudBuilder(
  builderId: string,
  prismaClient?: CloudSourceCandidatePrisma,
) {
  const prisma = prismaClient ?? (await getPrismaClient());
  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: {
      id: true,
      canonicalKey: true,
      name: true,
      sourceType: true,
      sourceUrl: true,
      fetchUrl: true,
      handle: true,
      avatarUrl: true,
      avatarDataUrl: true,
    },
  });
  if (!builder) {
    throw new CloudSourceSubmissionError(`Cloud source builder ${builderId} was not found.`, 404);
  }
  const seed = {
    sourceKey: builder.canonicalKey,
    name: builder.name,
    sourceType: builder.sourceType,
    sourceUrl: builder.sourceUrl,
    fetchUrl: builder.fetchUrl,
    handle: builder.handle,
    avatarUrl: builder.avatarUrl,
    avatarDataUrl: builder.avatarDataUrl,
    seedBuilderId: builder.id,
    seededFrom: CLOUD_SOURCE_CANDIDATE_SEED,
  };
  return prisma.sourceCandidate.upsert({
    where: { sourceKey: seed.sourceKey },
    update: {
      name: seed.name,
      sourceType: seed.sourceType,
      sourceUrl: seed.sourceUrl,
      fetchUrl: seed.fetchUrl,
      handle: seed.handle,
      avatarUrl: seed.avatarUrl,
      avatarDataUrl: seed.avatarDataUrl,
      seedBuilderId: seed.seedBuilderId,
      seededFrom: seed.seededFrom,
    },
    create: seed,
  });
}

async function getPrismaClient() {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

function cloudFrequencyIntervalMs(frequency: CloudFetchFrequency) {
  return frequency === "DAILY" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}
