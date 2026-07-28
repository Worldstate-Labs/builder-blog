import { NextResponse } from "next/server";
import {
  emptyBuilderFeedSyncResult,
  syncBuilderFeedItems,
  type BuilderFeedSyncInput,
} from "@/lib/builder-feed-sync";
import {
  CloudFetchConflictError,
  cloudFetchConflictBody,
} from "@/lib/cloud-fetch-conflict";
import {
  CloudSourceResultIncompleteError,
  classifyCloudFetchTerminalWrite,
  cloudFetchTerminalRequestDigest,
  reconcileCloudFetchTerminalResult,
  validateTerminalCoverage,
} from "@/lib/cloud-fetch-terminal-reconcile";
import { lockCloudFetchRunTaskRows } from "@/lib/cloud-fetch-run-task-lock";
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
import { lockResetFenceForWorker, StaleWorkerWriteError } from "@/lib/reset-fence";

export const dynamic = "force-dynamic";

const CLOUD_SYNC_TRANSACTION_OPTIONS = {
  maxWait: 60_000,
  timeout: 60_000,
} as const;

class CloudSyncWriteError extends Error {
  readonly statusCode = 400;
}

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const parsed = parseCloudFetchSyncPayload(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const taskIds = [...new Set(parsed.data.taskResults.map((taskResult) => taskResult.cloudSourceTaskId))];
  if (taskIds.length !== parsed.data.taskResults.length) {
    return NextResponse.json(
      { error: "Task results cannot repeat the same cloudSourceTaskId." },
      { status: 400 },
    );
  }
  const submittedItems = submittedItemFacts(parsed.data.builders);
  let core;
  try {
    core = await prisma.$transaction(async (tx) => {
      const run = await tx.cloudFetchRun.findUnique({
        where: { id: parsed.data.cloudRunId },
        select: {
          id: true,
          startedAt: true,
          status: true,
          tasksSucceeded: true,
          tasksFailed: true,
          usageTokens: true,
          usageCostUsd: true,
        },
      });
      if (!run) {
        throw new CloudFetchConflictError(
          "cloud_run_not_running",
          "The cloud fetch run no longer exists.",
          false,
        );
      }
      await lockResetFenceForWorker(tx, run.startedAt);
      await lockCloudFetchRunTaskRows(tx, { runId: run.id, cloudSourceTaskIds: taskIds });

      const runTasks = await tx.cloudFetchRunTask.findMany({
        where: {
          runId: run.id,
          cloudSourceTaskId: { in: taskIds },
        },
        select: {
          cloudSourceTaskId: true,
          builderId: true,
          summaryLanguage: true,
          status: true,
          plannedPosts: true,
          syncedPosts: true,
          failedPosts: true,
          actualDurationSeconds: true,
          failureReason: true,
          usageTokens: true,
          usageCostUsd: true,
          details: true,
        },
      });
      const runTaskById = new Map(runTasks.map((task) => [task.cloudSourceTaskId, task]));
      const missingRunTaskIds = taskIds.filter((taskId) => !runTaskById.has(taskId));
      if (missingRunTaskIds.length > 0) {
        throw new CloudSyncWriteError(
          `Cloud run source task was not found: ${missingRunTaskIds.slice(0, 3).join(", ")}`,
        );
      }

      const config = await loadCloudFetchSyncConfig(tx);
      const cloudTasks = await tx.cloudSourceTask.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, builderId: true, summaryLanguage: true },
      });
      const cloudTaskById = new Map(cloudTasks.map((task) => [task.id, task]));
      const missingTaskIds = taskIds.filter((taskId) => !cloudTaskById.has(taskId));
      if (missingTaskIds.length > 0) {
        throw new CloudSyncWriteError(
          `Cloud source task was not found: ${missingTaskIds.slice(0, 3).join(", ")}`,
        );
      }

      const preparedResults = parsed.data.taskResults.map((taskResult) => {
        const runTask = runTaskById.get(taskResult.cloudSourceTaskId)!;
        const executionPlanPosts = executionPlanPostsForTerminalResult(
          runTask.details,
          taskResult,
        );
        const expectedPostTaskIds = Object.keys(executionPlanPosts);
        if (expectedPostTaskIds.length === 0 && taskResult.plannedPosts > 0) {
          throw new CloudSourceResultIncompleteError(
            `Cloud source ${taskResult.cloudSourceTaskId} has no persisted execution plan.`,
          );
        }
        return {
          taskResult,
          runTask,
          executionPlanPosts,
          expectedPostTaskIds,
        };
      });
      validateTerminalCoverage({
        expectedPostTaskIds: preparedResults.flatMap((entry) => entry.expectedPostTaskIds),
        submittedPostTaskIds: submittedItems.map((item) => item.fetchTaskId),
        outcomePostTaskIds: parsed.data.taskOutcomes.map((outcome) => outcome.fetchTaskId),
      });

      const activeResults = [];
      const replayedTaskResults = [];
      const activePostTaskIds = new Set<string>();
      for (const prepared of preparedResults) {
        const expectedIds = new Set(prepared.expectedPostTaskIds);
        const sourceSubmittedItems = submittedItems.filter((item) => expectedIds.has(item.fetchTaskId));
        const sourceTaskOutcomes = parsed.data.taskOutcomes.filter((outcome) =>
          expectedIds.has(outcome.fetchTaskId),
        );
        const requestDigest = cloudFetchTerminalRequestDigest({
          cloudSourceTaskId: prepared.taskResult.cloudSourceTaskId,
          expectedPostTaskIds: prepared.expectedPostTaskIds,
          submittedItems: sourceSubmittedItems,
          taskOutcomes: sourceTaskOutcomes,
        });
        const write = classifyCloudFetchTerminalWrite({
          status: prepared.runTask.status,
          storedRequestDigest: stringValue(record(prepared.runTask.details)?.requestDigest),
          requestDigest,
        });
        if (write.action === "replay") {
          replayedTaskResults.push(storedTaskResult(prepared.runTask));
          continue;
        }
        if (run.status !== "RUNNING") {
          throw new CloudFetchConflictError(
            "cloud_run_not_running",
            `Cloud fetch run ${run.id} is ${String(run.status).toLowerCase()}.`,
            false,
          );
        }
        for (const id of prepared.expectedPostTaskIds) activePostTaskIds.add(id);
        activeResults.push({
          ...prepared,
          sourceSubmittedItems,
          sourceTaskOutcomes,
        });
      }

      const activeSourceTaskIds = new Set(
        activeResults.map((entry) => entry.taskResult.cloudSourceTaskId),
      );
      const activeCloudTasks = cloudTasks.filter((task) => activeSourceTaskIds.has(task.id));
      const allowedBuilderIds = new Set(activeCloudTasks.map((task) => task.builderId));
      const summaryLanguageByBuilderId = new Map(
        activeCloudTasks.map((task) => [task.builderId, task.summaryLanguage]),
      );
      const feedSync = emptyBuilderFeedSyncResult();
      for (const [summaryLanguage, builders] of groupBuildersBySummaryLanguage({
        builders: filterBuildersByFetchTaskIds(parsed.data.builders, activePostTaskIds),
        fallbackSummaryLanguage: parsed.data.summaryLanguage,
        summaryLanguageByBuilderId,
      })) {
        await syncBuilderFeedItems({
          prisma: tx,
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

      const taskResults: Array<Record<string, unknown>> = [...replayedTaskResults];
      let runSummary = {
        runStatus: run.status,
        tasksSucceeded: run.tasksSucceeded,
        tasksFailed: run.tasksFailed,
        tasksRunning: runTasks.filter((task) => task.status === "RUNNING").length,
        usageTokens: run.usageTokens,
        usageCostUsd: run.usageCostUsd == null ? null : Number(run.usageCostUsd),
      };
      const successfulLanguages = new Set<string>();
      const successfulBuilderIds = new Set<string>();
      const authoritativeTaskResults = activeResults.map((entry) =>
        reconcileCloudFetchTerminalResult({
          cloudSourceTaskId: entry.taskResult.cloudSourceTaskId,
          executionPlanPosts: entry.executionPlanPosts,
          clientResult: entry.taskResult,
          submittedItems: entry.sourceSubmittedItems,
          itemResults: feedSync.itemResults.filter((itemResult) =>
            entry.expectedPostTaskIds.includes(itemResult.fetchTaskId),
          ),
          taskOutcomes: entry.sourceTaskOutcomes,
        }),
      );
      for (const taskResult of authoritativeTaskResults) {
        let syncedTask;
        try {
          syncedTask = await applyCloudFetchTaskSyncResult({
            prisma: tx,
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
        } catch (error) {
          if (error instanceof StaleWorkerWriteError) {
            throw new CloudFetchConflictError(
              "cloud_source_finalize_race",
              `Cloud source ${taskResult.cloudSourceTaskId} was finalized by another worker.`,
              true,
            );
          }
          throw error;
        }
        taskResults.push({
          ...syncedTask.sourceTaskResult,
          builderId: syncedTask.builderId,
          summaryLanguage: syncedTask.summaryLanguage,
        });
        runSummary = {
          runStatus: syncedTask.runStatus,
          tasksSucceeded: syncedTask.tasksSucceeded,
          tasksFailed: syncedTask.tasksFailed,
          tasksRunning: syncedTask.tasksRunning,
          usageTokens: syncedTask.usageTokens,
          usageCostUsd: syncedTask.usageCostUsd,
        };
        if (taskResult.syncedPosts > 0) {
          successfulBuilderIds.add(syncedTask.builderId);
          successfulLanguages.add(syncedTask.summaryLanguage);
        }
      }

      return {
        feedSync,
        taskResults,
        runSummary,
        successfulBuilderIds: [...successfulBuilderIds],
        successfulLanguages: [...successfulLanguages],
      };
    }, CLOUD_SYNC_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof StaleWorkerWriteError) {
      return NextResponse.json(
        cloudFetchConflictBody({
          code: "reset_fenced",
          message: error.message,
          retryable: false,
        }),
        { status: error.statusCode },
      );
    }
    if (error instanceof CloudSourceResultIncompleteError) {
      return NextResponse.json(
        cloudFetchConflictBody({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        }),
        { status: error.statusCode },
      );
    }
    if (error instanceof CloudFetchConflictError) {
      return NextResponse.json(cloudFetchConflictBody(error), { status: error.statusCode });
    }
    if (error instanceof CloudSyncWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const projectionErrors = [];
  for (const builderId of core.successfulBuilderIds) {
    try {
      await upsertSourceCandidateFromCloudBuilder(builderId, prisma);
    } catch (error) {
      projectionErrors.push(projectionError("source_candidate", builderId, error));
    }
  }
  const hubLanguages = [];
  for (const summaryLanguage of core.successfulLanguages) {
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
    runSummary: core.runSummary,
    taskResults: core.taskResults,
    projections: {
      hubLanguages,
      errors: projectionErrors,
    },
    builders: parsed.data.builders.length,
    feedSync: {
      builders: core.feedSync.builders,
      feedItems: core.feedSync.feedItems,
      skippedFeedItems: core.feedSync.skippedFeedItems,
      itemResults: core.feedSync.itemResults,
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

function submittedItemFacts(builders: BuilderFeedSyncInput[]) {
  return builders.flatMap((builder) =>
    builder.items.flatMap((item) => {
      const fetchTaskId = stringValue(record(item.rawJson)?.fetchTaskId);
      return fetchTaskId
        ? [{
            fetchTaskId,
            title: item.title,
            url: item.url,
            body: item.body,
            summary: item.summary,
            headline: item.headline,
          }]
        : [];
    }),
  );
}

function filterBuildersByFetchTaskIds(
  builders: BuilderFeedSyncInput[],
  fetchTaskIds: Set<string>,
): BuilderFeedSyncInput[] {
  return builders.flatMap((builder) => {
    const items = builder.items.filter((item) => {
      const id = stringValue(record(item.rawJson)?.fetchTaskId);
      return Boolean(id && fetchTaskIds.has(id));
    });
    return items.length > 0 ? [{ ...builder, items }] : [];
  });
}

function executionPlanPostsForTerminalResult(
  details: unknown,
  taskResult: { details: Record<string, unknown> },
) {
  const persisted = record(record(details)?.executionPlan)?.posts;
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    return persisted as Record<string, Record<string, unknown>>;
  }
  const posts = Array.isArray(taskResult.details.posts) ? taskResult.details.posts : [];
  const postById = new Map(
    posts.flatMap((value) => {
      const post = record(value);
      const id = stringValue(post?.id ?? post?.postTaskId ?? post?.fetchTaskId);
      return id && post ? [[id, post] as const] : [];
    }),
  );
  const ids = Array.isArray(taskResult.details.fetchTaskIds)
    ? taskResult.details.fetchTaskIds.map(stringValue).filter((id): id is string => Boolean(id))
    : [];
  return Object.fromEntries(ids.map((id) => [id, { postTaskId: id, ...(postById.get(id) ?? {}) }]));
}

function storedTaskResult(task: {
  cloudSourceTaskId: string;
  builderId: string;
  summaryLanguage: string;
  status: string;
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  actualDurationSeconds: number | null;
  failureReason: string | null;
  usageTokens: number | null;
  usageCostUsd: unknown;
  details: unknown;
}) {
  return {
    cloudSourceTaskId: task.cloudSourceTaskId,
    status: task.status.toLowerCase(),
    plannedPosts: task.plannedPosts,
    syncedPosts: task.syncedPosts,
    failedPosts: task.failedPosts,
    actualDurationSeconds: task.actualDurationSeconds,
    failureReason: task.failureReason,
    usageTokens: task.usageTokens,
    usageCostUsd: task.usageCostUsd == null ? null : Number(task.usageCostUsd),
    details: record(task.details) ?? {},
    builderId: task.builderId,
    summaryLanguage: task.summaryLanguage,
    replayed: true,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
