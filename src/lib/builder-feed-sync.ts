import { BuilderPoolOrigin, type BuilderKind, type FeedItemKind } from "@prisma/client";
import type { z } from "zod";
import { isAdminFetchOnlySourceType } from "@/lib/admin-fetch-only-sources";
import { canonicalPostUrl } from "@/lib/canonical-url";
import { checkBodyContentQuality } from "@/lib/content-quality";
import {
  actualContentLanguagesMatch,
  detectTextLanguage,
  normalizeConcreteLanguageTag,
  resolveSummaryTargetLanguage,
} from "@/lib/content-language";
import { isOriginalContentLanguagePreference } from "@/lib/language-preference";
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

export type FetchSyncBoundaryTask = Record<string, unknown> & {
  id: string;
  builderId?: string | null;
  cloudSourceTaskId?: string | null;
  agentWorkType?: string | null;
  builderSync?: Record<string, unknown> | null;
  item?: Record<string, unknown> | null;
};

export class FetchSyncTaskBoundaryError extends Error {
  readonly statusCode = 400;
  readonly code = "fetch_sync_task_boundary_violation";

  constructor(readonly violations: string[]) {
    super(`Fetch sync task boundary failed: ${violations.join("; ")}`);
    this.name = "FetchSyncTaskBoundaryError";
  }
}

function boundaryRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundaryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundaryTaskBuilderId(task: FetchSyncBoundaryTask): string {
  return boundaryText(boundaryRecord(task.builderSync).builderId) || boundaryText(task.builderId);
}

function boundaryTaskAcceptsItems(task: FetchSyncBoundaryTask): boolean {
  const id = boundaryText(task.id);
  const workType = boundaryText(task.agentWorkType);
  return !(
    workType === "candidate_discovery_fallback" ||
    workType === "user_action" ||
    workType.startsWith("user_action_") ||
    workType === "x_token_missing" ||
    workType === "x_token_invalid" ||
    id.startsWith("candidate_discovery:")
  );
}

function boundaryIdentityValue(field: string, value: unknown): unknown {
  if (field === "publishedAt") {
    if (value == null || value === "") return null;
    const timestamp = new Date(String(value));
    return Number.isNaN(timestamp.getTime()) ? String(value) : timestamp.toISOString();
  }
  if (value == null) return null;
  return typeof value === "string" ? value.trim() : value;
}

function validateBoundaryItemIdentity(
  task: FetchSyncBoundaryTask,
  item: BuilderFeedSyncInput["items"][number],
  violations: string[],
) {
  if (boundaryText(task.agentWorkType) === "fetch_builder_fallback") return;
  const plannedItem = boundaryRecord(task.item);
  for (const field of ["kind", "externalId", "title", "url", "publishedAt", "sourceName"] as const) {
    if (!(field in plannedItem)) continue;
    const planned = boundaryIdentityValue(field, plannedItem[field]);
    const submitted = boundaryIdentityValue(field, item[field]);
    if (submitted !== planned) violations.push(`${task.id}:${field}_mismatch`);
  }
}

export function validateFetchSyncTaskBoundary({
  plannedTasks,
  builders,
  taskOutcomes,
}: {
  plannedTasks: FetchSyncBoundaryTask[];
  builders: BuilderFeedSyncInput[];
  taskOutcomes: Array<{ fetchTaskId: string }>;
}) {
  const violations: string[] = [];
  const plannedById = new Map<string, FetchSyncBoundaryTask>();
  for (const task of plannedTasks) {
    const id = boundaryText(task.id);
    if (!id) continue;
    if (plannedById.has(id)) violations.push(`${id}:duplicate_planned_task_id`);
    else plannedById.set(id, task);
  }

  const terminalCounts = new Map<string, number>();
  const countTerminal = (id: string) => terminalCounts.set(id, (terminalCounts.get(id) ?? 0) + 1);
  for (const builder of builders) {
    for (const item of builder.items) {
      const rawJson = boundaryRecord(item.rawJson);
      const fetchTaskId = boundaryText(rawJson.fetchTaskId);
      const task = plannedById.get(fetchTaskId);
      if (!task) {
        violations.push(`${fetchTaskId || "missing"}:unknown_fetch_task_id`);
        continue;
      }
      countTerminal(fetchTaskId);
      if (!boundaryTaskAcceptsItems(task)) {
        violations.push(`${fetchTaskId}:task_does_not_accept_items`);
        continue;
      }
      const expectedBuilderId = boundaryTaskBuilderId(task);
      if (expectedBuilderId && boundaryText(builder.builderId) !== expectedBuilderId) {
        violations.push(`${fetchTaskId}:builderId_mismatch`);
      }
      const rawBuilderId = boundaryText(rawJson.builderId);
      if (rawBuilderId && expectedBuilderId && rawBuilderId !== expectedBuilderId) {
        violations.push(`${fetchTaskId}:rawJson.builderId_mismatch`);
      }
      validateBoundaryItemIdentity(task, item, violations);
    }
  }

  for (const outcome of taskOutcomes) {
    const fetchTaskId = boundaryText(outcome.fetchTaskId);
    if (!plannedById.has(fetchTaskId)) {
      violations.push(`${fetchTaskId || "missing"}:unknown_fetch_task_id`);
      continue;
    }
    countTerminal(fetchTaskId);
  }

  for (const [fetchTaskId, count] of terminalCounts) {
    const task = plannedById.get(fetchTaskId);
    if (count > 1 && boundaryText(task?.agentWorkType) !== "fetch_builder_fallback") {
      violations.push(`${fetchTaskId}:duplicate_task_result`);
    }
    if (
      boundaryText(task?.agentWorkType) === "fetch_builder_fallback" &&
      taskOutcomes.some((outcome) => boundaryText(outcome.fetchTaskId) === fetchTaskId) &&
      builders.some((builder) => builder.items.some((item) =>
        boundaryText(boundaryRecord(item.rawJson).fetchTaskId) === fetchTaskId
      ))
    ) {
      violations.push(`${fetchTaskId}:duplicate_task_result`);
    }
  }

  if (violations.length > 0) throw new FetchSyncTaskBoundaryError(violations);
  return { plannedTasks: plannedById.size, submittedTasks: terminalCounts.size };
}

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

      const languageMetadata = resolveFeedItemLanguageMetadata({
        item,
        requestedSummaryLanguage: summaryLanguage,
        summary,
      });
      if (languageMetadata.error) {
        result.skippedFeedItems += 1;
        if (fetchTaskId) {
          result.itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "failed",
            reason: languageMetadata.error,
          });
        }
        continue;
      }
      const itemRawJson = rawJsonWithLanguageMetadata(
        item.rawJson,
        summaryLanguage,
        languageMetadata,
      );
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
          contentLanguage: languageMetadata.contentLanguage,
          summaryContentLanguage: languageMetadata.summaryContentLanguage,
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
          contentLanguage: languageMetadata.contentLanguage,
          summaryContentLanguage: languageMetadata.summaryContentLanguage,
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
          contentLanguage: languageMetadata.contentLanguage,
          summaryContentLanguage: languageMetadata.summaryContentLanguage,
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
  if (
    record.agentWorkType === "translate_summary_only" ||
    record.agentWorkType === "translate_summary_to_content_language"
  ) return true;
  const hubSharedReuse = rawJsonRecord(record.hubSharedReuse);
  return (
    hubSharedReuse.bodyReused === false &&
    (hubSharedReuse.summaryReused === true || hubSharedReuse.summaryTranslated === true)
  );
}

