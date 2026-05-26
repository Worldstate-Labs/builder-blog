import { BuilderKind, FeedItemKind } from "@prisma/client";
import sourcesConfig from "../../config/sources.json";

type BuilderSourceInput = {
  kind: BuilderKind;
  sourceType?: string | null;
  sourceUrl?: string | null;
  crawlUrl?: string | null;
};

type SourceConfigEntry = (typeof sourcesConfig.sources)[number];

export type SourceDefinition = {
  id: string;
  label: string;
  builderKind: BuilderKind;
  feedItemKinds: FeedItemKind[];
  matchesBuilder?: (builder: BuilderSourceInput) => boolean;
};

function buildSourceDefinitions(): SourceDefinition[] {
  return sourcesConfig.sources.map((entry) => {
    const compiledPatterns = entry.urlPatterns.map((p) => new RegExp(p, "i"));
    const def: SourceDefinition = {
      id: entry.id,
      label: entry.label,
      builderKind: entry.builderKind as BuilderKind,
      feedItemKinds: entry.feedItemKinds as FeedItemKind[],
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
      label: titleCase(id),
      builderKind: BuilderKind.WEBSITE,
      feedItemKinds: [] as FeedItemKind[],
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

export function builderSourceLabel(builder: BuilderSourceInput) {
  return sourceDefinitionForBuilder(builder)?.label ?? builderKindLabel(builder.kind);
}

export function builderKindLabel(kind: BuilderKind) {
  return (
    SOURCE_DEFINITIONS.find(
      (source) => source.builderKind === kind && !source.matchesBuilder,
    )?.label ?? titleCase(kind)
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

export function sourceConfigFor(entry: SourceConfigEntry) {
  return entry;
}

function sourceUrlText(builder: BuilderSourceInput) {
  return `${builder.sourceUrl ?? ""} ${builder.crawlUrl ?? ""}`;
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
