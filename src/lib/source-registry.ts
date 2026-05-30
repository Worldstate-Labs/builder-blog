import { BuilderKind, FeedItemKind, type SourceTypeConfig } from "@prisma/client";
import sourcesConfig from "../../config/sources.json";

type BuilderSourceInput = {
  kind: BuilderKind;
  sourceType?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
};

// Code-bound static fields only. Admin-editable fields (label, prompts,
// content quality, fetch defaults) live in `SourceTypeConfig` and must
// be read via the async getters below — never from sources.json at
// request time.
export type SourceDefinition = {
  id: string;
  builderKind: BuilderKind;
  feedItemKinds: FeedItemKind[];
  urlPatterns: string[];
  matchesBuilder?: (builder: BuilderSourceInput) => boolean;
  // Static label kept around so synchronous helpers that need a
  // human-readable name (used by code paths that pre-date the DB-backed
  // store) keep working. Treat as a fallback; admin-edited labels live
  // in `SourceTypeConfig.label`.
  staticLabel: string;
};

// Async-merged definition: static metadata + DB-backed admin fields.
export type MergedSourceDefinition = SourceDefinition & {
  label: string;
  agentDefaultStatus: string;
  defaultFetchDays: number;
  defaultFetchLimit: number;
  contentQuality: unknown;
  summaryPromptBody: string;
  fetchPromptBody: string | null;
  summaryStyle: string;
  summaryLanguage: string;
  summaryLengthHint: string | null;
};

function buildSourceDefinitions(): SourceDefinition[] {
  return sourcesConfig.sources.map((entry) => {
    const compiledPatterns = entry.urlPatterns.map((p) => new RegExp(p, "i"));
    const def: SourceDefinition = {
      id: entry.id,
      builderKind: entry.builderKind as BuilderKind,
      feedItemKinds: entry.feedItemKinds as FeedItemKind[],
      urlPatterns: entry.urlPatterns,
      staticLabel: entry.label,
    };
    if (compiledPatterns.length > 0) {
      def.matchesBuilder = (builder: BuilderSourceInput) => {
        const text = sourceUrlText(builder);
        return compiledPatterns.some((re) => re.test(text));
      };
    }
    return def;
  });
}

export const SOURCE_DEFINITIONS: SourceDefinition[] = buildSourceDefinitions();

export function sourceDefinitionForBuilder(builder: BuilderSourceInput) {
  const explicit = sourceDefinitionForType(builder.sourceType);
  if (explicit) return explicit;

  return sourceDefinitionByRules(builder);
}

export function sourceDefinitionForType(sourceType: string | null | undefined) {
  const id = normalizeSourceType(sourceType);
  if (!id) return null;
  return (
    SOURCE_DEFINITIONS.find((source) => source.id === id) ?? {
      id,
      staticLabel: titleCase(id),
      builderKind: BuilderKind.WEBSITE,
      feedItemKinds: [] as FeedItemKind[],
      urlPatterns: [] as string[],
    }
  );
}

export function sourceTypeIdForBuilder(builder: BuilderSourceInput) {
  const explicit = normalizeSourceType(builder.sourceType);
  return explicit || sourceDefinitionByRules(builder)?.id || builder.kind.toLowerCase();
}

export function builderKindForSourceType(sourceType: string | null | undefined) {
  return sourceDefinitionForType(sourceType)?.builderKind ?? BuilderKind.WEBSITE;
}

// Synchronous label helper used in many code paths that can't go async.
// Falls back to the static label baked into sources.json. Use the async
// `getMergedSourceDefinitionForBuilder` when admin-edited labels matter.
export function builderSourceLabel(builder: BuilderSourceInput) {
  return sourceDefinitionForBuilder(builder)?.staticLabel ?? builderKindLabel(builder.kind);
}

export function builderKindLabel(kind: BuilderKind) {
  return (
    SOURCE_DEFINITIONS.find(
      (source) => source.builderKind === kind && !source.matchesBuilder,
    )?.staticLabel ?? titleCase(kind)
  );
}

