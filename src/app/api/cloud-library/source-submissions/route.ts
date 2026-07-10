import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth";
import { normalizeCloudSourceSubmissionInput } from "@/lib/cloud-source-contracts";
import {
  CloudSourceSubmissionError,
  getUserCloudSubmissionSummary,
  stopUserCloudSourceSubmissions,
  submitUserPrivateLibraryToCloud,
} from "@/lib/cloud-source-library";

const CLOUD_SUBMISSION_RATE_LIMIT_MS = 60_000;

const recentSubmissions = new Map<string, number>();

export async function GET() {
  const session = await getCurrentSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await getUserCloudSubmissionSummary({ userId });
  return NextResponse.json({
    hasActiveSubmission: summary.hasActiveSubmission,
    activeSourceCount: summary.activeSourceCount,
    summaryLanguage: summary.summaryLanguage,
    frequency: summary.frequency,
    lastSubmittedAt: summary.lastSubmittedAt,
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  const lastSubmissionAt = recentSubmissions.get(userId) ?? 0;
  if (nowMs - lastSubmissionAt < CLOUD_SUBMISSION_RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: "Cloud source submission is rate limited. Try again shortly." },
      { status: 429 },
    );
  }
  recentSubmissions.set(userId, nowMs);

  try {
    const body = await request.json();
    const input = normalizeCloudSourceSubmissionInput({
      frequency: String(body?.frequency ?? ""),
      summaryLanguage: body?.summaryLanguage,
      builderIds: body?.builderIds,
    });
    const result = await submitUserPrivateLibraryToCloud({
      userId,
      frequency: input.frequency,
      summaryLanguage: input.summaryLanguage,
      builderIds: input.builderIds,
    });
    // Invalidate the Sources page RSC so a fresh submittedSourceCount (and thus
    // the "Stop fetching" button) shows on the next request. The client also
    // calls router.refresh() for an immediate update on the current page.
    revalidatePath("/builders");
    return NextResponse.json({
      status: "ok",
      sourcesSubmitted: result.sourcesSubmitted,
      tasksSubmitted: result.tasksSubmitted,
      supersededSources: result.supersededSources,
      frequency: body.frequency,
      summaryLanguage: result.summaryLanguage,
    });
  } catch (error) {
    if (error instanceof CloudSourceSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Cloud source submission failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await getCurrentSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await stopUserCloudSourceSubmissions({ userId });
  revalidatePath("/builders");
  return NextResponse.json({
    status: "ok",
    stoppedSources: result.stoppedSources,
    cancelledQueuedTasks: result.cancelledQueuedTasks,
  });
}
