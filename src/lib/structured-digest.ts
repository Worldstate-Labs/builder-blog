import type { FeedItemKind } from "@prisma/client";

export type StructuredDigestItem = {
  order: number;
  section: {
    key: string;
    label: string;
    sourceType: string;
  };
  source: {
    entityId: string;
    name: string;
    sourceType: string;
    sourceUrl: string | null;
    fetchUrl: string | null;
    avatarUrl?: string | null;
    avatarDataUrl?: string | null;
  };
  sourceSummary: string | null;
  post: {
    feedItemId: string;
    entityId: string;
    kind: FeedItemKind;
    externalId: string;
    title: string | null;
    url: string;
    sourceName: string | null;
    sourceType: string | null;
    publishedAt: string | null;
    createdAt: string;
  };
  summary: string;
};

export type StructuredDigestMark = {
  entityId: string;
  kind: FeedItemKind;
  externalId: string;
  feedItemId: string;
};

export function cleanStructuredDigestItems(value: unknown): StructuredDigestItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const section = objectRecord(record.section);
    const source = objectRecord(record.source);
    const post = objectRecord(record.post);
    const feedItemId = stringValue(post.feedItemId);
    const entityId = stringValue(post.entityId || source.entityId);
    const externalId = stringValue(post.externalId);
    const summary = stringValue(record.summary);
    if (!feedItemId || !entityId || !externalId || !summary) return [];

    return [
      {
        order: numberValue(record.order, index),
        section: {
          key: stringValue(section.key) || stringValue(section.sourceType) || "website",
          label: stringValue(section.label) || stringValue(section.sourceType) || "Website",
          sourceType: stringValue(section.sourceType) || stringValue(source.sourceType) || "website",
        },
        source: {
          entityId,
          name: stringValue(source.name) || stringValue(post.sourceName) || "Unknown source",
          sourceType: stringValue(source.sourceType) || stringValue(post.sourceType) || "website",
          sourceUrl: nullableString(source.sourceUrl),
          fetchUrl: nullableString(source.fetchUrl),
          avatarUrl: nullableString(source.avatarUrl),
          avatarDataUrl: nullableString(source.avatarDataUrl),
        },
        sourceSummary: nullableString(record.sourceSummary),
        post: {
          feedItemId,
          entityId,
          kind: stringValue(post.kind) as FeedItemKind,
          externalId,
          title: nullableString(post.title),
          url: stringValue(post.url),
          sourceName: nullableString(post.sourceName),
          sourceType: nullableString(post.sourceType),
          publishedAt: nullableString(post.publishedAt),
          createdAt: stringValue(post.createdAt) || new Date(0).toISOString(),
        },
        summary,
      },
    ];
  });
}

export function digestedMarksFromDigestItems(items: StructuredDigestItem[]): StructuredDigestMark[] {
  return items.map((item) => ({
    entityId: item.post.entityId,
    kind: item.post.kind,
    externalId: item.post.externalId,
    feedItemId: item.post.feedItemId,
  }));
}

export function digestItemsSearchText(items: StructuredDigestItem[]) {
  return items
    .map((item) =>
      [
        item.section.label,
        item.source.name,
        item.sourceSummary ?? "",
        item.post.title ?? "",
        item.post.sourceName ?? "",
        item.post.url,
        item.summary,
      ].join(" "),
    )
    .join(" ");
}

export function sourceOrderFromDigestItems(items: StructuredDigestItem[]) {
  const order = new Map<string, number>();
  [...items]
    .sort((a, b) => a.order - b.order)
    .forEach((item, index) => {
      for (const key of [
        item.source.entityId,
        item.source.name,
        item.source.sourceUrl ?? "",
        item.source.fetchUrl ?? "",
      ]) {
        const normalized = key.trim();
        if (normalized && !order.has(normalized)) order.set(normalized, index);
      }
    });
  return order;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