type FeedItemLanguageMetadata = {
  contentLanguage: string | null;
  summaryContentLanguage: string | null;
  contentResolution: string | null;
  summaryResolution: string | null;
  error?: string;
};

export function rawJsonWithLanguageMetadata(
  rawJson: unknown,
  requestedSummaryLanguage: string,
  metadata: FeedItemLanguageMetadata,
) {
  const record = rawJsonRecord(rawJson);
  return {
    ...record,
    requestedSummaryLanguage,
    languageResolution: {
      content: metadata.contentResolution,
      summary: metadata.summaryResolution,
    },
  };
}

export function resolveFeedItemLanguageMetadata({
  item,
  requestedSummaryLanguage,
  summary,
}: {
  item: BuilderFeedSyncInput["items"][number];
  requestedSummaryLanguage: string;
  summary: string;
}): FeedItemLanguageMetadata {
  const rawJson = rawJsonRecord(item.rawJson);
  const explicitContent = firstRawLanguage(
    item.contentLanguage,
    rawJson.contentLanguage,
    rawJson.captionLanguageCode,
    rawJsonRecord(rawJson.tweet).lang,
  );
  if (hasInvalidConcreteLanguage(item.contentLanguage)) {
    return languageError("invalid_content_language");
  }
  const detectedContent = detectTextLanguage(item.body);
  const contentLanguage = explicitContent ?? detectedContent.language;
  if (
    explicitContent &&
    detectedContent.language &&
    !actualContentLanguagesMatch(explicitContent, detectedContent.language)
  ) {
    return languageError("content_language_mismatch");
  }

  const explicitSummary = firstRawLanguage(
    item.summaryContentLanguage,
    rawJson.summaryContentLanguage,
  );
  if (hasInvalidConcreteLanguage(item.summaryContentLanguage)) {
    return languageError("invalid_summary_content_language");
  }
  const legacySummary = !isOriginalContentLanguagePreference(rawJson.summaryLanguage as string | undefined)
    ? normalizeConcreteLanguageTag(rawJson.summaryLanguage as string | undefined)
    : null;
  const detectedSummary = detectTextLanguage(summary);
  const fixedTarget = isOriginalContentLanguagePreference(requestedSummaryLanguage)
    ? null
    : resolveSummaryTargetLanguage(requestedSummaryLanguage, contentLanguage);
  const summaryContentLanguage = explicitSummary ?? detectedSummary.language ?? legacySummary ?? fixedTarget;
  if (
    explicitSummary &&
    detectedSummary.language &&
    !actualContentLanguagesMatch(explicitSummary, detectedSummary.language)
  ) {
    return languageError("summary_language_mismatch");
  }

  const resolvedTarget = resolveSummaryTargetLanguage(requestedSummaryLanguage, contentLanguage);
  if (
    resolvedTarget &&
    summaryContentLanguage &&
    !actualContentLanguagesMatch(summaryContentLanguage, resolvedTarget)
  ) {
    return languageError("summary_language_mismatch");
  }

  return {
    contentLanguage,
    summaryContentLanguage,
    contentResolution: explicitContent ? "explicit" : detectedContent.language ? "text" : null,
    summaryResolution: explicitSummary
      ? "explicit"
      : detectedSummary.language
        ? "text"
        : legacySummary
          ? "legacy_fixed"
          : fixedTarget
            ? "requested_fixed"
            : null,
  };
}

function firstRawLanguage(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalized = normalizeConcreteLanguageTag(value);
    if (normalized) return normalized;
  }
  return null;
}

function hasInvalidConcreteLanguage(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !normalizeConcreteLanguageTag(value);
}

function languageError(error: string): FeedItemLanguageMetadata {
  return {
    contentLanguage: null,
    summaryContentLanguage: null,
    contentResolution: null,
    summaryResolution: null,
    error,
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
