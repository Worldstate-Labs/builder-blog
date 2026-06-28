import { NextResponse } from "next/server";
import {
  emptyBuilderFeedSyncResult,
  syncBuilderFeedItems,
  type BuilderFeedSyncInput,
  type BuilderFeedSyncItemResult,
} from "@/lib/builder-feed-sync";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { parseCloudFetchSyncPayload } from "@/lib/cloud-source-contracts";
import {
  applyCloudFetchTaskSyncResult,
  loadCloudFetchSyncConfig,
} from "@/lib/cloud-source-sync";
import {
  syncCloudLanguageLibraryHub,
  upsertSourceCandidateFromCloudBuilder,
} from "@/lib/cloud-source-library";
import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";
import { prisma } from "@/lib/prisma";
import { formatZodError } from "@/lib/zod-error";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const parsed = parseCloudFetchSyncPayload(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const config = await loadCloudFetchSyncConfig(prisma);
  const taskIds = [...new Set(parsed.data.taskResults.map((taskResult) => taskResult.cloudSourceTaskId))];
  const cloudTasks = await prisma.cloudSourceTask.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, builderId: true, summaryLanguage: true },
  });
  const cloudTaskById = new Map(cloudTasks.map((task) => [task.id, task]));
  const missingTaskIds = taskIds.filter((taskId) => !cloudTaskById.has(taskId));
  if (missingTaskIds.length > 0) {
    return NextResponse.json(
      {
        error: `Cloud source task was not found: ${missingTaskIds.slice(0, 3).join(", ")}`,
      },
      { status: 400 },
    );
  }
  const allowedBuilderIds = new Set(cloudTasks.map((task) => task.builderId));
  const summaryLanguageByBuilderId = new Map(
    cloudTasks.map((task) => [task.builderId, task.summaryLanguage]),
  );
  const feedSync = emptyBuilderFeedSyncResult();
  for (const [summaryLanguage, builders] of groupBuildersBySummaryLanguage({
    builders: parsed.data.builders,
    fallbackSummaryLanguage: parsed.data.summaryLanguage,
    summaryLanguageByBuilderId,
  })) {
    await syncBuilderFeedItems({
      prisma,
      builders,
      force: parsed.data.force,
      fetchTool: parsed.data.fetchTool,
      summaryLanguage,
      mode: {
        type: "existing",
        allowedBuilderIds,
      },
      result: feedSync,
    });
  }

  const taskResults = [];
  const successfulLanguages = new Set<string>();
  const projectionErrors = [];
  const authoritativeTaskResults = reconcileTaskResultsWithFeedSync({
    taskResults: parsed.data.taskResults,
    itemResults: feedSync.itemResults,
  });
  for (const taskResult of authoritativeTaskResults) {
    const syncedTask = await applyCloudFetchTaskSyncResult({
      prisma,
      config,
      result: {
        runId: parsed.data.cloudRunId,
        cloudSourceTaskId: taskResult.cloudSourceTaskId,
        status: taskResult.status,
        plannedPosts: taskResult.plannedPosts,
        syncedPosts: taskResult.syncedPosts,
        failedPosts: taskResult.failedPosts,
        actualDurationSeconds: taskResult.actualDurationSeconds,
        failureReason: taskResult.failureReason,
        usageTokens: taskResult.usageTokens,
        usageCostUsd: taskResult.usageCostUsd,
        details: taskResult.details,
      },
    });
    taskResults.push(syncedTask);
    if (taskResult.status === "succeeded") {
      try {
        await upsertSourceCandidateFromCloudBuilder(syncedTask.builderId, prisma);
        successfulLanguages.add(syncedTask.summaryLanguage);
      } catch (error) {
        projectionErrors.push(projectionError("source_candidate", syncedTask.builderId, error));
      }
    }
  }

  const hubLanguages = [];
  for (const summaryLanguage of successfulLanguages) {
    try {
      await syncCloudLanguageLibraryHub(summaryLanguage, prisma);
      hubLanguages.push(summaryLanguage);
    } catch (error) {
      projectionErrors.push(projectionError("language_hub", summaryLanguage, error));
    }
  }

  return NextResponse.json({
    status: "ok",
    cloudRunId: parsed.data.cloudRunId,
    taskResults,
    projections: {
      hubLanguages,
      errors: projectionErrors,
    },
    builders: parsed.data.builders.length,
    feedSync: {
      builders: feedSync.builders,
      feedItems: feedSync.feedItems,
      skippedFeedItems: feedSync.skippedFeedItems,
      itemResults: feedSync.itemResults,
    },
    taskOutcomes: parsed.data.taskOutcomes.length,
    generatedAt: new Date().toISOString(),
  });
}

