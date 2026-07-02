import { BuilderPoolOrigin, type BuilderKind, type PrismaClient } from "@prisma/client";
import { builderLibraryKey } from "@/lib/builder-keys";
import type { CloudFetchFrequency } from "@/lib/cloud-source-contracts";
import { cancelQueuedCloudFetchForTasks } from "@/lib/cloud-source-scheduler";
import {
  displayLanguagePreference,
  normalizeSummaryLanguagePreference,
} from "@/lib/language-preference";

const CLOUD_SOURCE_CANDIDATE_SEED = "cloud_source_library";
const CLOUD_SYSTEM_USER_EMAIL_DOMAIN = "followbrief.system";

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

export type CloudSubmissionSummary = {
  hasActiveSubmission: boolean;
  activeSourceCount: number;
  summaryLanguage: string | null;
  frequency: CloudFetchFrequency | null;
  lastSubmittedAt: Date | null;
};

type CloudSubmissionSummaryPrisma = {
  cloudSourceSubmission: {
    findMany(args: unknown): Promise<
      { summaryLanguage: string; frequency: CloudFetchFrequency; submittedAt: Date }[]
    >;
  };
};

// Decide which prior active submissions a new submission supersedes. A user has
// one logical cloud submission, so anything not in the new set is deactivated —
// including every old-language submission when the user switches language.
export function planSubmissionReconciliation(params: {
  existingActive: { id: string; cloudBuilderId: string }[];
  keepCloudBuilderIds: string[];
}) {
  const keep = new Set(params.keepCloudBuilderIds);
  const superseded = params.existingActive.filter(
    (submission) => !keep.has(submission.cloudBuilderId),
  );
  const staleCloudBuilderIds = [
    ...new Set(superseded.map((submission) => submission.cloudBuilderId)),
  ];
  return {
    deactivateSubmissionIds: superseded.map((submission) => submission.id),
    staleCloudBuilderIds,
  };
}

// Aggregate a user's active submissions into the single submission the UI shows
// before letting the user overwrite it.
export function summarizeActiveCloudSubmissions(
  rows: { summaryLanguage: string; frequency: CloudFetchFrequency; submittedAt: Date }[],
): CloudSubmissionSummary {
  if (rows.length === 0) {
    return {
      hasActiveSubmission: false,
      activeSourceCount: 0,
      summaryLanguage: null,
      frequency: null,
      lastSubmittedAt: null,
    };
  }
  const mostRecent = rows.reduce((latest, row) =>
    row.submittedAt > latest.submittedAt ? row : latest,
  );
  return {
    hasActiveSubmission: true,
    activeSourceCount: rows.length,
    summaryLanguage: mostRecent.summaryLanguage,
    frequency: effectiveCloudFetchFrequency(rows.map((row) => row.frequency)),
    lastSubmittedAt: mostRecent.submittedAt,
  };
}

export async function getUserCloudSubmissionSummary(params: {
  userId: string;
  prisma?: CloudSubmissionSummaryPrisma;
}): Promise<CloudSubmissionSummary> {
  const prisma = params.prisma ?? (await getPrismaClient());
  const rows = await prisma.cloudSourceSubmission.findMany({
    where: { userId: params.userId, active: true },
    select: { summaryLanguage: true, frequency: true, submittedAt: true },
  });
  return summarizeActiveCloudSubmissions(rows);
}

export function cloudLanguageLibraryHubName(summaryLanguage: string) {
  return `Community source library - ${displayLanguagePreference(summaryLanguage)}`;
}

function cloudLanguageSystemSlug(summaryLanguage: string) {
  const normalized = normalizeSummaryLanguagePreference(summaryLanguage).toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "default";
}

export function cloudLanguageSystemUserEmail(summaryLanguage: string) {
  return `cloud-source-${cloudLanguageSystemSlug(summaryLanguage)}@${CLOUD_SYSTEM_USER_EMAIL_DOMAIN}`;
}

export function cloudLanguageSystemUserName(summaryLanguage: string) {
  return `FollowBrief Cloud - ${displayLanguagePreference(summaryLanguage)}`;
}

export async function ensureCloudLanguageSystemUser(params: {
  summaryLanguage: string;
  prisma?: PrismaClient;
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const email = cloudLanguageSystemUserEmail(params.summaryLanguage);
  const name = cloudLanguageSystemUserName(params.summaryLanguage);
  return prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name },
    select: { id: true, email: true, name: true },
  });
}

