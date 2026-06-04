"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { CountBadge } from "@/components/Count";
import { PostCard, type PostCardPost } from "@/components/PostCard";
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
  entityId: string;
  href: string;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
};

// Renders the CLI-produced digest markdown as a progressively-readable document:
// source links, a jump-to-section index, collapsible sections, and the shared
// PostCard for each post. `tone` adapts it to the dark "today" hero vs the
// paper archive.
export function DigestContent({
  content,
  showContents = true,
  showSectionCounts = true,
  sourceLinks = [],
  tone = "paper",
}: {
  content: string;
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

  const shouldShowContents = showContents && doc.sections.length >= 2;

  return (
    <div className={wrapClass(tone)}>
      {doc.lead.map((p, i) => (
        <p key={`lead-${i}`} className="digest-lead-note">
          <Inline nodes={p} />
        </p>
      ))}

      {shouldShowContents ? (
        <nav className="digest-contents" aria-label="Digest sections">
          {doc.sections.map((s) => (
            <a key={s.id} className="digest-contents-chip" href={`#${s.id}`}>
              <span className="truncate">{s.heading || "Updates"}</span>
              <CountBadge value={s.postCount} />
            </a>
          ))}
        </nav>
      ) : null}

      {doc.sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          collapsible={false}
          showCount={showSectionCounts}
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
  collapsible,
  showCount,
  sourceLookup,
}: {
  section: DigestSection;
  collapsible: boolean;
  showCount: boolean;
  sourceLookup: Map<string, DigestSourceLink>;
}) {
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
              sourceLink={group.source ? sourceLinkForSource(group.source, sourceLookup) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );

  if (!collapsible || !section.heading) {
    return (
      <section id={section.id} className="digest-section scroll-mt-24">
        {section.heading ? (
          <div className="digest-section-summary digest-section-summary-static">
            <h3 className="digest-section-heading">{section.heading}</h3>
            {showCount ? <CountBadge value={section.postCount} /> : null}
          </div>
        ) : null}
        {body}
      </section>
    );
  }

  return (
    <details id={section.id} className="digest-section scroll-mt-24" open>
      <summary className="digest-section-summary">
        <ChevronDown aria-hidden="true" className="digest-section-chevron" />
        <h3 className="digest-section-heading">{section.heading}</h3>
        {showCount ? <CountBadge value={section.postCount} /> : null}
      </summary>
      {body}
    </details>
  );
}

function PostBlock({
  group,
  post,
  section,
  sourceLink,
}: {
  group: DigestGroup;
  post: DigestPost;
  section: DigestSection;
  sourceLink?: DigestSourceLink;
}) {
  const summary = [post.lede, ...post.paragraphs]
    .filter((nodes): nodes is DigestInline[] => Boolean(nodes))
    .map(inlineText)
    .join("\n\n")
    .trim();
  const sourceType = sourceTypeFromSection(section.heading);
  const url = post.media[0]?.url ?? sourceLink?.sourceUrl ?? sourceLink?.fetchUrl ?? "#";
  const postCard: PostCardPost = {
    id: `digest-${section.id}-${post.id}`,
    title: post.title,
    body: summary,
    summary,
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

  return <PostCard post={postCard} showDebugActions={false} showPublishedDate={false} />;
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
