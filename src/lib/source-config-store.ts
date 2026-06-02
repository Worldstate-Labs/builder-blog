import type {
  PrismaClient,
  SourceTypeConfig,
  DigestConfig,
  UserSourceTypeConfig,
  UserDigestConfig,
} from "@prisma/client";
import { prisma } from "./prisma";
import {
  DEFAULT_DIGEST_CONFIG,
  ensureSourceConfigsSeeded,
  type ContentQualityShape,
  type DigestConfigShape,
  type SourceSummaryStyle,
  type AgentDefaultStatus,
} from "./source-config-seed";

// The DB is the runtime source of truth for these rows. We cache them
// in-process and invalidate explicitly on writes. We deliberately do
// NOT use `unstable_cache` — the codebase removed it (see commit
// b8e174b "remove unstable_cache from For-You candidate fetch").

let cachedSourceConfigs: Map<string, SourceTypeConfig> | null = null;
let cachedDigestConfig: DigestConfig | null = null;
let seedPromise: Promise<void> | null = null;

function client(): PrismaClient {
  return prisma;
}

// Single-flight first-load seed: concurrent first requests share one
// promise so the table is seeded exactly once across the worker's
// process lifetime.
async function ensureSeededOnce() {
  if (!seedPromise) {
    seedPromise = ensureSourceConfigsSeeded(client()).catch((error) => {
      // Reset on failure so the next caller retries instead of caching
      // a rejected promise forever.
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function loadAllSourceConfigsFromDb(): Promise<Map<string, SourceTypeConfig>> {
  const rows = await client().sourceTypeConfig.findMany();
  return new Map(rows.map((row) => [row.sourceId, row]));
}

export async function getAllSourceConfigs(): Promise<SourceTypeConfig[]> {
  await ensureSeededOnce();
  if (!cachedSourceConfigs) {
    cachedSourceConfigs = await loadAllSourceConfigsFromDb();
  }
  return Array.from(cachedSourceConfigs.values());
}

export async function getSourceConfigMap(): Promise<Map<string, SourceTypeConfig>> {
  await ensureSeededOnce();
  if (!cachedSourceConfigs) {
    cachedSourceConfigs = await loadAllSourceConfigsFromDb();
  }
  return cachedSourceConfigs;
}

export async function getSourceConfig(sourceId: string): Promise<SourceTypeConfig | null> {
  const map = await getSourceConfigMap();
  return map.get(sourceId) ?? null;
}

export async function getDigestConfig(): Promise<DigestConfig> {
  await ensureSeededOnce();
  if (!cachedDigestConfig) {
    const row = await client().digestConfig.findUnique({
      where: { id: DEFAULT_DIGEST_CONFIG.id },
    });
    if (!row) {
      // ensureSeededOnce() creates this row idempotently and nothing in the app
      // deletes the default DigestConfig (only per-user UserDigestConfig rows
      // are removed). A missing row here means seeding never ran or the row was
      // wiped externally — fail loud rather than silently re-creating from
      // defaults and masking a broken seed.
      throw new Error(
        `Default DigestConfig "${DEFAULT_DIGEST_CONFIG.id}" is missing after ` +
          `ensureSeededOnce(); the config seed did not run or was deleted externally.`,
      );
    }
    cachedDigestConfig = row;
  }
  return cachedDigestConfig;
}

// Patch shape accepted by updateSourceConfig. Every field is optional
// and the route validates the JSON columns before they get here.
export type SourceConfigPatch = Partial<{
  label: string;
  agentDefaultStatus: AgentDefaultStatus;
  defaultFetchDays: number;
  defaultFetchLimit: number;
  contentQuality: ContentQualityShape;
  summaryPromptBody: string;
  fetchPromptBody: string | null;
  summaryStyle: SourceSummaryStyle;
}>;

export async function updateSourceConfig(
  sourceId: string,
  patch: SourceConfigPatch,
  actor: string | null,
): Promise<SourceTypeConfig> {
  await ensureSeededOnce();
  const row = await client().sourceTypeConfig.update({
    where: { sourceId },
    data: {
      ...patch,
      ...(patch.contentQuality !== undefined
        ? { contentQuality: patch.contentQuality as object }
        : {}),
      updatedBy: actor,
    },
  });
  invalidateSourceConfigsCache();
  return row;
}

export type DigestConfigPatch = Partial<Omit<DigestConfigShape, "id" | "digestOrder">> & {
  digestOrder?: string[];
};

export async function updateDigestConfig(
  patch: DigestConfigPatch,
  actor: string | null,
): Promise<DigestConfig> {
  await ensureSeededOnce();
  const row = await client().digestConfig.update({
    where: { id: DEFAULT_DIGEST_CONFIG.id },
    data: {
      ...patch,
      ...(patch.digestOrder !== undefined
        ? { digestOrder: patch.digestOrder as object }
        : {}),
      updatedBy: actor,
    },
  });
  invalidateDigestConfigCache();
  return row;
}

export function invalidateSourceConfigsCache() {
  cachedSourceConfigs = null;
}

export function invalidateDigestConfigCache() {
  cachedDigestConfig = null;
}

// Exposed for tests that want a clean slate without re-importing the module.
export function _resetSourceConfigStoreForTests() {
  cachedSourceConfigs = null;
  cachedDigestConfig = null;
  seedPromise = null;
}

// ---------------------------------------------------------------------------
// Per-user content config. The SourceTypeConfig / DigestConfig rows above are
// the system "default" template. Each user gets a full copy, materialized
// lazily on first touch; thereafter the user edits their own rows. Per-user
// rows are read per request (not process-cached) — config reads happen at
// skill-context/sync time, not on a hot path, so we skip cache invalidation.
// ---------------------------------------------------------------------------

// Fields copied verbatim from a default SourceTypeConfig into a user's row
// (everything except the managed updatedAt/updatedBy and the keys).
function sourceConfigCopyData(row: SourceTypeConfig) {
  return {
    label: row.label,
    agentDefaultStatus: row.agentDefaultStatus,
    defaultFetchDays: row.defaultFetchDays,
    defaultFetchLimit: row.defaultFetchLimit,
    contentQuality: row.contentQuality as object,
    summaryPromptBody: row.summaryPromptBody,
    fetchPromptBody: row.fetchPromptBody,
    summaryStyle: row.summaryStyle,
  };
}

// Materialize: ensure the user has a row for every default source. Idempotent
// (skipDuplicates) and forward-safe — sources added to the default later get
// copied on the next call. Concurrent first-touch is safe via the PK conflict.
export async function ensureUserSourceConfigs(
  userId: string,
): Promise<UserSourceTypeConfig[]> {
  await ensureSeededOnce();
  const [defaults, existing] = await Promise.all([
    getSourceConfigMap(),
    client().userSourceTypeConfig.findMany({ where: { userId } }),
  ]);
  const have = new Set(existing.map((r) => r.sourceId));
  const missing = [...defaults.values()].filter((d) => !have.has(d.sourceId));
  if (missing.length > 0) {
    await client().userSourceTypeConfig.createMany({
      data: missing.map((d) => ({ userId, sourceId: d.sourceId, ...sourceConfigCopyData(d) })),
      skipDuplicates: true,
    });
    return client().userSourceTypeConfig.findMany({ where: { userId } });
  }
  return existing;
}

export async function getUserSourceConfigs(
  userId: string,
): Promise<UserSourceTypeConfig[]> {
  return ensureUserSourceConfigs(userId);
}

export async function getUserSourceConfig(
  userId: string,
  sourceId: string,
): Promise<UserSourceTypeConfig | null> {
  const rows = await ensureUserSourceConfigs(userId);
  return rows.find((r) => r.sourceId === sourceId) ?? null;
}

export async function updateUserSourceConfig(
  userId: string,
  sourceId: string,
  patch: SourceConfigPatch,
  actor: string | null,
): Promise<UserSourceTypeConfig> {
  await ensureUserSourceConfigs(userId);
  return client().userSourceTypeConfig.update({
    where: { userId_sourceId: { userId, sourceId } },
    data: {
      ...patch,
      ...(patch.contentQuality !== undefined
        ? { contentQuality: patch.contentQuality as object }
        : {}),
      updatedBy: actor,
    },
  });
}

// Reset: drop the user's rows so the next read re-copies the default template.
export async function resetUserSourceConfigs(userId: string): Promise<void> {
  await client().userSourceTypeConfig.deleteMany({ where: { userId } });
}

export async function getUserDigestConfig(userId: string): Promise<UserDigestConfig> {
  const existing = await client().userDigestConfig.findUnique({ where: { userId } });
  if (existing) return existing;
  const def = await getDigestConfig();
  return client().userDigestConfig.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      digestIntro: def.digestIntro,
      translate: def.translate,
      digestOrder: def.digestOrder as object,
      commonSummaryRules: def.commonSummaryRules,
    },
  });
}

export async function updateUserDigestConfig(
  userId: string,
  patch: DigestConfigPatch,
  actor: string | null,
): Promise<UserDigestConfig> {
  await getUserDigestConfig(userId);
  return client().userDigestConfig.update({
    where: { userId },
    data: {
      ...patch,
      ...(patch.digestOrder !== undefined
        ? { digestOrder: patch.digestOrder as object }
        : {}),
      updatedBy: actor,
    },
  });
}

export async function resetUserDigestConfig(userId: string): Promise<void> {
  await client().userDigestConfig.deleteMany({ where: { userId } });
}
