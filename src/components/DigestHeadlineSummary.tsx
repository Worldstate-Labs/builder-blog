"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { SourceAvatar } from "@/components/SourceAvatar";
import type { DigestSourceLink } from "@/lib/digest-source-links";
import { parseDigest } from "@/lib/digest-markdown";

const MAX_HEADLINE_SOURCE_ITEMS = 5;
const DEFAULT_HEADLINE_SOURCE_TYPE_ORDER = [
  "podcast",
  "youtube",
  "blog",
  "x",
  "github_trending",
  "product_hunt_top_products",
  "website",
];

export function DigestHeadlineSummary({
  collapsedLineCount,
  content,
  headerAction,
  loading = false,
  sourceLinks = [],
  text,
}: {
  collapsedLineCount?: number;
  content?: string | null;
  headerAction?: ReactNode;
  loading?: boolean;
  sourceLinks?: DigestSourceLink[];
  text?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lineClampOverflow, setLineClampOverflow] = useState(false);
  const listWrapRef = useRef<HTMLDivElement>(null);
  const headlineItems = useMemo(
    () => parseHeadlineSourceSummaries(text, sourceLinks, content),
    [content, sourceLinks, text],
  );
  const lineClampEnabled = Boolean(collapsedLineCount && collapsedLineCount > 0);
  const itemLimitExceeded = !lineClampEnabled && headlineItems.length > MAX_HEADLINE_SOURCE_ITEMS;
  const canExpand = lineClampEnabled ? lineClampOverflow : itemLimitExceeded;
  const visibleHeadlineItems = expanded || lineClampEnabled
    ? headlineItems
    : headlineItems.slice(0, MAX_HEADLINE_SOURCE_ITEMS);
  const listWrapStyle = lineClampEnabled
    ? ({
        "--digest-headline-collapsed-lines": collapsedLineCount,
      } as CSSProperties)
    : undefined;
  const listWrapClassName = [
    "digest-headline-list-wrap",
    lineClampEnabled ? "is-line-clamped" : "",
    canExpand ? "is-expandable" : "",
    expanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!lineClampEnabled || loading || headlineItems.length === 0) {
      return;
    }

    const element = listWrapRef.current;
    if (!element) return;

    let frameId = 0;
    const scheduleOverflowUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize) || 16;
        const collapsedHeight =
          (collapsedLineCount ?? 6) * 1.48 * fontSize + 1.95 * fontSize;
        setLineClampOverflow(element.scrollHeight > collapsedHeight + 1);
      });
    };

    scheduleOverflowUpdate();
    const resizeObserver = new ResizeObserver(scheduleOverflowUpdate);
    resizeObserver.observe(element);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [collapsedLineCount, expanded, headlineItems.length, lineClampEnabled, loading]);

  return (
    <section
      className={`digest-headline-summary${loading ? " is-loading" : ""}`}
      aria-busy={loading || undefined}
      aria-label="AI Digest headlines"
    >
      <div className="digest-headline-top">
        <div className="digest-headline-label-row">
          <div className="digest-headline-kicker">Latest headlines</div>
        </div>
        {headerAction ? <div className="digest-headline-action">{headerAction}</div> : null}
      </div>
      {loading ? (
        <div className="digest-headline-loading" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : headlineItems.length > 0 ? (
        <div
          className={listWrapClassName}
          ref={listWrapRef}
          style={listWrapStyle}
        >
          <ul className="digest-headline-list">
            {visibleHeadlineItems.map((item) => (
              <li className="digest-headline-item" key={item.key}>
                <DigestHeadlineAvatar item={item} />
                <div className="digest-headline-item-body">
                  <p className="digest-headline-source-name" title={item.sourceName}>
                    {item.sourceName}
                  </p>
                  <p className="digest-headline-item-text">{item.summary}</p>
                </div>
              </li>
            ))}
          </ul>
          {canExpand ? (
            <button
              aria-expanded={expanded}
              aria-label={expanded ? "Show fewer headline sources" : "Show all headline sources"}
              className="digest-headline-toggle"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              <ChevronDown aria-hidden="true" className="digest-headline-toggle-icon" />
            </button>
          ) : null}
        </div>
      ) : (
        <p className="digest-headline-text">{text}</p>
      )}
    </section>
  );
}

