import { BuilderPoolOrigin, type BuilderKind, type FeedItemKind } from "@prisma/client";
import type { z } from "zod";
import { isAdminFetchOnlySourceType } from "@/lib/admin-fetch-only-sources";
import { canonicalPostUrl } from "@/lib/canonical-url";
import { checkBodyContentQuality } from "@/lib/content-quality";
import { validatePublicHttpUrl } from "@/lib/safe-url";
import { SkillBuilderSchema } from "@/lib/skill-contracts";
import { prepareFeedItemStorage } from "@/lib/source-content-policy";
import { resolveAvatarDataUrl } from "@/lib/builder-enrichment";
import { resolveSourceAvatar } from "@/lib/source-avatar-persistence";
import type { CandidateAvatarLookup } from "@/lib/source-avatar-persistence";

export type BuilderFeedSyncInput = z.infer<typeof SkillBuilderSchema>;

export type BuilderFeedSyncItemResult = {
  fetchTaskId: string;
  kind: FeedItemKind;
  externalId: string;
  status: "synced" | "failed";
  reason?: string;
};

export type BuilderFeedSyncResult = {
  builders: number;
  feedItems: number;
  skippedFeedItems: number;
  subscriptions: number;
  itemResults: BuilderFeedSyncItemResult[];
};

type BuilderFeedSyncMode =
  | {
      type: "personal";
      user: {
        id: string;
        name: string | null;
      };
      userIsAdmin: boolean;
    }
  | {
      type: "existing";
      allowedBuilderIds?: Set<string>;
    };

