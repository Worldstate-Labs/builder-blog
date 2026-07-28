import { NextResponse } from "next/server";
import {
  CloudFetchConflictError,
  cloudFetchConflictBody,
} from "@/lib/cloud-fetch-conflict";
import { lockCloudFetchRunTaskRows } from "@/lib/cloud-fetch-run-task-lock";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { mergeCloudFetchExecutionPlanDetails } from "@/lib/cloud-fetch-plan-details";
import { parseCloudFetchPlanPatchPayload } from "@/lib/cloud-source-contracts";
import { prisma } from "@/lib/prisma";
import { lockResetFenceForWorker, StaleWorkerWriteError } from "@/lib/reset-fence";
import { formatZodError } from "@/lib/zod-error";

export const dynamic = "force-dynamic";

const CLOUD_PLAN_TRANSACTION_OPTIONS = {
  maxWait: 60_000,
  timeout: 60_000,
} as const;

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const parsed = parseCloudFetchPlanPatchPayload(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const taskIds = parsed.data.plans.map((plan) => plan.cloudSourceTaskId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.cloudFetchRun.findFirst({
        where: { id: parsed.data.runId },
        select: { id: true, startedAt: true, status: true },
      });
      if (!run || run.status !== "RUNNING") {
        throw new CloudFetchConflictError(
          "cloud_run_not_running",
          run
            ? `Cloud fetch run ${run.id} is ${String(run.status).toLowerCase()}.`
            : `Cloud fetch run ${parsed.data.runId} no longer exists.`,
          false,
        );
      }
      await lockResetFenceForWorker(tx, run.startedAt);
      await lockCloudFetchRunTaskRows(tx, { runId: run.id, cloudSourceTaskIds: taskIds });

      const runningTasks = await tx.cloudFetchRunTask.findMany({
        where: {
          runId: run.id,
          cloudSourceTaskId: { in: taskIds },
          status: "RUNNING",
        },
        select: {
          cloudSourceTaskId: true,
          details: true,
        },
      });
      const runningTaskById = new Map(
        runningTasks.map((task) => [task.cloudSourceTaskId, task]),
      );
      if (taskIds.some((taskId) => !runningTaskById.has(taskId))) {
        throw new CloudFetchConflictError(
          "cloud_source_already_finalized",
          "One or more cloud sources were already finalized before their execution plan arrived.",
          false,
        );
      }

      let postPlansPatched = 0;
      for (const plan of parsed.data.plans) {
        const current = runningTaskById.get(plan.cloudSourceTaskId);
        if (!current) {
          throw new CloudFetchConflictError(
            "cloud_source_already_finalized",
            `Cloud source ${plan.cloudSourceTaskId} is no longer running.`,
            false,
          );
        }
        const details = mergeCloudFetchExecutionPlanDetails(current.details, plan);
        const updated = await tx.cloudFetchRunTask.updateMany({
          where: {
            runId: run.id,
            cloudSourceTaskId: plan.cloudSourceTaskId,
            status: "RUNNING",
          },
          data: {
            details: details as object,
          },
        });
        if (updated.count === 0) {
          throw new CloudFetchConflictError(
            "cloud_source_finalize_race",
            `Cloud source ${plan.cloudSourceTaskId} changed while its execution plan was being saved.`,
            true,
          );
        }
        postPlansPatched += plan.posts.length;
      }

      return {
        status: "ok" as const,
        runId: run.id,
        sourceTasksUpdated: parsed.data.plans.length,
        postPlansPatched,
      };
    }, CLOUD_PLAN_TRANSACTION_OPTIONS);

    return NextResponse.json({
      ...result,
      generatedAt: new Date().toISOString(),
    });
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
    if (error instanceof CloudFetchConflictError) {
      return NextResponse.json(cloudFetchConflictBody(error), { status: error.statusCode });
    }
    throw error;
  }
}
