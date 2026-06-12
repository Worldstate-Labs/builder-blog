// Parser for the digest markdown the local CLI produces after reading the
// agent's structured JSON output. A small bespoke parser (rather than a general
// markdown lib) lets us treat the digest conventions as first-class:
//
//   ## <section>        a source-type section (Blog / Podcast RSS / YouTube / …)
//   ### <source>        an entity within the section (anthropic.com, LatentSpacePod)
//   **<title>**         a post title
//   <paragraphs>        the summary, possibly with inline **bold** / [text](url)
//   原文：<url>          the article's source link   (label may be localized)
//   视频：<url>          a video (rendered as a real player, not a bare URL)
//
// Output is a typed tree the renderer turns into links, embedded video, and a
// progressively-readable layout.

import { decodeHtmlEntities } from "@/lib/decode-entities";

export type DigestInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "link"; value: string; href: string };

export type DigestMedia = {
  kind: "video" | "link";
  url: string;
  /** The label the agent used, e.g. "原文" / "视频" / "Source" ("" when bare). */
  label: string;
  /** "youtube" | "bilibili" | "vimeo" | "x" | "github" | <host>. */
  provider: string;
  /** Display host, e.g. "anthropic.com". */
  host: string;
  youtubeId: string | null;
};

export type DigestPost = {
  id: string;
  title: string | null;
  /** A leading "key takeaway" paragraph (关键要点 / Key takeaway), if present. */
  lede: DigestInline[] | null;
  paragraphs: DigestInline[][];
  media: DigestMedia[];
};

export type DigestGroup = { source: string | null; summary: DigestInline[][]; posts: DigestPost[] };

export type DigestSection = {
  id: string;
  heading: string;
  postCount: number;
  groups: DigestGroup[];
};

export type DigestDoc = {
  /** A short title/date line before the first section (the card already shows
   * the title, so the renderer may ignore this). */
  dateline: string | null;
  /** Free paragraphs before the first section — e.g. a "no new updates" body. */
  lead: DigestInline[][];
  sections: DigestSection[];
  postCount: number;
  /** False when the content has no sections/posts (plain prose). */
  hasStructure: boolean;
};

const MEDIA_LABEL =
  /^\s*(原文|来源|链接|出处|视频|影片|观看|收听|音频|播客|Source|Original|Video|Watch|Listen|Audio|Link|Podcast)\s*[:：]\s*(https?:\/\/\S+?)\s*$/i;
const BARE_URL_LINE = /^\s*(https?:\/\/\S+?)\s*$/;
const FULL_BOLD = /^\*\*(.+?)\*\*\s*$/;
const HEADING_2 = /^##\s+(.+?)\s*$/;
const HEADING_3 = /^###\s+(.+?)\s*$/;
const LEDE_PREFIX = /^\s*(关键要点|要点|核心观点|本期要点|Key takeaway|Key point|TL;DR|Takeaway)\s*[:：]/i;
const VIDEO_LABELS = new Set([
  "视频",
  "影片",
  "观看",
  "video",
  "watch",
]);

const LEGACY_SECTION_HEADINGS: Record<string, string> = {
  "blogs": "Blog",
  "official blogs": "Blog",
  "podcasts": "Podcast RSS",
  "videos": "YouTube",
  "websites": "Website",
  "github trending": "GitHub Trending",
  "product hunt": "Product Hunt Top Products",
  "product hunt top products": "Product Hunt Top Products",
  "x / twitter": "X/Twitter",
  "x twitter": "X/Twitter",
  "博客": "Blog",
  "官方博客": "Blog",
  "播客": "Podcast RSS",
  "视频": "YouTube",
  "网站": "Website",
};

function normalizeSectionHeading(value: string): string {
  const heading = value.trim();
  const key = heading.toLowerCase().replace(/\s+/g, " ");
  return LEGACY_SECTION_HEADINGS[key] ?? heading;
}

function slug(value: string, index: number): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `digest-sec-${index}${base ? `-${base}` : ""}`;
}

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function providerOf(url: string, host: string): string {
  if (youtubeId(url)) return "youtube";
  if (/(^|\.)bilibili\.com$/.test(host)) return "bilibili";
  if (/(^|\.)vimeo\.com$/.test(host)) return "vimeo";
  if (host === "x.com" || host === "twitter.com") return "x";
  if (host === "github.com") return "github";
  return host;
}

