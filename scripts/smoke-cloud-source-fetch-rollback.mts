// End-to-end cloud source fetch smoke that writes only inside a transaction and
// rolls back before exiting.
//
// Run after readiness passes:
//   set -a && . ./.env && . ./.env.local && set +a
//   npx tsx scripts/check-cloud-source-fetch-readiness.mts --language zh
//   npx tsx scripts/smoke-cloud-source-fetch-rollback.mts --language zh
//
// This verifies the real DB-backed chain:
// private source -> cloud owner copy -> CloudSourceTask -> lease -> FeedItem
// sync -> CloudFetchRunTask success -> SourceCandidate -> Hub library item.

import {
  BuilderKind,
  BuilderPoolOrigin,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  normalizeHandle,
} from "../src/lib/builders";
import { submitUserPrivateLibraryToCloud, upsertSourceCandidateFromCloudBuilder } from "../src/lib/cloud-source-library";
import { leaseCloudFetchTasks } from "../src/lib/cloud-source-scheduler";
import { applyCloudFetchTaskSyncResult, loadCloudFetchSyncConfig } from "../src/lib/cloud-source-sync";
import { syncBuilderFeedItems } from "../src/lib/builder-feed-sync";
import { prisma } from "../src/lib/prisma";

class SmokeRollback extends Error {
  constructor() {
    super("rollback_cloud_source_fetch_smoke");
  }
}

type SmokeResult = {
  status: "ok";
  rolledBack: boolean;
  summaryLanguage: string;
  submitted: {
    sourcesSubmitted: number;
    tasksSubmitted: number;
  };
  lease: {
    runId: string;
    tasks: number;
  };
  sync: {
    feedItems: number;
    itemResults: number;
    runStatus: string;
    sourceCandidateCreated: boolean;
    hubEntryContainsCloudBuilder: boolean;
  };
};

function argValue(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next.trim() : fallback;
}

async function assertSchemaReady(client: PrismaClient) {
  const [row] = await client.$queryRawUnsafe<Array<{
    migration_applied: boolean;
    has_tables: boolean;
  }>>(`
    select
      exists(
        select 1
        from "_prisma_migrations"
        where migration_name = '000080_cloud_source_fetch'
          and finished_at is not null
      ) as migration_applied,
      to_regclass('"CloudFetchConfig"') is not null
        and to_regclass('"CloudLanguageLibrary"') is not null
        and to_regclass('"CloudSourceTask"') is not null
        and to_regclass('"CloudFetchQueueItem"') is not null
        and to_regclass('"CloudFetchRun"') is not null
        and to_regclass('"CloudFetchRunTask"') is not null
      as has_tables
  `);
  if (!row?.migration_applied || !row.has_tables) {
    throw new Error(
      "Cloud source fetch schema is not ready. Run scripts/check-cloud-source-fetch-readiness.mts first.",
    );
  }
}

async function upsertBuilderInTransaction(
  tx: Prisma.TransactionClient,
  params: {
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
  },
) {
  const kind = params.kind as BuilderKind;
  const handle = params.handle ? normalizeHandle(params.handle) : null;
  const uniqueValue = canonicalBuilderValueForInput({
    kind,
    handle,
    sourceUrl: params.sourceUrl,
    name: params.name,
  });
  const canonicalKey = canonicalBuilderKey(kind, uniqueValue);
  const libraryKey = builderLibraryKey({
    canonicalKey,
    ownerUserId: params.ownerUserId,
  });
  const entity = await tx.builderEntity.upsert({
    where: { canonicalKey },
    update: {
      name: params.name,
      handle,
      bio: params.bio ?? undefined,
    },
    create: {
      kind,
      canonicalKey,
      name: params.name,
      handle,
      bio: params.bio,
    },
    select: { id: true },
  });
  return tx.builder.upsert({
    where: { libraryKey },
    update: {
      name: params.name,
      sourceType: params.sourceType ?? undefined,
      handle,
      sourceUrl: params.sourceUrl ?? undefined,
      fetchUrl: params.fetchUrl ?? undefined,
      avatarUrl: params.avatarUrl === undefined ? undefined : params.avatarUrl,
      avatarDataUrl: params.avatarDataUrl === undefined ? undefined : params.avatarDataUrl,
      bio: params.bio ?? undefined,
      entityId: entity.id,
    },
    create: {
      ownerUserId: params.ownerUserId,
      kind,
      sourceType: params.sourceType ?? undefined,
      name: params.name,
      handle,
      sourceUrl: params.sourceUrl,
      fetchUrl: params.fetchUrl,
      avatarUrl: params.avatarUrl ?? null,
      avatarDataUrl: params.avatarDataUrl ?? null,
      bio: params.bio,
      addedByUserId: params.addedByUserId,
      canonicalKey,
      libraryKey,
      entityId: entity.id,
    },
    select: {
      id: true,
      canonicalKey: true,
      ownerUserId: true,
      entityId: true,
    },
  });
}

