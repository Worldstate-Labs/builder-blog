import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Eye } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";

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
    <article className="feed-card feed-card-compact">
      <details className="item-disclosure">
        <summary className="item-summary">
          <span className="min-w-0">
            <span className="item-kicker">
              <SourceBadge sourceType={sourceType} />
              <span>{source ?? "Unknown source"}</span>
              {date ? <span>{formatDistanceToNow(date, { addSuffix: true })}</span> : null}
              <span>{crawlingTool ?? "Legacy crawl/import"}</span>
            </span>
            <span className="item-title">{title || body.slice(0, 96)}</span>
          </span>
          <span className="item-summary-action">
            <Eye className="h-3.5 w-3.5" />
            View
          </span>
        </summary>
        <div className="item-details">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
            Crawling tool · {crawlingTool ?? "Legacy crawl/import"}
          </p>
          <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--muted-strong)]">
            {body}
          </div>
          <a
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="h-4 w-4" />
            Read source
          </a>
        </div>
      </details>
    </article>
  );
}