function toMedia(url: string, label: string): DigestMedia {
  const host = hostOf(url);
  const provider = providerOf(url, host);
  const yt = youtubeId(url);
  const labelIsVideo = VIDEO_LABELS.has(label.trim().toLowerCase());
  const isVideo = Boolean(yt) || provider === "bilibili" || provider === "vimeo" || labelIsVideo;
  return { kind: isVideo ? "video" : "link", url, label, provider, host, youtubeId: yt };
}

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s)]+)/g;

export function parseInline(rawText: string): DigestInline[] {
  // Decode entities up front so every emitted node value (text, bold, link
  // label) carries real characters. Entity tokens never contain the markdown
  // delimiters the regex below looks for, so decoding first cannot fabricate
  // spurious bold/link matches.
  const text = decodeHtmlEntities(rawText);
  const out: DigestInline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1] && m[2]) {
      out.push({ type: "link", value: m[1], href: m[2] });
    } else if (m[3]) {
      out.push({ type: "strong", value: m[3] });
    } else if (m[4]) {
      out.push({ type: "link", value: hostOf(m[4]), href: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.length > 0 ? out : [{ type: "text", value: text }];
}

export function parseDigest(markdown: string): DigestDoc {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");

  const sections: DigestSection[] = [];
  const lead: DigestInline[][] = [];
  let dateline: string | null = null;

  let section: DigestSection | null = null;
  let group: DigestGroup | null = null;
  let post: DigestPost | null = null;
  let postSeq = 0;

  const ensureSection = (): DigestSection => {
    if (!section) {
      section = { id: slug("", sections.length), heading: "", postCount: 0, groups: [] };
      sections.push(section);
    }
    return section;
  };
  const ensureGroup = (): DigestGroup => {
    if (!group) {
      group = { source: null, summary: [], posts: [] };
      ensureSection().groups.push(group);
    }
    return group;
  };

  const addParagraph = (text: string) => {
    const inline = parseInline(text);
    if (post) {
      if (!post.lede && post.paragraphs.length === 0 && LEDE_PREFIX.test(text)) {
        post.lede = inline;
      } else {
        post.paragraphs.push(inline);
      }
    } else if (!section && !group) {
      // Pre-section prose: capture a short first line as the dateline, the rest
      // as lead paragraphs.
      if (dateline === null && lead.length === 0 && text.trim().length <= 60 && !/[.!?。！？]/.test(text)) {
        dateline = text.trim();
      } else {
        lead.push(inline);
      }
    } else {
      // Prose under a source before the first post is the optional source-level
      // summary generated for that source.
      ensureGroup().summary.push(inline);
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const h2 = line.match(HEADING_2);
    if (h2) {
      const heading = normalizeSectionHeading(h2[1]);
      section = { id: slug(heading, sections.length), heading, postCount: 0, groups: [] };
      sections.push(section);
      group = null;
      post = null;
      continue;
    }

    const h3 = line.match(HEADING_3);
    if (h3) {
      group = { source: h3[1], summary: [], posts: [] };
      ensureSection().groups.push(group);
      post = null;
      continue;
    }

    const mediaMatch = line.match(MEDIA_LABEL);
    if (mediaMatch && post) {
      post.media.push(toMedia(mediaMatch[2], mediaMatch[1]));
      continue;
    }
    const bare = line.match(BARE_URL_LINE);
    if (bare && post) {
      post.media.push(toMedia(bare[1], ""));
      continue;
    }

    const bold = line.match(FULL_BOLD);
    if (bold) {
      post = {
        id: `p${postSeq++}`,
        title: bold[1].trim(),
        lede: null,
        paragraphs: [],
        media: [],
      };
      ensureGroup().posts.push(post);
      continue;
    }

    addParagraph(line);
  }

  let postCount = 0;
  for (const sec of sections) {
    sec.postCount = sec.groups.reduce((n, g) => n + g.posts.length, 0);
    postCount += sec.postCount;
  }

  return {
    dateline,
    lead,
    sections,
    postCount,
    hasStructure: postCount > 0,
  };
}