export async function reassignCloudLanguageTaskBuildersToOwner(params: {
  prisma: PrismaClient;
  cloudLanguageLibraryId: string;
  ownerUserId: string;
}) {
  const tasks = await params.prisma.cloudSourceTask.findMany({
    where: { cloudLanguageLibraryId: params.cloudLanguageLibraryId },
    select: {
      builder: {
        select: {
          id: true,
          canonicalKey: true,
          ownerUserId: true,
        },
      },
    },
  });
  const buildersById = new Map<string, { id: string; canonicalKey: string; ownerUserId: string }>();
  for (const task of tasks) {
    if (!task.builder) continue;
    buildersById.set(task.builder.id, task.builder);
  }

  let updatedBuilders = 0;
  for (const builder of buildersById.values()) {
    if (builder.ownerUserId === params.ownerUserId) continue;
    await params.prisma.builder.update({
      where: { id: builder.id },
      data: {
        ownerUserId: params.ownerUserId,
        libraryKey: builderLibraryKey({
          ownerUserId: params.ownerUserId,
          canonicalKey: builder.canonicalKey,
        }),
      },
    });
    updatedBuilders += 1;
  }
  return { updatedBuilders };
}

export async function upsertCloudLanguageLibraryWithSystemOwner(params: {
  summaryLanguage: string;
  enabled: boolean;
  prisma?: PrismaClient;
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const owner = await ensureCloudLanguageSystemUser({
    summaryLanguage: params.summaryLanguage,
    prisma,
  });
  const library = await prisma.cloudLanguageLibrary.upsert({
    where: { summaryLanguage: params.summaryLanguage },
    update: {
      ownerUserId: owner.id,
      enabled: params.enabled,
    },
    create: {
      summaryLanguage: params.summaryLanguage,
      ownerUserId: owner.id,
      enabled: params.enabled,
    },
    include: {
      owner: { select: { id: true, email: true, name: true } },
      hubEntry: { select: { id: true, slug: true, name: true } },
    },
  });
  await reassignCloudLanguageTaskBuildersToOwner({
    prisma,
    cloudLanguageLibraryId: library.id,
    ownerUserId: owner.id,
  });
  if (!params.enabled) return library;

  await syncCloudLanguageLibraryHub(params.summaryLanguage, prisma);
  const refreshed = await prisma.cloudLanguageLibrary.findUnique({
    where: { id: library.id },
    include: {
      owner: { select: { id: true, email: true, name: true } },
      hubEntry: { select: { id: true, slug: true, name: true } },
    },
  });
  return refreshed ?? library;
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

async function ensureCloudLanguageLibraryForSubmission(params: {
  summaryLanguage: string;
  prisma: PrismaClient;
}) {
  return upsertCloudLanguageLibraryWithSystemOwner({
    summaryLanguage: params.summaryLanguage,
    enabled: true,
    prisma: params.prisma,
  });
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
  const cloudLibrary = await ensureCloudLanguageLibraryForSubmission({
    summaryLanguage: params.summaryLanguage,
    prisma,
  });

  // Snapshot the user's prior active submissions before activating the new set,
  // so we can cancel whatever the new submission does not include.
  const existingActive = await prisma.cloudSourceSubmission.findMany({
    where: { userId: params.userId, active: true },
    select: { id: true, cloudBuilderId: true },
  });

  let tasksTouched = 0;
  const keepCloudBuilderIds: string[] = [];
  for (const source of privateSources) {
    const cloudBuilder = await copyBuilderToCloudOwner({
      cloudOwnerUserId: cloudLibrary.ownerUserId,
      userBuilder: source.builder,
      upsert: params.copyBuilderUpsert,
    });
    keepCloudBuilderIds.push(cloudBuilder.id);
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

  // Reconcile to a single active submission per user: deactivate every prior
  // submission the new set does not cover (including all old-language ones when
  // the language changed), pause any now-orphaned task, and cancel its queued
  // fetch so a superseded source is not fetched once more.
  const { deactivateSubmissionIds, staleCloudBuilderIds } = planSubmissionReconciliation({
    existingActive,
    keepCloudBuilderIds,
  });
  let supersededSources = 0;
  if (deactivateSubmissionIds.length > 0) {
    const deactivated = await prisma.cloudSourceSubmission.updateMany({
      where: { id: { in: deactivateSubmissionIds } },
      data: { active: false },
    });
    supersededSources = deactivated.count;

    const staleTasks = await prisma.cloudSourceTask.findMany({
      where: { builderId: { in: staleCloudBuilderIds } },
      select: {
        id: true,
        builderId: true,
        cloudLanguageLibraryId: true,
        summaryLanguage: true,
      },
    });
    for (const staleTask of staleTasks) {
      // A stale cloud builder belongs to its own language owner, never the new
      // submission's, so recompute with the task's own library/language.
      await recomputeCloudSourceTask({
        prisma,
        cloudLanguageLibraryId: staleTask.cloudLanguageLibraryId,
        builderId: staleTask.builderId,
        summaryLanguage: staleTask.summaryLanguage,
        now,
      });
    }

    const pausedTasks = await prisma.cloudSourceTask.findMany({
      where: { id: { in: staleTasks.map((task) => task.id) }, status: "PAUSED" },
      select: { id: true },
    });
    await cancelQueuedCloudFetchForTasks({
      prisma,
      taskIds: pausedTasks.map((task) => task.id),
    });
  }

  await syncCloudLanguageLibraryHub(params.summaryLanguage, prisma);
  return {
    sourcesSubmitted: privateSources.length,
    tasksSubmitted: tasksTouched,
    supersededSources,
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
