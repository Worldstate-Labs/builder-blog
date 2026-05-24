"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { BuilderLibraryActions } from "@/components/BuilderLibraryActions";
import { SourceBadge } from "@/components/SourceBadge";

export type BuilderLibraryListItem = {
  id: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  feedItemCount: number;
  latestPostCreatedAt: string | null;
  subscribed: boolean;
  crawlLabel: string;
  allowRemove: boolean;
};

type BuilderLibraryListProps = {
  builders: BuilderLibraryListItem[];
  emptyBody: string;
  emptyTitle?: string;
};

export function BuilderLibraryList({
  builders,
  emptyBody,
  emptyTitle,
}: BuilderLibraryListProps) {
  const [removedBuilderIds, setRemovedBuilderIds] = useState<Set<string>>(() => new Set());
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  const visibleBuilders = useMemo(
    () => builders.filter((builder) => !removedBuilderIds.has(builder.id)),
    [builders, removedBuilderIds],
  );

  function onRemoveStateChange(builderId: string, removed: boolean) {
    setRemovedBuilderIds((current) => {
      const next = new Set(current);
      if (removed) {
        next.add(builderId);
      } else {
        next.delete(builderId);
      }
      return next;
    });
    setRemoveErrors((current) => {
      const next = { ...current };
      if (removed) {
        delete next[builderId];
      } else {
        next[builderId] = "Could not remove builder.";
      }
      return next;
    });
  }

  if (visibleBuilders.length === 0) {
    return (
      <div className="empty-panel text-[var(--muted-strong)]">
        {emptyTitle ? (
          <h3 className="text-lg font-semibold text-[var(--ink)]">{emptyTitle}</h3>
        ) : null}
        <p className={emptyTitle ? "mt-2 text-sm leading-6" : ""}>{emptyBody}</p>
      </div>
    );
  }

  return (
    <>
      {visibleBuilders.map((builder) => (
        <BuilderCard
          builder={builder}
          key={builder.id}
          removeError={removeErrors[builder.id]}
          onRemoveStateChange={onRemoveStateChange}
        />
      ))}
    </>
  );
}

function BuilderCard({
  builder,
  onRemoveStateChange,
  removeError,
}: {
  builder: BuilderLibraryListItem;
  onRemoveStateChange: (builderId: string, removed: boolean) => void;
  removeError?: string;
}) {
  return (
    <article id={builder.id} className="builder-card">
      <div className="builder-row">
        <BuilderInfo builder={builder} />
        <div className="row-actions">
          <BuilderLibraryActions
            allowRemove={builder.allowRemove}
            builderId={builder.id}
            initialSubscribed={builder.subscribed}
            onRemoveStateChange={onRemoveStateChange}
          />
        </div>
      </div>
      {removeError ? (
        <div className="mt-3 text-sm text-[var(--danger)]" role="status">
          {removeError}
        </div>
      ) : null}
      <BuilderFeedItems
        builder={builder}
        builderId={builder.id}
        totalCount={builder.feedItemCount}
      />
    </article>
  );
}

function BuilderInfo({ builder }: { builder: BuilderLibraryListItem }) {
  const sourceUrl = builder.sourceUrl ?? builder.crawlUrl;
  const latestPostCreatedAt = builder.latestPostCreatedAt
    ? new Date(builder.latestPostCreatedAt)
    : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold leading-snug">{builder.name}</h3>
        <SourceBadge builder={builder} />
        <span className="sub-pill">{builder.subscribed ? "Subscribed" : "In library"}</span>
      </div>
      <div className="builder-meta">
        <span>{builder.handle ? `@${builder.handle}` : sourceSummary(sourceUrl)}</span>
        <span>{builder.crawlLabel}</span>
        <span>{builder.feedItemCount} items</span>
        {latestPostCreatedAt ? (
          <span>Latest {formatCompactDate(latestPostCreatedAt)}</span>
        ) : null}
      </div>
      {sourceUrl ? (
        <a className="builder-source-link" href={sourceUrl} rel="noreferrer" target="_blank">
          <ExternalLink className="h-3.5 w-3.5" />
          Open source
        </a>
      ) : null}
    </div>
  );
}

function sourceSummary(value: string | null) {
  if (!value) return "No source";
  try {
    const url = new URL(value);
    const [firstPathPart] = url.pathname.split("/").filter(Boolean);
    if (/youtube\.com$/i.test(url.hostname) && firstPathPart?.startsWith("@")) {
      return firstPathPart;
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatCompactDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
