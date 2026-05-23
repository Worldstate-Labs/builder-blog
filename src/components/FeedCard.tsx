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
    <article className="feed-card feed-card-compact">
      <details className="item-disclosure">
        <summary className="item-summary">
          <span className="min-w-0">
            <span className="item-kicker">
              <span>{source ?? "Unknown source"}</span>
              {date ? <span>{formatDistanceToNow(date, { addSuffix: true })}</span> : null}
            </span>
            <span className="item-title">{title || body.slice(0, 96)}</span>
          </span>
          <span className="item-summary-action">View</span>
        </summary>
        <div className="item-details">
          <p className="text-sm leading-7 text-[var(--muted-strong)]">{body}</p>
          <a className="mt-4 inline-block text-sm font-semibold underline" href={url}>
            Read source
          </a>
        </div>
      </details>
    </article>
  );
}