type DigestHeadlineSourceItem = {
  key: string;
  sourceLink?: DigestSourceLink;
  sourceLinks: DigestSourceLink[];
  sourceName: string;
  summary: string;
};

function DigestHeadlineAvatar({ item }: { item: DigestHeadlineSourceItem }) {
  if (item.sourceLinks.length > 1) {
    const label = combinedHeadlineAvatarLabel(item.sourceLinks);
    return (
      <span
        aria-hidden="true"
        className="fb-src-icon digest-headline-avatar digest-headline-avatar-combo"
        title={item.sourceName}
      >
        {label}
      </span>
    );
  }

  return (
    <SourceAvatar
      className="digest-headline-avatar"
      imageSize={28}
      source={{
        avatarDataUrl: item.sourceLink?.avatarDataUrl ?? null,
        avatarUrl: item.sourceLink?.avatarUrl ?? null,
        fetchUrl: item.sourceLink?.fetchUrl ?? null,
        name: item.sourceName,
        sourceType: item.sourceLink?.sourceType ?? "website",
        sourceUrl: item.sourceLink?.sourceUrl ?? null,
      }}
    />
  );
}

function combinedHeadlineAvatarLabel(sourceLinks: DigestSourceLink[]) {
  const initials = sourceLinks
    .map((link) => link.name.replace(/^@+/, "").trim().charAt(0).toUpperCase())
    .filter(Boolean);
  if (initials.length <= 2) return initials.join("+") || "?";
  return `${initials.slice(0, 2).join("+")}+${initials.length - 2}`;
}

function parseHeadlineSourceSummaries(
  text: string | undefined,
  sourceLinks: DigestSourceLink[],
  content?: string | null,
): DigestHeadlineSourceItem[] {
  const trimmed = text?.trim();
  if (!trimmed) return [];

  const lookup = buildHeadlineSourceLookup(sourceLinks);
  const items: DigestHeadlineSourceItem[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const listMarkerMatch = rawLine.match(/^\s*(?:[-*•]|\d+[.)])\s*/);
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;

    const separatorIndex = headlineSeparatorIndex(line);
    if (separatorIndex <= 0) continue;

    const rawSourceName = line.slice(0, separatorIndex).trim().replace(/^["“]|["”]$/g, "");
    const summary = line.slice(separatorIndex + 1).trim();
    if (!rawSourceName || !summary) continue;

    const sourceLinks = headlineSourceLinksForLabel(rawSourceName, lookup);
    const sourceLink = sourceLinks[0];
    if (!listMarkerMatch && !sourceLink) continue;
    items.push({
      key: `${headlineSourceKey(rawSourceName)}:${items.length}`,
      sourceLink,
      sourceLinks,
      sourceName: sourceLinks.length > 1
        ? sourceLinks.map((link) => link.name).join(" and ")
        : sourceLink?.name ?? rawSourceName,
      summary,
    });
  }
  return sortHeadlineSourceItems(items, sourceLinks, content);
}

function headlineSeparatorIndex(line: string) {
  const zhIndex = line.indexOf("：");
  const asciiIndex = line.indexOf(":");
  if (zhIndex === -1) return asciiIndex;
  if (asciiIndex === -1) return zhIndex;
  return Math.min(zhIndex, asciiIndex);
}

function sortHeadlineSourceItems(
  items: DigestHeadlineSourceItem[],
  sourceLinks: DigestSourceLink[],
  content?: string | null,
) {
  const sourceOrder =
    headlineSourceOrderFromDigestContent(content, sourceLinks) ??
    headlineSourceOrderFromSourceLinks(sourceLinks);
  if (sourceOrder.size === 0) return items;

  return [...items].sort((a, b) => {
    const ai = headlineOrderForItem(a, sourceOrder) ?? Number.POSITIVE_INFINITY;
    const bi = headlineOrderForItem(b, sourceOrder) ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return 0;
  });
}

function headlineOrderForItem(
  item: DigestHeadlineSourceItem,
  sourceOrder: Map<string, number>,
) {
  for (const key of headlineSourceItemKeys(item)) {
    const rank = sourceOrder.get(key);
    if (rank !== undefined) return rank;
  }
  return undefined;
}

