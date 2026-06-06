import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { parseDigest } from "@/lib/digest-markdown";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ digestId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { digestId } = await params;
  const digest = await prisma.digest.findUnique({
    where: { id: digestId },
    select: {
      id: true,
      content: true,
      headlineSummary: true,
      userId: true,
    },
  });

  if (!digest) {
    return NextResponse.json({ error: "Digest not found" }, { status: 404 });
  }

  if (digest.userId !== session.user.id) {
    const importedPipeline = await prisma.digestPipelineImport.findFirst({
      where: {
        userId: session.user.id,
        pipeline: {
          isPublic: true,
          ownerUserId: digest.userId,
        },
      },
      select: { pipelineId: true },
    });

    if (!importedPipeline) {
      return NextResponse.json({ error: "Digest not found" }, { status: 404 });
    }
  }

  return NextResponse.json({
    id: digest.id,
    content: digest.content,
    headlineSummary: digest.headlineSummary,
    originalSummariesByUrl: await originalSummariesByUrlForDigest({
      content: digest.content,
      digestId: digest.id,
      userId: digest.userId,
    }),
  });
}

async function originalSummariesByUrlForDigest({
  content,
  digestId,
  userId,
}: {
  content: string;
  digestId: string;
  userId: string;
}) {
  const urls = digestPostUrls(content);
  if (urls.length === 0) return {};

  const byUrl = new Map<string, string>();
  const digestedItems = await prisma.digestedItem.findMany({
    where: {
      digestId,
      userId,
      feedItem: {
        is: {
          url: { in: urls },
          summary: { not: null },
        },
      },
    },
    select: {
      feedItem: {
        select: {
          summary: true,
          url: true,
        },
      },
    },
  });

  for (const item of digestedItems) {
    const summary = item.feedItem?.summary?.trim();
    const url = item.feedItem?.url;
    if (url && summary && !byUrl.has(url)) byUrl.set(url, summary);
  }

  const missingUrls = urls.filter((url) => !byUrl.has(url));
  if (missingUrls.length > 0) {
    const fallbackItems = await prisma.feedItem.findMany({
      where: {
        url: { in: missingUrls },
        summary: { not: null },
        builder: { is: { ownerUserId: userId } },
      },
      select: {
        summary: true,
        url: true,
      },
    });

    for (const item of fallbackItems) {
      const summary = item.summary?.trim();
      if (summary && !byUrl.has(item.url)) byUrl.set(item.url, summary);
    }
  }

  return Object.fromEntries(byUrl);
}

function digestPostUrls(content: string) {
  const urls = new Set<string>();
  const doc = parseDigest(content);
  for (const section of doc.sections) {
    for (const group of section.groups) {
      for (const post of group.posts) {
        for (const media of post.media) {
          if (media.url) urls.add(media.url);
        }
      }
    }
  }
  return [...urls];
}