export function feedItemKindLabel(kind: FeedItemKind) {
  const labels: Record<FeedItemKind, string> = {
    [FeedItemKind.TWEET]: "Tweet",
    [FeedItemKind.BLOG_POST]: "Blog post",
    [FeedItemKind.PODCAST_EPISODE]: "Podcast episode",
  };
  return labels[kind] ?? titleCase(kind);
}

// Async DB-merged getters. Throw when a static sourceId is missing from
// the DB so callers don't silently fall back to stale defaults — the
// seeder should have created the row on first boot.
//
// These merge against the DEFAULT (template) SourceTypeConfig, not a user's
// per-user copy: callers (e.g. the builders page) use only source-type
// metadata like id/label, which is canonical across users. Per-user content
// config (prompts, quality bar) is resolved separately via getUserSourceConfigs.
export async function getMergedSourceDefinitions(): Promise<MergedSourceDefinition[]> {
  const { getAllSourceConfigs } = await import("./source-config-store");
  const configs = await getAllSourceConfigs();
  return SOURCE_DEFINITIONS.map((def) => {
    const config = configs.find((c) => c.sourceId === def.id);
    if (!config) {
      throw new Error(
        `SourceTypeConfig row missing for sourceId="${def.id}"; run prisma db seed.`,
      );
    }
    return mergeDefinition(def, config);
  });
}

export async function getMergedSourceDefinitionForType(
  sourceType: string | null | undefined,
): Promise<MergedSourceDefinition | null> {
  const { getSourceConfig } = await import("./source-config-store");
  const def = sourceDefinitionForType(sourceType);
  if (!def) return null;
  const config = await getSourceConfig(def.id);
  if (!config) {
    if (SOURCE_DEFINITIONS.some((s) => s.id === def.id)) {
      throw new Error(
        `SourceTypeConfig row missing for sourceId="${def.id}"; run prisma db seed.`,
      );
    }
    // Fully-unknown sourceType (titleCase fallback path) — best-effort
    // synthesis instead of throwing so the rest of the UI keeps working.
    return null;
  }
  return mergeDefinition(def, config);
}

export async function getMergedSourceDefinitionForBuilder(
  builder: BuilderSourceInput,
): Promise<MergedSourceDefinition | null> {
  const { getSourceConfigMap } = await import("./source-config-store");
  const def = sourceDefinitionForBuilder(builder);
  if (!def) return null;
  const map = await getSourceConfigMap();
  const config = map.get(def.id);
  if (!config) return null;
  return mergeDefinition(def, config);
}

function mergeDefinition(
  def: SourceDefinition,
  config: SourceTypeConfig,
): MergedSourceDefinition {
  return {
    ...def,
    label: config.label,
    agentDefaultStatus: config.agentDefaultStatus,
    defaultFetchDays: config.defaultFetchDays,
    defaultFetchLimit: config.defaultFetchLimit,
    contentQuality: config.contentQuality,
    summaryPromptBody: config.summaryPromptBody,
    fetchPromptBody: config.fetchPromptBody,
    summaryStyle: config.summaryStyle,
    summaryLanguage: config.summaryLanguage,
    summaryLengthHint: config.summaryLengthHint,
  };
}

function sourceUrlText(builder: BuilderSourceInput) {
  return `${builder.sourceUrl ?? ""} ${builder.fetchUrl ?? ""}`;
}

function sourceDefinitionByRules(builder: BuilderSourceInput) {
  return (
    SOURCE_DEFINITIONS.find(
      (source) =>
        source.builderKind === builder.kind &&
        (source.matchesBuilder ? source.matchesBuilder(builder) : true),
    ) ?? SOURCE_DEFINITIONS.find((source) => source.builderKind === builder.kind)
  );
}

function normalizeSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized && normalized !== "auto" ? normalized : "";
}

function titleCase(value: string) {
  const label = value.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
