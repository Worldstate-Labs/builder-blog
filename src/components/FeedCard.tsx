import { formatDistanceToNow } from "date-fns";

export function FeedCard({
  title,
  source,
  body,
  url,
  date,
}: {
  title?: string | null;
  source?: string | null;
  body: string;
  url: string;
  date?: Date | null;
}) {
  return (
    <article className="feed-card">
      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
        <span>{source ?? "Unknown source"}</span>
        {date ? <span>{formatDistanceToNow(date, { addSuffix: true })}</span> : null}
      </div>
      <h3 className="mt-3 font-serif text-2xl leading-tight">
        {title || body.slice(0, 96)}
      </h3>
      <p className="mt-4 line-clamp-4 text-sm leading-7 text-[var(--muted-strong)]">
        {body}
      </p>
      <a className="mt-5 inline-block text-sm font-semibold underline" href={url}>
        Read source
      </a>
    </article>
  );
}
