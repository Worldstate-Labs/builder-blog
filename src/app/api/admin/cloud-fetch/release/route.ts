import { NextResponse } from "next/server";
import { cloudFetchConflictBody } from "@/lib/cloud-fetch-conflict";
import {
  CloudWorkerReleaseJobNotFoundError,
  releaseCloudFetchWorkerLeases,
} from "@/lib/cloud-fetch-worker-release";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { StaleWorkerWriteError } from "@/lib/reset-fence";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const body = await request.json().catch(() => ({}));
  const jobRunId = typeof body?.jobRunId === "string" ? body.jobRunId.trim().slice(0, 160) : "";

  try {
    const result = await releaseCloudFetchWorkerLeases({
      userId: admin.user.id,
      instanceId: jobRunId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CloudWorkerReleaseJobNotFoundError) {
      return NextResponse.json(cloudFetchConflictBody({
        message: error.message,
        code: error.responseCode,
        retryable: error.retryable,
      }), { status: error.statusCode });
    }
    if (error instanceof StaleWorkerWriteError) {
      return NextResponse.json(cloudFetchConflictBody({
        message: error.message,
        code: error.responseCode,
        retryable: error.retryable,
      }), { status: error.statusCode });
    }
    throw error;
  }
}