type BuilderFeedSyncPrisma = Partial<CandidateAvatarLookup> & {
  builder: {
    findFirst(args: unknown): Promise<BuilderFeedSyncBuilder | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  canonicalPost: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  feedItem: {
    findMany(args: unknown): Promise<Array<{ kind: FeedItemKind; externalId: string }>>;
    updateMany(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  subscription?: {
    upsert(args: unknown): Promise<unknown>;
  };
  userChannelPreference?: {
    upsert(args: unknown): Promise<unknown>;
  };
};

type BuilderFeedSyncBuilder = {
  id: string;
  entityId?: string | null;
};

type AddBuilderToPoolFn = (params: {
  userId: string;
  builderId: string;
  origin: BuilderPoolOrigin;
}) => Promise<unknown>;
type UpsertBuilderFn = (params: {
  ownerUserId: string;
  kind: BuilderKind;
  sourceType?: string | null;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
  avatarUrl?: string | null;
  avatarDataUrl?: string | null;
  bio?: string | null;
  addedByUserId?: string | null;
}) => Promise<BuilderFeedSyncBuilder>;

export function emptyBuilderFeedSyncResult(): BuilderFeedSyncResult {
  return {
    builders: 0,
    feedItems: 0,
    skippedFeedItems: 0,
    subscriptions: 0,
    itemResults: [],
  };
}

export async function syncBuilderFeedItems({
  prisma,
  builders,
  force,
  fetchTool,
  summaryLanguage,
  mode,
  now = new Date(),
  result = emptyBuilderFeedSyncResult(),
  contentStandardsBySourceId,
  addBuilderToPoolFn,
  upsertBuilderFn,
}: {
  prisma: BuilderFeedSyncPrisma;
  builders: BuilderFeedSyncInput[];
  force: boolean;
  fetchTool: string;
  summaryLanguage: string;
  mode: BuilderFeedSyncMode;
  now?: Date;
  result?: BuilderFeedSyncResult;
  contentStandardsBySourceId?: Map<string, unknown>;
  addBuilderToPoolFn?: AddBuilderToPoolFn;
  upsertBuilderFn?: UpsertBuilderFn;
}): Promise<BuilderFeedSyncResult> {
  const standardsBySourceId =
    contentStandardsBySourceId ?? await loadContentStandardsBySourceId();
  const resolveStandards = (sourceType: string | null | undefined) =>
    standardsBySourceId.get((sourceType ?? "").trim()) ??
    standardsBySourceId.get("website") ??
    null;

  for (const input of builders) {
    validateSyncSourceUrls(input);
    const referencedBuilder = await findExistingBuilderForSync(prisma, mode, input);
    if (referencedBuilder.status === "invalid") {
      throw builderFeedSyncError(referencedBuilder.error, 400);
    }
    if (mode.type === "personal" && !mode.userIsAdmin && isAdminFetchOnlySourceType(input.sourceType)) {
      result.skippedFeedItems += input.items.length;
      for (const item of input.items) {
        const fetchTaskId = readFetchTaskId(item.rawJson);
        if (fetchTaskId) {
          result.itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "failed",
            reason: "admin_fetch_only_source",
          });
        }
      }
      continue;
    }

    const builder = referencedBuilder.builder ?? await createPersonalBuilder({
      input,
      mode,
      prisma,
      upsertBuilderFn: upsertBuilderFn ?? (await loadUpsertBuilderFn()),
    });

    if (mode.type === "personal") {
      const poolFn = addBuilderToPoolFn ?? (await loadAddBuilderToPoolFn());
      await poolFn({
        userId: mode.user.id,
        builderId: builder.id,
        origin: BuilderPoolOrigin.PERSONAL_SYNC,
      });
      if (input.subscribe) {
        await syncPersonalSubscription({
          prisma,
          userId: mode.user.id,
          builder,
        });
        result.subscriptions += 1;
      }
    }
    result.builders += 1;

    const existingItemKeys = force
      ? new Set<string>()
      : await existingFeedItemKeys(
          prisma,
          builder.id,
          input.items.map((item) => ({ kind: item.kind, externalId: item.externalId })),
        );
    let syncedItemCount = 0;
    const payloadItemKeys = new Set<string>();
    const contentStandards = resolveStandards(input.sourceType);
    for (const item of input.items) {
      const key = feedItemKey(builder.id, item.kind, item.externalId);
      if (payloadItemKeys.has(key)) {
        result.skippedFeedItems += 1;
        continue;
      }
      payloadItemKeys.add(key);
      const fetchTaskId = readFetchTaskId(item.rawJson);
      const headline = typeof item.headline === "string" ? item.headline.trim() : "";
      const summary = typeof item.summary === "string" ? item.summary.trim() : "";
      if (!summary) {
        result.skippedFeedItems += 1;
        if (fetchTaskId) {
          result.itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "failed",
            reason: "summary_missing",
          });
        }
        continue;
      }
      const headlineError = validatePostHeadlineForSync(headline, {
        title: item.title,
        summary,
      });
      if (headlineError) {
        result.skippedFeedItems += 1;
        if (fetchTaskId) {
          result.itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "failed",
            reason: headlineError,
          });
        }
        continue;
      }

      const itemRawJson = rawJsonWithSummaryLanguage(item.rawJson, summaryLanguage, summary);
      const storage = prepareFeedItemStorage({
        sourceType: input.sourceType,
        body: item.body,
        summary,
        rawJson: itemRawJson,
      });
      const canSyncWithoutBody = itemCanSyncWithoutBody(storage.policy.durableRawMode, itemRawJson);
      if (!storage.body.trim() && !canSyncWithoutBody) {
        result.skippedFeedItems += 1;
        if (fetchTaskId) {
          result.itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "failed",
            reason: "body_missing",
          });
        }
        continue;
      }
      if (
        !canSyncWithoutBody &&
        (storage.policy.durableRawMode === "full" || storage.policy.durableRawMode === "excerpt")
      ) {
        const contentVerdict = checkBodyContentQuality(item.body, contentStandards);
        if (!contentVerdict.ok) {
          result.skippedFeedItems += 1;
          if (fetchTaskId) {
            result.itemResults.push({
              fetchTaskId,
              kind: item.kind,
              externalId: item.externalId,
              status: "failed",
              reason: contentVerdict.reason,
            });
          }
          continue;
        }
      }

      const itemFetchTool = item.fetchTool ?? fetchToolFromRawJson(item.rawJson) ?? fetchTool;
      const canonicalPostId = await ensureCanonicalPostId(prisma, item.url);
      if (!force && existingItemKeys.has(key)) {
        const updateData = {
          headline,
          summary,
          body: storage.body,
          rawJson: JSON.stringify(storage.rawJson),
          ...(canonicalPostId ? { canonicalPostId } : {}),
        };
        await prisma.feedItem.updateMany({
          where: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
          },
          data: updateData,
        });
        await prisma.feedItem.updateMany({
          where: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
            OR: [{ fetchTool: null }, { fetchTool: "Legacy fetch/import" }],
          },
          data: { fetchTool: itemFetchTool },
        });
        result.skippedFeedItems += 1;
        if (fetchTaskId) {
          result.itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "synced",
          });
        }
        continue;
      }
      await prisma.feedItem.upsert({
        where: {
          builderId_kind_externalId: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
          },
        },
        update: {
          title: item.title,
          headline,
          body: storage.body,
          summary,
          url: item.url,
          ...(canonicalPostId ? { canonicalPostId } : {}),
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
          sourceName: item.sourceName ?? input.name,
          fetchTool: itemFetchTool,
          rawJson: JSON.stringify(storage.rawJson),
        },
        create: {
          builderId: builder.id,
          kind: item.kind,
          externalId: item.externalId,
          title: item.title,
          headline,
          body: storage.body,
          summary,
          url: item.url,
          ...(canonicalPostId ? { canonicalPostId } : {}),
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          sourceName: item.sourceName ?? input.name,
          fetchTool: itemFetchTool,
          rawJson: JSON.stringify(storage.rawJson),
        },
      });
      result.feedItems += 1;
      syncedItemCount += 1;
      if (fetchTaskId) {
        result.itemResults.push({
          fetchTaskId,
          kind: item.kind,
          externalId: item.externalId,
          status: "synced",
        });
      }
    }

    await prisma.builder.update({
      where: { id: builder.id },
      data: {
        lastFetchedAt: now,
        ...(force ? { lastForcedAt: now } : {}),
        itemCount: syncedItemCount,
        status: "OK",
        lastError: null,
      },
    });
  }

  return result;
}

