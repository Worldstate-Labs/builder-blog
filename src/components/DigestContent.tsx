"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Star } from "lucide-react";
import { PostCard, type PostCardPost } from "@/components/PostCard";
import { SourceAvatar } from "@/components/SourceAvatar";
import { normalizeSourceType } from "@/lib/source-display";
import {
  parseDigest,
  type DigestDoc,
  type DigestGroup,
  type DigestInline,
  type DigestPost,
  type DigestSection,
} from "@/lib/digest-markdown";

export type DigestSourceLink = {
  aliases?: string[];
  avatarUrl?: string | null;
  entityId: string;
  href: string;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  fetchUrl?: string | null;
};

export type DigestFavoriteStateByUrl = Record<
  string,
  {
    feedItemId: string;
    favoritedAt: string | null;
  }
>;

// Renders the CLI-produced digest markdown as a progressively-readable document:
// source links, source-grouped sections, and the shared PostCard for each post.
// `tone` adapts it to the dark "today" hero vs the paper archive.
export function DigestContent({
  content,
  favoriteStateByUrl = {},
  originalSummariesByUrl = {},
  onFavoriteToggle,
  sourceLinks = [],
  tone = "paper",
}: {
  content: string;
  favoriteStateByUrl?: DigestFavoriteStateByUrl;
  originalSummariesByUrl?: Record<string, string>;
  onFavoriteToggle?: (url: string, feedItemId: string, nextFavorite: boolean) => void;
  showContents?: boolean;
  showSectionCounts?: boolean;
  sourceLinks?: DigestSourceLink[];
  tone?: "paper" | "dark";
}) {
  const doc: DigestDoc = useMemo(() => parseDigest(content ?? ""), [content]);
  const sourceLookup = useMemo(() => buildSourceLookup(sourceLinks), [sourceLinks]);

  if (!doc.hasStructure) {
    // Plain prose (e.g. a "no new updates" note) — render paragraphs cleanly.
    return (
      <div className={wrapClass(tone)}>
        {doc.lead.length > 0 ? (
          doc.lead.map((p, i) => (
            <p key={i} className="digest-prose">
              <Inline nodes={p} />
            </p>
          ))
        ) : (
          <p className="digest-prose">{content}</p>
        )}
      </div>
    );
  }

  const sectionSourceTypes = new Map(
    doc.sections.map((section) => [section.id, sourceTypeForSection(section, sourceLookup)]),
  );

  return (
    <div className={wrapClass(tone)}>
      {doc.lead.map((p, i) => (
        <p key={`lead-${i}`} className="digest-lead-note">
          <Inline nodes={p} />
        </p>
      ))}

      {doc.sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          favoriteStateByUrl={favoriteStateByUrl}
          onFavoriteToggle={onFavoriteToggle}
          originalSummariesByUrl={originalSummariesByUrl}
          sourceType={sectionSourceTypes.get(section.id) ?? "website"}
          sourceLookup={sourceLookup}
        />
      ))}
    </div>
  );
}

function wrapClass(tone: "paper" | "dark"): string {
  return tone === "dark" ? "digest-rich on-dark" : "digest-rich";
}