function groupBuildersBySummaryLanguage({
  builders,
  fallbackSummaryLanguage,
  summaryLanguageByBuilderId,
}: {
  builders: BuilderFeedSyncInput[];
  fallbackSummaryLanguage?: string | null;
  summaryLanguageByBuilderId: Map<string, string>;
}) {
  const groups = new Map<string, BuilderFeedSyncInput[]>();
  for (const builder of builders) {
    const summaryLanguage = normalizeSummaryLanguagePreference(
      builder.builderId ? summaryLanguageByBuilderId.get(builder.builderId) ?? fallbackSummaryLanguage : fallbackSummaryLanguage,
    );
    const group = groups.get(summaryLanguage) ?? [];
    group.push(builder);
    groups.set(summaryLanguage, group);
  }
  return groups;
}

function reconcileTaskResultsWithFeedSync({
  taskResults,
  itemResults,
}: {
  taskResults: Array<{
    cloudSourceTaskId: string;
    status: "succeeded" | "failed";
    plannedPosts: number;
    syncedPosts: number;
    failedPosts: number;
    actualDurationSeconds?: number | null;
    failureReason?: string | null;
    usageTokens?: number | null;
    usageCostUsd?: number | null;
    details: Record<string, unknown>;
  }>;
  itemResults: BuilderFeedSyncItemResult[];
}) {
  const itemResultByFetchTaskId = new Map(
    itemResults.map((itemResult) => [itemResult.fetchTaskId, itemResult]),
  );
  return taskResults.map((taskResult) => {
    const fetchTaskIds = Array.isArray(taskResult.details.fetchTaskIds)
      ? taskResult.details.fetchTaskIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (fetchTaskIds.length === 0) return taskResult;

    const serverResults = fetchTaskIds
      .map((fetchTaskId) => itemResultByFetchTaskId.get(fetchTaskId))
      .filter((itemResult): itemResult is BuilderFeedSyncItemResult => Boolean(itemResult));
    if (serverResults.length === 0) return taskResult;

    const serverSynced = serverResults.filter((itemResult) => itemResult.status === "synced").length;
    const serverFailed = serverResults.filter((itemResult) => itemResult.status === "failed");
    const clientSyncedRejectedByServer = Math.max(0, taskResult.syncedPosts - serverSynced);
    const syncedPosts = Math.min(taskResult.syncedPosts, serverSynced);
    const failedPosts = Math.max(
      taskResult.failedPosts,
      serverFailed.length + clientSyncedRejectedByServer,
    );
    const status =
      syncedPosts === 0 && failedPosts >= taskResult.plannedPosts
        ? "failed"
        : taskResult.status;
    const failureReason =
      status === "failed"
        ? taskResult.failureReason ?? serverFailed[0]?.reason ?? "cloud_feed_sync_failed"
        : taskResult.failureReason;

    return {
      ...taskResult,
      status,
      syncedPosts,
      failedPosts,
      ...(failureReason ? { failureReason } : {}),
      details: {
        ...taskResult.details,
        serverFeedSync: {
          syncedPosts,
          failedPosts,
          itemResults: serverResults.map((itemResult) => ({
            fetchTaskId: itemResult.fetchTaskId,
            status: itemResult.status,
            ...(itemResult.reason ? { reason: itemResult.reason } : {}),
          })),
        },
      },
    };
  });
}

function projectionError(kind: string, key: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Cloud fetch sync ${kind} projection failed for ${key}: ${message}`);
  return {
    kind,
    key,
    error: message.slice(0, 300),
  };
}