async function loadAddBuilderToPoolFn(): Promise<AddBuilderToPoolFn> {
  const builderPool = await import("@/lib/builder-pool");
  return builderPool.addBuilderToPool;
}

async function loadUpsertBuilderFn(): Promise<UpsertBuilderFn> {
  const builders = await import("@/lib/builders");
  return builders.upsertBuilder;
}

function builderFeedSyncError(message: string, statusCode = 500) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

async function loadContentStandardsBySourceId() {
  const { getAllSourceConfigs } = await import("@/lib/source-config-store");
  const sourceConfigs = await getAllSourceConfigs();
  return new Map(sourceConfigs.map((c) => [c.sourceId, c.contentQuality as unknown]));
}

function validateSyncSourceUrls(input: BuilderFeedSyncInput) {
  for (const candidate of [input.sourceUrl, input.fetchUrl]) {
    if (!candidate) continue;
    const check = validatePublicHttpUrl(candidate);
    if (!check.ok) {
      throw builderFeedSyncError(
        `Source URL is not allowed (${input.name}): ${check.reason}.`,
        400,
      );
    }
  }
}

async function findExistingBuilderForSync(
  prisma: BuilderFeedSyncPrisma,
  mode: BuilderFeedSyncMode,
  input: {
    builderId?: string | null;
    items: Array<{ rawJson?: unknown }>;
    name: string;
  },
) {
  const builderId = input.builderId ?? builderIdFromItems(input.items);
  if (!builderId) {
    return mode.type === "personal"
      ? { status: "none" as const, builder: null }
      : {
          status: "invalid" as const,
          error: `Cloud sync payload is missing builderId for source ${input.name}.`,
        };
  }
  if (mode.type === "existing" && mode.allowedBuilderIds && !mode.allowedBuilderIds.has(builderId)) {
    return {
      status: "invalid" as const,
      error: "Referenced source was not leased for this cloud run.",
    };
  }

  const builder = await prisma.builder.findFirst({
    where: {
      id: builderId,
      ...(mode.type === "personal" ? { ownerUserId: mode.user.id } : {}),
    },
  });
  if (!builder) {
    return {
      status: "invalid" as const,
      error: "Referenced source was not found for this user.",
    };
  }
  return { status: "ok" as const, builder };
}

async function createPersonalBuilder({
  input,
  mode,
  prisma,
  upsertBuilderFn,
}: {
  input: BuilderFeedSyncInput;
  mode: BuilderFeedSyncMode;
  prisma: BuilderFeedSyncPrisma;
  upsertBuilderFn: UpsertBuilderFn;
}) {
  if (mode.type !== "personal") {
    throw builderFeedSyncError(`Cloud sync payload is missing builderId for source ${input.name}.`, 400);
  }
  const avatar = await resolveSourceAvatar({
    source: input,
    probeWhenMissing: true,
    prismaClient: prisma.sourceCandidate ? prisma as CandidateAvatarLookup : undefined,
  });
  if (!avatar.avatarDataUrl) {
    avatar.avatarDataUrl = await resolveAvatarDataUrl(avatar.avatarUrl);
  }
  return upsertBuilderFn({
    ownerUserId: mode.user.id,
    addedByUserId: mode.user.id,
    kind: input.kind,
    sourceType: input.sourceType,
    name: input.name,
    handle: input.handle,
    sourceUrl: input.sourceUrl,
    fetchUrl: input.fetchUrl,
    avatarUrl: avatar.avatarUrl,
    avatarDataUrl: avatar.avatarDataUrl,
    bio: input.bio,
  });
}

async function syncPersonalSubscription({
  prisma,
  userId,
  builder,
}: {
  prisma: BuilderFeedSyncPrisma;
  userId: string;
  builder: BuilderFeedSyncBuilder;
}) {
  if (!prisma.subscription || !prisma.userChannelPreference) {
    throw builderFeedSyncError("Builder sync prisma client is missing subscription writers.");
  }
  await prisma.subscription.upsert({
    where: { userId_builderId: { userId, builderId: builder.id } },
    update: {},
    create: { userId, builderId: builder.id },
  });
  const entityId = builder.entityId;
  if (entityId) {
    await prisma.userChannelPreference.upsert({
      where: { userId_entityId: { userId, entityId } },
      update: {},
      create: {
        userId,
        entityId,
        primaryBuilderId: builder.id,
        pinnedByUser: false,
      },
    });
  }
}

