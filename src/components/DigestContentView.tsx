"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import {
  PostCardView,
  type PostCardLinkComponent,
  type PostCardLinkProps,
  type PostCardPost,
} from "@/components/PostCardView";
import { PostFavoriteButton, postFavoriteActionLabel } from "@/components/PostFavoriteButton";
import { SourceAvatar } from "@/components/SourceAvatar";
import type { DigestSourceLink } from "@/lib/digest-source-links";
import { postDetailHref } from "@/lib/navigation";
import { normalizeSourceType } from "@/lib/source-display";
import {
  cleanStructuredDigestItems,
  type StructuredDigestItem,
} from "@/lib/structured-digest";

export type DigestFavoriteStateByFeedItemId = Record<
  string,
  {
    feedItemId: string;
    favoritedAt: string | null;
  }
>;

const EMPTY_PENDING_FAVORITE_IDS = new Set<string>();

function DefaultLink({ href, children, ...rest }: PostCardLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export type DigestContentViewProps = {
  favoriteErrorByFeedItemId?: Record<string, string>;
  favoriteStateByFeedItemId?: DigestFavoriteStateByFeedItemId;
  items: StructuredDigestItem[];
  onFavoriteToggle?: (feedItemId: string, nextFavorite: boolean) => void;
  pendingFavoriteFeedItemIds?: Set<string>;
  sourceLinks?: DigestSourceLink[];
  tone?: "paper" | "dark";
  linkComponent?: PostCardLinkComponent;
};

export function DigestContentView({
  favoriteErrorByFeedItemId = {},
  favoriteStateByFeedItemId = {},
  items,
  onFavoriteToggle,
  pendingFavoriteFeedItemIds = EMPTY_PENDING_FAVORITE_IDS,
  sourceLinks = [],
  tone = "paper",
  linkComponent = DefaultLink,
}: DigestContentViewProps) {
  const digestItems = useMemo(() => cleanStructuredDigestItems(items), [items]);
  const sections = useMemo(() => groupStructuredDigestItems(digestItems), [digestItems]);
  const sourceLinkByEntityId = useMemo(() => {
    const links = new Map<string, DigestSourceLink>();
    for (const link of sourceLinks) {
      if (link.entityId) links.set(link.entityId, link);
    }
    return links;
  }, [sourceLinks]);

  if (digestItems.length === 0) {
    return (
      <div className={wrapClass(tone)}>
        <p className="digest-prose">No AI Digest items yet.</p>
      </div>
    );
  }

  return (
    <div className={wrapClass(tone)}>
      {sections.map((section) => (
        <section className="digest-section" id={section.key} key={section.key}>
          <div className="digest-section-body">
            {section.groups.map((group) => {
              const sourceLink = sourceLinkByEntityId.get(group.source.entityId);
              return (
                <div className="digest-group" key={group.source.entityId}>
                  <DigestGroupHeading
                    linkComponent={linkComponent}
                    source={group.source}
                    sourceLink={sourceLink}
                  />
                  {group.sourceSummary ? (
                    <div className="digest-source-summary">
                      <p>{group.sourceSummary}</p>
                    </div>
                  ) : null}
                  {group.items.map((item) => (
                    <PostBlock
                      favoriteError={favoriteErrorByFeedItemId[item.post.feedItemId] ?? ""}
                      favoriteState={favoriteStateByFeedItemId[item.post.feedItemId] ?? {
                        feedItemId: item.post.feedItemId,
                        favoritedAt: null,
                      }}
                      item={item}
                      key={item.post.feedItemId}
                      linkComponent={linkComponent}
                      onFavoriteToggle={onFavoriteToggle}
                      pendingFavoriteFeedItemIds={pendingFavoriteFeedItemIds}
                      sourceLink={sourceLink}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function wrapClass(tone: "paper" | "dark"): string {
  return tone === "dark" ? "digest-rich on-dark" : "digest-rich";
}

function PostBlock({
  favoriteError,
  favoriteState,
  item,
  linkComponent,
  onFavoriteToggle,
  pendingFavoriteFeedItemIds,
  sourceLink,
}: {
  favoriteError: string;
  favoriteState: { feedItemId: string; favoritedAt: string | null };
  item: StructuredDigestItem;
  linkComponent: PostCardLinkComponent;
  onFavoriteToggle?: (feedItemId: string, nextFavorite: boolean) => void;
  pendingFavoriteFeedItemIds: Set<string>;
  sourceLink?: DigestSourceLink;
}) {
  const sourceType = normalizeSourceType(item.source.sourceType || item.post.sourceType) || "website";
  const sourceName = sourceLink?.name || item.source.name;
  const postCard: PostCardPost = {
    id: `digest-${item.post.feedItemId}`,
    title: item.post.title || sourceName || "Untitled update",
    body: item.summary,
    summary: item.summary,
    detailUrl: postDetailHref(item.post.feedItemId, "/dashboard?tab=ai-digest", "AI Digest"),
    url: item.post.url,
    publishedAt: item.post.publishedAt,
    createdAt: item.post.createdAt,
    sourceName,
    sourceType,
    fetchTool: null,
    builder: {
      id: item.source.entityId,
      entityId: item.source.entityId,
      name: sourceName,
      kind: builderKindFromSourceType(sourceType),
      sourceType,
      sourceUrl: item.source.sourceUrl,
      fetchUrl: item.source.fetchUrl,
      avatarUrl: item.source.avatarUrl ?? null,
      avatarDataUrl: item.source.avatarDataUrl ?? null,
    },
  };

  return (
    <PostCardView
      extraActions={
        onFavoriteToggle ? (
          <span className="post-favorite-control">
            <PostFavoriteButton
              ariaLabel={postFavoriteActionLabel(
                Boolean(favoriteState.favoritedAt),
                digestFavoriteTargetLabel(postCard),
              )}
              disabled={pendingFavoriteFeedItemIds.has(item.post.feedItemId)}
              isFavorite={Boolean(favoriteState.favoritedAt)}
              onToggle={() =>
                onFavoriteToggle(item.post.feedItemId, !favoriteState.favoritedAt)
              }
            />
            {favoriteError ? (
              <span className="post-favorite-status" role="status">
                {favoriteError}
              </span>
            ) : null}
          </span>
        ) : undefined
      }
      linkComponent={linkComponent}
      post={postCard}
      showBuilderRow={false}
      showDebugActions={false}
      showPublishedDate={false}
      showSourceBadge={false}
    />
  );
}

function digestFavoriteTargetLabel(post: PostCardPost) {
  return post.title?.trim() || post.sourceName?.trim() || "this post";
}

function DigestGroupHeading({
  source,
  sourceLink,
  linkComponent: LinkComponent,
}: {
  source: StructuredDigestItem["source"];
  sourceLink?: DigestSourceLink;
  linkComponent: PostCardLinkComponent;
}) {
  const label = sourceLink?.name || source.name || "Unknown source";
  const avatar = (
    <SourceAvatar
      className="digest-group-source-avatar"
      imageSize={24}
      source={{
        avatarDataUrl: source.avatarDataUrl ?? sourceLink?.avatarDataUrl ?? null,
        avatarUrl: source.avatarUrl ?? sourceLink?.avatarUrl ?? null,
        fetchUrl: source.fetchUrl ?? sourceLink?.fetchUrl ?? null,
        name: label,
        sourceType: source.sourceType ?? sourceLink?.sourceType ?? "website",
        sourceUrl: source.sourceUrl ?? sourceLink?.sourceUrl ?? null,
      }}
    />
  );

  if (!sourceLink) {
    return (
      <h4 className="digest-group-heading">
        <span className="digest-group-source-link">
          {avatar}
          <span>{label}</span>
        </span>
      </h4>
    );
  }

  return (
    <h4 className="digest-group-heading">
      <LinkComponent className="digest-group-source-link" href={sourceLink.href}>
        {avatar}
        <span>{label}</span>
        <ArrowRight aria-hidden="true" className="digest-group-source-icon" />
      </LinkComponent>
    </h4>
  );
}

function groupStructuredDigestItems(items: StructuredDigestItem[]) {
  const sections = new Map<
    string,
    {
      key: string;
      label: string;
      groups: Map<
        string,
        {
          source: StructuredDigestItem["source"];
          sourceSummary: string | null;
          items: StructuredDigestItem[];
        }
      >;
    }
  >();

  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const sectionKey = item.section.key || item.section.sourceType || "website";
    const section = sections.get(sectionKey) ?? {
      key: sectionKey,
      label: item.section.label,
      groups: new Map(),
    };
    const groupKey = item.source.entityId || item.source.name;
    const group = section.groups.get(groupKey) ?? {
      source: item.source,
      sourceSummary: item.sourceSummary,
      items: [],
    };
    group.items.push(item);
    section.groups.set(groupKey, group);
    sections.set(sectionKey, section);
  }

  return [...sections.values()].map((section) => ({
    key: section.key,
    label: section.label,
    groups: [...section.groups.values()],
  }));
}

function builderKindFromSourceType(sourceType: string): "X" | "BLOG" | "PODCAST" | "WEBSITE" {
  if (sourceType === "x") return "X";
  if (sourceType === "blog") return "BLOG";
  if (sourceType === "youtube" || sourceType === "podcast") return "PODCAST";
  return "WEBSITE";
}
