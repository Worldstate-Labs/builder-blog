import { CrawledPostCard } from "@/components/CrawledPostCard";

export function FeedCard({
  title,
  source,
  body,
  url,
  date,
  crawlingTool,
  sourceType,
}: {
  title?: string | null;
  source?: string | null;
  sourceType?: string | null;
  body: string;
  url: string;
  date?: Date | null;
  crawlingTool?: string | null;
}) {
  return (
    <CrawledPostCard
      extraMeta={source ? <span>{source}</span> : null}
      post={{
        id: url,
        title: title ?? null,
        body,
        summary: null,
        url,
        publishedAt: date?.toISOString() ?? null,
        createdAt: date?.toISOString() ?? new Date().toISOString(),
        sourceName: source ?? null,
        sourceType,
        crawlingTool: crawlingTool ?? "Legacy crawl/import",
        builder: null,
      }}
    />
  );
}