async function main() {
  const summaryLanguage = argValue("--language", "zh") || "zh";
  const marker = `cloud-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = new Date();
  let smokeResult: SmokeResult | null = null;

  await assertSchemaReady(prisma);

  try {
    await prisma.$transaction(async (tx) => {
      const txClient = tx as unknown as PrismaClient;
      const [sourceUser, cloudOwner] = await Promise.all([
        tx.user.create({
          data: {
            email: `${marker}-source@example.com`,
            name: "Cloud Smoke Source User",
          },
        }),
        tx.user.create({
          data: {
            email: `${marker}-cloud-owner@example.com`,
            name: "Cloud Smoke Owner",
          },
        }),
      ]);

      await tx.cloudFetchConfig.upsert({
        where: { id: "global" },
        update: {
          tokenBudgetPerHour: 2_000_000,
          leaseTtlMinutes: 60,
          schedulingLeadMinutes: 1_440,
          retryBaseMinutes: 30,
          starvationReserveRatio: 0.15,
          failureCircuitBreakerThreshold: 5,
          canonicalCooldownMinutes: 0,
          durationColdStartBufferRatio: 0.5,
        },
        create: {
          id: "global",
          tokenBudgetPerHour: 2_000_000,
          leaseTtlMinutes: 60,
          schedulingLeadMinutes: 1_440,
          retryBaseMinutes: 30,
          starvationReserveRatio: 0.15,
          failureCircuitBreakerThreshold: 5,
          canonicalCooldownMinutes: 0,
          durationColdStartBufferRatio: 0.5,
        },
      });

      const cloudLibrary = await tx.cloudLanguageLibrary.upsert({
        where: { summaryLanguage },
        update: {
          ownerUserId: cloudOwner.id,
          enabled: true,
        },
        create: {
          summaryLanguage,
          ownerUserId: cloudOwner.id,
          enabled: true,
        },
      });

      const sourceUrl = `https://example.com/${marker}/rss.xml`;
      const userBuilder = await upsertBuilderInTransaction(tx, {
        ownerUserId: sourceUser.id,
        addedByUserId: sourceUser.id,
        kind: BuilderKind.BLOG,
        sourceType: "blog",
        name: "Cloud Smoke Blog",
        sourceUrl,
        fetchUrl: sourceUrl,
        bio: "Rollback-only cloud source fetch smoke source.",
      });
      await tx.builderPoolEntry.create({
        data: {
          userId: sourceUser.id,
          builderId: userBuilder.id,
          origin: BuilderPoolOrigin.PERSONAL_SYNC,
        },
      });

      const submitted = await submitUserPrivateLibraryToCloud({
        userId: sourceUser.id,
        frequency: "DAILY",
        summaryLanguage,
        now,
        prisma: txClient,
        copyBuilderUpsert: (params) => upsertBuilderInTransaction(tx, params),
      });
      if (submitted.sourcesSubmitted !== 1 || submitted.tasksSubmitted !== 1) {
        throw new Error(`Expected one submitted source/task, got ${JSON.stringify(submitted)}.`);
      }

      const activeCloudLibrary = await tx.cloudLanguageLibrary.findUniqueOrThrow({
        where: { summaryLanguage },
        select: { id: true, ownerUserId: true },
      });
      const activeSubmission = await tx.cloudSourceSubmission.findFirstOrThrow({
        where: { userId: sourceUser.id, active: true, summaryLanguage },
        select: { cloudBuilderId: true },
      });
      const task = await tx.cloudSourceTask.findFirstOrThrow({
        where: {
          cloudLanguageLibraryId: activeCloudLibrary.id,
          builderId: activeSubmission.cloudBuilderId,
        },
        include: { builder: true },
      });
      if (task.builder.ownerUserId !== activeCloudLibrary.ownerUserId) {
        throw new Error("Cloud task builder is not owned by the cloud language owner.");
      }
      if (task.builder.canonicalKey !== userBuilder.canonicalKey) {
        throw new Error("Cloud builder does not preserve the user builder canonical key.");
      }

      const leaseNow = new Date(Date.now() + 5_000);
      const smokeDeadline = new Date(leaseNow.getTime() + 30 * 60 * 1000);
      await tx.cloudSourceTask.update({
        where: { id: task.id },
        data: {
          nextAttemptAt: leaseNow,
          mustSucceedBy: smokeDeadline,
          estimatedDurationSeconds: 60,
          estimatedSuccessProbability: 0.99,
        },
      });
      // This smoke runs against a shared database. Pin its own queue row first
      // so limit: 1 cannot lease an unrelated production task.
      await tx.cloudFetchQueueItem.create({
        data: {
          cloudSourceTaskId: task.id,
          status: "QUEUED",
          priorityScore: Number.MAX_SAFE_INTEGER,
          dueAt: leaseNow,
          mustSucceedBy: smokeDeadline,
        },
      });
      const lease = await leaseCloudFetchTasks({
        limit: 1,
        leaseOwner: `${marker}-lease`,
        now: leaseNow,
        prisma: txClient,
      });
      if (lease.status !== "ok" || !lease.runId || lease.tasks.length !== 1) {
        throw new Error(`Expected one leased task, got ${JSON.stringify(lease)}.`);
      }
      if (lease.tasks[0]?.cloudSourceTaskId !== task.id) {
        throw new Error(`Expected smoke task ${task.id}, got ${JSON.stringify(lease.tasks)}.`);
      }

      const fetchTaskId = `fetch_post:${task.builderId}:BLOG_POST:${marker}`;
      const feedSync = await syncBuilderFeedItems({
        prisma: txClient,
        builders: [
          {
            builderId: task.builderId,
            kind: BuilderKind.BLOG,
            sourceType: "blog",
            name: task.builder.name,
            sourceUrl: task.builder.sourceUrl,
            fetchUrl: task.builder.fetchUrl,
            subscribe: false,
            items: [
              {
                kind: "BLOG_POST",
                externalId: marker,
                title: "Cloud smoke post",
                url: `https://example.com/${marker}/post`,
                body: "This rollback-only smoke body is long enough to pass content quality checks and prove feed item persistence.",
                summary: "Cloud smoke summary persisted in the requested language.",
                headline: "Rollback smoke validates cloud delivery",
                publishedAt: now.toISOString(),
                sourceName: task.builder.name,
                rawJson: {
                  fetchTaskId,
                  cloudRunId: lease.runId,
                  cloudSourceTaskId: task.id,
                  agentRuntime: "smoke",
                  agentModel: "rollback",
                },
              },
            ],
          },
        ],
        force: true,
        fetchTool: "smoke rollback",
        summaryLanguage,
        mode: { type: "existing", allowedBuilderIds: new Set([task.builderId]) },
        now: leaseNow,
        contentStandardsBySourceId: new Map(),
      });
      if (feedSync.feedItems !== 1 || feedSync.itemResults[0]?.status !== "synced") {
        throw new Error(`Expected one synced feed item, got ${JSON.stringify(feedSync)}.`);
      }

      const syncConfig = await loadCloudFetchSyncConfig(txClient);
      const runSync = await applyCloudFetchTaskSyncResult({
        prisma: txClient,
        now: leaseNow,
        config: syncConfig,
        result: {
          runId: lease.runId,
          cloudSourceTaskId: task.id,
          status: "succeeded",
          plannedPosts: 1,
          syncedPosts: 1,
          failedPosts: 0,
          actualDurationSeconds: 60,
          usageTokens: 123,
          usageCostUsd: 0.0123,
          details: { smoke: true },
        },
      });

      await upsertSourceCandidateFromCloudBuilder(task.builderId, txClient);
      const sourceCandidate = await tx.sourceCandidate.findUnique({
        where: { sourceKey: task.builder.canonicalKey },
        select: { id: true },
      });
      const hubEntry = await tx.libraryHubEntry.findUnique({
        where: { id: (await tx.cloudLanguageLibrary.findUniqueOrThrow({
          where: { id: cloudLibrary.id },
          select: { hubEntryId: true },
        })).hubEntryId ?? "" },
        include: { items: { select: { builderId: true } } },
      });
      const hubEntryContainsCloudBuilder = Boolean(
        hubEntry?.items.some((item) => item.builderId === task.builderId),
      );
      if (!sourceCandidate || !hubEntryContainsCloudBuilder) {
        throw new Error("Source candidate or cloud Hub item was not created as expected.");
      }

      smokeResult = {
        status: "ok",
        rolledBack: true,
        summaryLanguage,
        submitted: {
          sourcesSubmitted: submitted.sourcesSubmitted,
          tasksSubmitted: submitted.tasksSubmitted,
        },
        lease: {
          runId: lease.runId,
          tasks: lease.tasks.length,
        },
        sync: {
          feedItems: feedSync.feedItems,
          itemResults: feedSync.itemResults.length,
          runStatus: String(runSync.runStatus),
          sourceCandidateCreated: Boolean(sourceCandidate),
          hubEntryContainsCloudBuilder,
        },
      };

      throw new SmokeRollback();
    }, { timeout: 30_000 });
  } catch (error) {
    if (!(error instanceof SmokeRollback)) throw error;
  }

  const remainingUsers = await prisma.user.count({
    where: { email: { startsWith: marker } },
  });
  if (remainingUsers !== 0) {
    throw new Error(`Rollback smoke left ${remainingUsers} marker users behind.`);
  }
  if (!smokeResult) {
    throw new Error("Rollback smoke did not produce a result.");
  }
  console.log(JSON.stringify(smokeResult, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