function headlineSourceItemKeys(item: DigestHeadlineSourceItem) {
  const keys = [
    item.sourceName,
    ...item.sourceLinks.flatMap(headlineSourceLinkKeys),
  ].filter(Boolean);
  return [...keys, ...keys.map((key) => key.replace(/^@/, ""))]
    .map(headlineSourceKey)
    .filter(Boolean);
}

function headlineSourceOrderFromDigestContent(
  content: string | null | undefined,
  sourceLinks: DigestSourceLink[],
) {
  if (!content?.trim()) return null;
  const doc = parseDigest(content);
  if (!doc.hasStructure) return null;

  const lookup = buildHeadlineSourceLookup(sourceLinks);
  const order = new Map<string, number>();
  let index = 0;
  for (const section of doc.sections) {
    for (const group of section.groups) {
      if (!group.source) continue;
      addHeadlineOrderKeys(order, group.source, index);
      const sourceLink = headlineSourceLinkForSource(group.source, lookup);
      if (sourceLink) {
        for (const key of headlineSourceLinkKeys(sourceLink)) {
          addHeadlineOrderKeys(order, key, index);
        }
      }
      index += 1;
    }
  }
  return order.size > 0 ? order : null;
}

function headlineSourceOrderFromSourceLinks(sourceLinks: DigestSourceLink[]) {
  const order = new Map<string, number>();
  const sorted = [...sourceLinks].sort((a, b) => {
    const rank = headlineSourceTypeRank(a.sourceType) - headlineSourceTypeRank(b.sourceType);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
  sorted.forEach((link, index) => {
    for (const key of headlineSourceLinkKeys(link)) {
      addHeadlineOrderKeys(order, key, index);
    }
  });
  return order;
}

function addHeadlineOrderKeys(order: Map<string, number>, value: string, index: number) {
  const key = headlineSourceKey(value);
  if (key && !order.has(key)) order.set(key, index);
  const bareKey = headlineSourceKey(value.replace(/^@/, ""));
  if (bareKey && !order.has(bareKey)) order.set(bareKey, index);
}

function headlineSourceLinkForSource(
  source: string,
  lookup: Map<string, DigestSourceLink>,
) {
  const direct = lookup.get(headlineSourceKey(source));
  if (direct) return direct;

  const parts = source
    .normalize("NFKC")
    .split(/[()（）]/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const match = lookup.get(headlineSourceKey(part));
    if (match) return match;
  }
  return undefined;
}

function headlineSourceLinksForLabel(
  source: string,
  lookup: Map<string, DigestSourceLink>,
) {
  const direct = headlineSourceLinkForSource(source, lookup);
  if (direct) return [direct];

  const matches: DigestSourceLink[] = [];
  const seen = new Set<string>();
  for (const part of splitCombinedHeadlineSourceLabel(source)) {
    const match = headlineSourceLinkForSource(part, lookup);
    if (!match || seen.has(match.entityId)) continue;
    seen.add(match.entityId);
    matches.push(match);
  }
  return matches;
}

function splitCombinedHeadlineSourceLabel(value: string) {
  return value
    .normalize("NFKC")
    .split(/\s+(?:and|&|\+)\s+|[、，,]\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function headlineSourceTypeRank(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "website";
  const index = DEFAULT_HEADLINE_SOURCE_TYPE_ORDER.indexOf(normalized);
  return index === -1 ? DEFAULT_HEADLINE_SOURCE_TYPE_ORDER.length : index;
}

function buildHeadlineSourceLookup(sourceLinks: DigestSourceLink[]) {
  const lookup = new Map<string, DigestSourceLink>();
  for (const link of sourceLinks) {
    for (const value of headlineSourceLinkKeys(link)) {
      const key = headlineSourceKey(value);
      if (key && !lookup.has(key)) lookup.set(key, link);
    }
  }
  return lookup;
}

function headlineSourceLinkKeys(link: DigestSourceLink) {
  const keys = [
    link.name,
    ...(link.aliases ?? []),
    link.handle ?? "",
    headlineHostOf(link.sourceUrl ?? ""),
    headlineHostOf(link.fetchUrl ?? ""),
  ].filter(Boolean);
  return [...keys, ...keys.map((key) => key.replace(/^@/, ""))];
}

function headlineSourceKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineHostOf(value: string) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