function SectionBlock({
  section,
  favoriteStateByUrl,
  onFavoriteToggle,
  originalSummariesByUrl,
  sourceType,
  sourceLookup,
}: {
  section: DigestSection;
  favoriteStateByUrl: DigestFavoriteStateByUrl;
  onFavoriteToggle?: (url: string, feedItemId: string, nextFavorite: boolean) => void;
  originalSummariesByUrl: Record<string, string>;
  sourceType: string;
  sourceLookup: Map<string, DigestSourceLink>;
}) {
  const sectionSourceType = sourceType;
  const body = (
    <div className="digest-section-body">
      {section.groups.map((group, gi) => (
        <div key={gi} className="digest-group">
          {group.source ? (
            <DigestGroupHeading source={group.source} sourceLink={sourceLinkForSource(group.source, sourceLookup)} />
          ) : null}
          {group.summary.length > 0 ? (
            <div className="digest-source-summary">
              {group.summary.map((p, i) => (
                <p key={i}>
                  <Inline nodes={p} />
                </p>
              ))}
            </div>
          ) : null}
          {group.posts.map((post) => (
            <PostBlock
              key={post.id}
              group={group}
              post={post}
              section={section}
              sectionSourceType={sectionSourceType}
              sourceLink={group.source ? sourceLinkForSource(group.source, sourceLookup) : undefined}
              favoriteStateByUrl={favoriteStateByUrl}
              onFavoriteToggle={onFavoriteToggle}
              originalSummariesByUrl={originalSummariesByUrl}
            />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <section id={section.id} className="digest-section">
      {body}
    </section>
  );
}

function PostBlock({
  group,
  post,
  section,
  sectionSourceType,
  sourceLink,
  favoriteStateByUrl,
  onFavoriteToggle,
  originalSummariesByUrl,
}: {
  group: DigestGroup;
  post: DigestPost;
  section: DigestSection;
  sectionSourceType: string;
  sourceLink?: DigestSourceLink;
  favoriteStateByUrl: DigestFavoriteStateByUrl;
  onFavoriteToggle?: (url: string, feedItemId: string, nextFavorite: boolean) => void;
  originalSummariesByUrl: Record<string, string>;
}) {
  const summary = [post.lede, ...post.paragraphs]
    .filter((nodes): nodes is DigestInline[] => Boolean(nodes))
    .map(inlineText)
    .join("\n\n")
    .trim();
  const sourceType = normalizeSourceType(sourceLink?.sourceType) || sectionSourceType;
  const url = post.media[0]?.url ?? sourceLink?.sourceUrl ?? sourceLink?.fetchUrl ?? "#";
  const originalSummary = originalSummariesByUrl[url] ?? null;
  const favoriteState = favoriteStateByUrl[url];
  const postCard: PostCardPost = {
    id: `digest-${section.id}-${post.id}`,
    title: post.title,
    body: summary,
    summary,
    originalSummary,
    detailUrl: favoriteState
      ? postDetailHref(favoriteState.feedItemId, "/dashboard?tab=ai-digest", "AI Digest")
      : null,
    url,
    publishedAt: null,
    createdAt: new Date(0).toISOString(),
    sourceName: group.source,
    sourceType,
    fetchTool: null,
    builder: sourceLink
      ? {
          id: sourceLink.entityId,
          entityId: sourceLink.entityId,
          name: sourceLink.name,
          kind: builderKindFromSourceType(sourceType),
          sourceType,
          sourceUrl: sourceLink.sourceUrl ?? null,
          fetchUrl: sourceLink.fetchUrl ?? null,
        }
      : null,
  };

  return (
    <PostCard
      extraActions={
        favoriteState && onFavoriteToggle ? (
          <DigestFavoriteToggleButton
            isFavorite={Boolean(favoriteState.favoritedAt)}
            toggleFavorite={() =>
              onFavoriteToggle(url, favoriteState.feedItemId, !favoriteState.favoritedAt)
            }
          />
        ) : undefined
      }
      post={postCard}
      showBuilderRow={false}
      showDebugActions={false}
      showPublishedDate={false}
      showSourceBadge={false}
    />
  );
}

function postDetailHref(feedItemId: string, returnTo: string, returnLabel: string) {
  const params = new URLSearchParams({ returnLabel, returnTo });
  return `/posts/${feedItemId}?${params.toString()}`;
}

function DigestFavoriteToggleButton({
  isFavorite,
  toggleFavorite,
}: {
  isFavorite: boolean;
  toggleFavorite: () => void;
}) {
  const label = isFavorite ? "Remove from Favorites" : "Add to Favorites";
  return (
    <button
      aria-label={label}
      aria-pressed={isFavorite}
      className={`post-action-btn post-favorite-btn${isFavorite ? " post-action-btn--active" : ""}`}
      onClick={toggleFavorite}
      title={label}
      type="button"
    >
      <Star aria-hidden="true" className="post-action-icon" />
    </button>
  );
}

function DigestGroupHeading({
  source,
  sourceLink,
}: {
  source: string;
  sourceLink?: DigestSourceLink;
}) {
  if (!sourceLink) {
    return <h4 className="digest-group-heading">{source}</h4>;
  }

  return (
    <h4 className="digest-group-heading">
      <Link className="digest-group-source-link" href={sourceLink.href}>
        <SourceAvatar
          className="digest-group-source-avatar"
          imageSize={28}
          source={{
            avatarUrl: sourceLink.avatarUrl ?? null,
            fetchUrl: sourceLink.fetchUrl ?? null,
            name: sourceLink.name || source,
            sourceType: sourceLink.sourceType ?? "website",
            sourceUrl: sourceLink.sourceUrl ?? null,
          }}
        />
        <span>{source}</span>
        <ArrowRight aria-hidden="true" className="digest-group-source-icon" />
      </Link>
    </h4>
  );
}

function buildSourceLookup(sourceLinks: DigestSourceLink[]) {
  const lookup = new Map<string, DigestSourceLink>();
  for (const link of sourceLinks) {
    for (const value of sourceLinkKeys(link)) {
      const key = sourceKey(value);
      if (key && !lookup.has(key)) lookup.set(key, link);
    }
  }
  return lookup;
}

function sourceLinkForSource(source: string, lookup: Map<string, DigestSourceLink>) {
  const direct = lookup.get(sourceKey(source));
  if (direct) return direct;

  const parts = source
    .normalize("NFKC")
    .split(/[()（）]/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const match = lookup.get(sourceKey(part));
    if (match) return match;
  }
  return undefined;
}

function sourceTypeForSection(section: DigestSection, lookup: Map<string, DigestSourceLink>) {
  return sourceTypeFromSourceLinksForSection(section, lookup) || sourceTypeFromSection(section.heading);
}

function sourceTypeFromSourceLinksForSection(section: DigestSection, lookup: Map<string, DigestSourceLink>) {
  const sourceTypes = new Set<string>();
  for (const group of section.groups) {
    if (!group.source) continue;
    const sourceType = normalizeSourceType(sourceLinkForSource(group.source, lookup)?.sourceType);
    if (sourceType) sourceTypes.add(sourceType);
  }

  if (sourceTypes.size === 1) return [...sourceTypes][0];

  const sectionSourceType = normalizeSourceType(sourceLinkForSource(section.heading, lookup)?.sourceType);
  return sectionSourceType || null;
}

function sourceLinkKeys(link: DigestSourceLink) {
  const keys = [
    link.name,
    ...(link.aliases ?? []),
    link.handle ?? "",
    hostOf(link.sourceUrl ?? ""),
    hostOf(link.fetchUrl ?? ""),
  ].filter(Boolean);
  return [...keys, ...keys.map((key) => key.replace(/^@/, ""))];
}

function sourceKey(value: string) {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

function hostOf(value: string) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function inlineText(nodes: DigestInline[]) {
  return nodes.map((node) => node.value).join("").trim();
}

function sourceTypeFromSection(heading: string) {
  const normalized = heading.toLowerCase();
  if (normalized.includes("github trending")) return "github_trending";
  if (normalized.includes("product hunt")) return "product_hunt_top_products";
  if (normalized.includes("twitter") || normalized.includes("x /")) return "x";
  if (normalized.includes("youtube") || normalized.includes("video") || normalized.includes("视频")) return "youtube";
  if (normalized.includes("podcast") || normalized.includes("播客")) return "podcast";
  if (normalized.includes("blog") || normalized.includes("博客")) return "blog";
  return "website";
}

function builderKindFromSourceType(sourceType: string): "X" | "BLOG" | "PODCAST" | "WEBSITE" {
  if (sourceType === "x") return "X";
  if (sourceType === "blog") return "BLOG";
  if (sourceType === "youtube" || sourceType === "podcast") return "PODCAST";
  return "WEBSITE";
}

function Inline({ nodes }: { nodes: DigestInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "strong") return <strong key={i}>{n.value}</strong>;
        if (n.type === "link")
          return (
            <a key={i} className="dr-inline-link" href={n.href} target="_blank" rel="noreferrer">
              {n.value}
            </a>
          );
        return <span key={i}>{n.value}</span>;
      })}
    </>
  );
}
