import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { serializeCloudSourceSubmitter } from "@/lib/cloud-library-overview";
import { prisma } from "@/lib/prisma";

// Per-source drill-down: the active submitters for one cloud source. Recent
// posts are rendered client-side with BuilderFeedItems (/api/builders/[id]/
// feed-items), the same component the per-user source library uses.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ builderId: string }> },
) {
  const auth = await requireCloudFetchAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { builderId } = await params;

  const submissions = await prisma.cloudSourceSubmission.findMany({
    where: { cloudBuilderId: builderId, active: true },
    orderBy: { submittedAt: "desc" },
    include: { user: { select: { email: true, name: true } } },
  });

  return NextResponse.json({
    submitters: submissions.map(serializeCloudSourceSubmitter),
  });
}
