import { NextResponse } from "next/server";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import {
  serializeCloudSourcePost,
  serializeCloudSourceSubmitter,
} from "@/lib/cloud-library-overview";
import { prisma } from "@/lib/prisma";

const POSTS_LIMIT = 20;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ builderId: string }> },
) {
  const auth = await requireCloudFetchAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { builderId } = await params;

  const [submissions, posts] = await Promise.all([
    prisma.cloudSourceSubmission.findMany({
      where: { cloudBuilderId: builderId, active: true },
      orderBy: { submittedAt: "desc" },
      include: { user: { select: { email: true, name: true } } },
    }),
    prisma.feedItem.findMany({
      where: { builderId },
      orderBy: { publishedAt: "desc" },
      take: POSTS_LIMIT,
      select: { id: true, title: true, url: true, publishedAt: true, summary: true },
    }),
  ]);

  return NextResponse.json({
    submitters: submissions.map(serializeCloudSourceSubmitter),
    posts: posts.map(serializeCloudSourcePost),
  });
}