// fetchTaskId travels on the synced item's rawJson (set by the agent per the
// fetch-task contract). It binds a persisted item back to its planned task.
export function readFetchTaskId(rawJson: unknown): string | null {
  if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    const value = (rawJson as Record<string, unknown>).fetchTaskId;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// Attribution for an agent-extracted item. The fetch-task contract has agents
// record the real runtime/model in rawJson (not item.fetchTool), so derive the
// fetchTool label from those before falling back to the payload-level default
// (which is the generic "manual JSON sync" string).
export function fetchToolFromRawJson(rawJson: unknown): string | null {
  if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    const o = rawJson as Record<string, unknown>;
    const runtime = typeof o.agentRuntime === "string" ? o.agentRuntime.trim() : "";
    const model = typeof o.agentModel === "string" ? o.agentModel.trim() : "";
    if (runtime) return model ? `${runtime} (model ${model})` : runtime;
  }
  return null;
}

export function rawJsonRecord(rawJson: unknown): Record<string, unknown> {
  return rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
    ? rawJson as Record<string, unknown>
    : {};
}

export function itemCanSyncWithoutBody(durableRawMode: string, rawJson: unknown) {
  if (durableRawMode === "none") return true;
  const record = rawJsonRecord(rawJson);
  if (record.agentWorkType === "translate_summary_only") return true;
  const hubSharedReuse = rawJsonRecord(record.hubSharedReuse);
  return (
    hubSharedReuse.bodyReused === false &&
    (hubSharedReuse.summaryReused === true || hubSharedReuse.summaryTranslated === true)
  );
}

export function rawJsonWithSummaryLanguage(rawJson: unknown, summaryLanguage: string, summary: string) {
  const record = rawJsonRecord(rawJson);
  if (!summary.trim()) return record;
  return {
    ...record,
    summaryLanguage: typeof record.summaryLanguage === "string" && record.summaryLanguage.trim()
      ? record.summaryLanguage
      : summaryLanguage,
  };
}

export function syncTextStats(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return {
    chars: text.length,
    words: text ? text.split(/\s+/u).length : 0,
  };
}

function normalizeSyncText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isNearDuplicateSyncText(text: string, reference: unknown) {
  const normalizedReference = normalizeSyncText(reference);
  if (!text || !normalizedReference) return false;
  if (text === normalizedReference) return true;
  return text.length <= normalizedReference.length + 20 && normalizedReference.includes(text);
}

function validatePostHeadlineForSync(headline: string, {
  title,
  summary,
}: {
  title?: string | null;
  summary?: string | null;
}) {
  const normalized = normalizeSyncText(headline);
  if (!normalized) return "headline_missing";
  if (normalized.length > 180) return "headline_too_long";
  if (syncTextStats(normalized).words > 20) return "headline_too_long";
  if (isNearDuplicateSyncText(normalized, title)) return "headline_duplicates_title";
  if (normalizeSyncText(summary) && normalized === normalizeSyncText(summary)) {
    return "headline_duplicates_summary";
  }
  return null;
}

async function ensureCanonicalPostId(prisma: BuilderFeedSyncPrisma, url: string) {
  const canonicalUrl = canonicalPostUrl(url);
  if (!canonicalUrl) return null;
  const canonicalPost = await prisma.canonicalPost.upsert({
    where: { canonicalUrl },
    update: {},
    create: { canonicalUrl },
    select: { id: true },
  });
  return canonicalPost.id;
}

async function existingFeedItemKeys(
  prisma: BuilderFeedSyncPrisma,
  builderId: string,
  items: Array<{ kind: FeedItemKind; externalId: string }>,
) {
  if (items.length === 0) return new Set<string>();
  const existing = await prisma.feedItem.findMany({
    where: {
      builderId,
      OR: items.map((item) => ({
        kind: item.kind,
        externalId: item.externalId,
      })),
    },
    select: {
      kind: true,
      externalId: true,
    },
  });
  return new Set(existing.map((item) => feedItemKey(builderId, item.kind, item.externalId)));
}

function feedItemKey(builderId: string, kind: FeedItemKind, externalId: string) {
  return `${builderId}:${kind}:${externalId}`;
}

function builderIdFromItems(items: Array<{ rawJson?: unknown }>) {
  const ids = new Set<string>();
  for (const item of items) {
    const rawJson = item.rawJson;
    if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) continue;
    const builderId = "builderId" in rawJson ? rawJson.builderId : null;
    if (typeof builderId === "string" && builderId.trim()) ids.add(builderId.trim());
  }
  return ids.size === 1 ? [...ids][0] : null;
}
