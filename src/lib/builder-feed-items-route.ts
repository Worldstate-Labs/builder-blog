import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { fetchDedupedFeedForEntities } from "@/lib/builder-channel-resolver";
import { isPlatformMaintainedSourceType } from "@/lib/platform-maintained-sources";
import { prisma } from "@/lib/prisma";
import { resolveUserContentBuilderIds } from "@/lib/user-content-builders";

type Params = { params: Promise<{ builderId: string }> };

const feedItemLimit = 8;

export type BuilderFeedItemsRouteDeps = {
  getCurrentSession: typeof getCurrentSession;
  activePoolBuilderIds: typeof activePoolBuilderIds;
  resolveUserContentBuilderIds: typeof resolveUserContentBuilderIds;
  fetchDedupedFeedForEntities: typeof fetchDedupedFeedForEntities;
  prisma: {
    builder: {
      findUnique(args: unknown): Promise<{
        entityId: string | null;
        sourceType: string | null;
      } | null>;
    };
    libraryHubItem: {
      findFirst(args: unknown): Promise<{ builderId: string } | null>;
    };
  };
};

type BuilderFeedAccess = {
  allowed: boolean;
  entityId: string | null;
  contentBuilderIds: string[];
};

const defaultDeps: BuilderFeedItemsRouteDeps = {
  getCurrentSession,
  activePoolBuilderIds,
  resolveUserContentBuilderIds,
  fetchDedupedFeedForEntities,
  prisma,
};

export function createBuilderFeedItemsGetHandler(
  deps: BuilderFeedItemsRouteDeps = defaultDeps,
) {
  return async function GET(_request: Request, { params }: Params) {
    const session = await deps.getCurrentSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { builderId } = await params;
    const access = await resolveBuilderFeedAccess({
      builderId,
      userId: session.user.id,
      deps,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Source is not in your source library." }, { status: 404 });
    }
    if (!access.entityId) {
      return NextResponse.json({ items: [] });
    }

    try {
      const items = await deps.fetchDedupedFeedForEntities({
        userId: session.user.id,
        entityIds: [access.entityId],
        builderIds: access.contentBuilderIds,
        limit: feedItemLimit,
      });

      return NextResponse.json({
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          externalId: item.externalId,
          title: item.title,
          headline: item.headline,
          body: item.body,
          summary: item.summary,
          url: item.url,
          publishedAt: item.publishedAt,
          createdAt: item.createdAt,
          sourceName: item.sourceName,
          fetchTool: item.fetchTool,
          alternateChannelCount: item.alternateChannelCount,
        })),
      });
    } catch (error) {
      // Without this, every prisma/dedup hiccup surfaces as a bare 500
      // and the client only sees "Could not load summarized posts" with
      // no way to triage. Logging the builder + entity pair makes the
      // failure findable in server logs without leaking internals to
      // the response.
      console.error("feed-items query failed", {
        builderId,
        entityId: access.entityId,
        userId: session.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Could not load summarized posts.", code: "fetch_failed" },
        { status: 500 },
      );
    }
  };
}

export async function resolveBuilderFeedAccess(params: {
  builderId: string;
  userId: string;
  deps?: BuilderFeedItemsRouteDeps;
}): Promise<BuilderFeedAccess> {
  const deps = params.deps ?? defaultDeps;
  const builder = await deps.prisma.builder.findUnique({
    where: { id: params.builderId },
    select: { entityId: true, sourceType: true },
  });
  if (!builder) {
    return { allowed: false, entityId: null, contentBuilderIds: [] };
  }

  const poolBuilderIds = await deps.activePoolBuilderIds(params.userId);
  if (isPlatformMaintainedSourceType(builder.sourceType)) {
    const contentBuilderIds = await deps.resolveUserContentBuilderIds({
      userId: params.userId,
      logicalBuilderIds: poolBuilderIds,
    });
    return {
      allowed: contentBuilderIds.includes(params.builderId),
      entityId: builder.entityId,
      contentBuilderIds,
    };
  }

  if (poolBuilderIds.includes(params.builderId)) {
    return {
      allowed: true,
      entityId: builder.entityId,
      contentBuilderIds: await deps.resolveUserContentBuilderIds({
        userId: params.userId,
        logicalBuilderIds: [params.builderId],
      }),
    };
  }

  const hubItem = await deps.prisma.libraryHubItem.findFirst({
    where: { builderId: params.builderId },
    select: { builderId: true },
  });
  if (!hubItem) {
    return { allowed: false, entityId: builder.entityId, contentBuilderIds: [] };
  }

  return {
    allowed: true,
    entityId: builder.entityId,
    contentBuilderIds: await deps.resolveUserContentBuilderIds({
      userId: params.userId,
      logicalBuilderIds: [params.builderId],
    }),
  };
}
