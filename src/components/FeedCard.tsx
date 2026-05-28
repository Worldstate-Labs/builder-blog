import { PostCard } from "@/components/PostCard";

export function FeedCard({
  title,
  source,
  body,
  url,
  date,
  fetchTool,
  sourceType,
}: {
  title?: string | null;
  source?: string | null;
  sourceType?: string | null;
  body: string;
  url: string;
  date?: Date | null;
  fetchTool?: string | null;
}) {
  return (
    <PostCard
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
        fetchTool: fetchTool ?? "Legacy fetch/import",
        builder: null,
      }}
    />
  );
}
