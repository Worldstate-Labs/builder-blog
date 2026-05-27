import type { PrismaClient, SourceTypeConfig, DigestConfig } from "@prisma/client";
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
    const row =
      (await client().digestConfig.findUnique({ where: { id: DEFAULT_DIGEST_CONFIG.id } })) ??
      // Defensive: if a parallel writer wiped the row between seed and
      // read, fall back to creating it again from defaults rather than
      // throwing at request time.
      (await client().digestConfig.create({
        data: {
          id: DEFAULT_DIGEST_CONFIG.id,
          digestTopPrompt: DEFAULT_DIGEST_CONFIG.digestTopPrompt,
          digestIntro: DEFAULT_DIGEST_CONFIG.digestIntro,
          translate: DEFAULT_DIGEST_CONFIG.translate,
          digestOrder: DEFAULT_DIGEST_CONFIG.digestOrder as object,
          commonSummaryRules: DEFAULT_DIGEST_CONFIG.commonSummaryRules,
        },
      }));
    cachedDigestConfig = row;
  }
  return cachedDigestConfig;
}

// Patch shape accepted by updateSourceConfig. Every field is optional
// and the route validates the JSON columns before they get here.
export type SourceConfigPatch = Partial<{
  label: string;
  agentDefaultStatus: AgentDefaultStatus;
  defaultCrawlDays: number;
  defaultCrawlLimit: number;
  contentQuality: ContentQualityShape;
  summaryPromptBody: string;
  summaryStyle: SourceSummaryStyle;
  summaryLanguage: string;
  summaryLengthHint: string | null;
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
