import { BuilderKind, FeedItemKind } from "@prisma/client";

type BuilderSourceInput = {
  kind: BuilderKind;
  sourceType?: string | null;
  sourceUrl?: string | null;
  crawlUrl?: string | null;
};

export type SourceDefinition = {
  id: string;
  label: string;
  builderKind: BuilderKind;
  feedItemKinds: FeedItemKind[];
  centralCrawler: boolean;
  personalCrawler: boolean;
  matchesBuilder?: (builder: BuilderSourceInput) => boolean;
};

export const SOURCE_DEFINITIONS = [
  {
    id: "x",
    label: "X / Twitter",
    builderKind: BuilderKind.X,
    feedItemKinds: [FeedItemKind.TWEET],
    centralCrawler: true,
    personalCrawler: true,
  },
  {
    id: "blog",
    label: "Blog",
    builderKind: BuilderKind.BLOG,
    feedItemKinds: [FeedItemKind.BLOG_POST],
    centralCrawler: true,
    personalCrawler: true,
  },
  {
    id: "youtube",
    label: "YouTube",
    builderKind: BuilderKind.PODCAST,
    feedItemKinds: [FeedItemKind.PODCAST_EPISODE],
    centralCrawler: false,
    personalCrawler: true,
    matchesBuilder: (builder) =>
      isYouTubeUrl(builder.crawlUrl) ||
      (!builder.crawlUrl && isYouTubeUrl(builder.sourceUrl)),
  },
  {
    id: "podcast",
    label: "Podcast RSS",
    builderKind: BuilderKind.PODCAST,
    feedItemKinds: [FeedItemKind.PODCAST_EPISODE],
    centralCrawler: true,
    personalCrawler: true,
  },
  {
    id: "pdf",
    label: "PDF",
    builderKind: BuilderKind.WEBSITE,
    feedItemKinds: [],
    centralCrawler: false,
    personalCrawler: true,
    matchesBuilder: (builder) => /\.pdf(?:\s|$|[?#])/i.test(sourceUrlText(builder)),
  },
  {
    id: "website",
    label: "Website",
    builderKind: BuilderKind.WEBSITE,
    feedItemKinds: [],
    centralCrawler: false,
    personalCrawler: true,
  },
] satisfies SourceDefinition[];

export function sourceDefinitionForBuilder(builder: BuilderSourceInput) {
  const explicit = sourceDefinitionForType(builder.sourceType);
  if (explicit) return explicit;

  return sourceDefinitionByRules(builder);
}

export function personalCrawlerSourceForBuilder(builder: BuilderSourceInput) {
  const explicit = sourceDefinitionForType(builder.sourceType);
  if (explicit?.personalCrawler && explicit.builderKind === builder.kind) return explicit;

  return SOURCE_DEFINITIONS.find(
    (source) =>
      source.personalCrawler &&
      source.builderKind === builder.kind &&
      (source.matchesBuilder ? source.matchesBuilder(builder) : true),
  ) ?? null;
}

export function sourceDefinitionForType(sourceType: string | null | undefined) {
  const id = normalizeSourceType(sourceType);
  if (!id) return null;
  return (
    SOURCE_DEFINITIONS.find((source) => source.id === id) ?? {
      id,
      label: titleCase(id),
      builderKind: BuilderKind.WEBSITE,
      feedItemKinds: [],
      centralCrawler: false,
      personalCrawler: false,
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

export function centralCrawlerBuilderKinds() {
  return Array.from(
    new Set(
      SOURCE_DEFINITIONS.filter((source) => source.centralCrawler).map(
        (source) => source.builderKind,
      ),
    ),
  );
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

function sourceUrlText(builder: BuilderSourceInput) {
  return `${builder.sourceUrl ?? ""} ${builder.crawlUrl ?? ""}`;
}

function isYouTubeUrl(value: string | null | undefined) {
  return /youtube\.com|youtu\.be/i.test(value ?? "");
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
