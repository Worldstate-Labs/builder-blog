import { NextResponse } from "next/server";
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
        where: { id: parsed.data.runId, status: "RUNNING" },
        select: { id: true, startedAt: true },
      });
      if (!run) throw new StaleWorkerWriteError();
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
        throw new StaleWorkerWriteError();
      }

      let postPlansPatched = 0;
      for (const plan of parsed.data.plans) {
        const current = runningTaskById.get(plan.cloudSourceTaskId);
        if (!current) throw new StaleWorkerWriteError();
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
        if (updated.count === 0) throw new StaleWorkerWriteError();
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
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }
}
