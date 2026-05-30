"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Play } from "lucide-react";
import {
  parseDigest,
  type DigestDoc,
  type DigestInline,
  type DigestMedia,
  type DigestPost,
  type DigestSection,
} from "@/lib/digest-markdown";

// Renders the agent's digest markdown as a multimedia, progressively-readable
// document: real links, embedded video (lazy facade), a jump-to-section index,
// collapsible sections, and per-post "Show more" so a long brief stays
// scannable. `tone` adapts it to the dark "today" hero vs the paper archive.
export function DigestContent({
  content,
  tone = "paper",
}: {
  content: string;
  tone?: "paper" | "dark";
}) {
  const doc: DigestDoc = useMemo(() => parseDigest(content ?? ""), [content]);

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

  const showContents = doc.sections.length >= 2;

  return (
    <div className={wrapClass(tone)}>
      {doc.lead.map((p, i) => (
        <p key={`lead-${i}`} className="digest-lead-note">
          <Inline nodes={p} />
        </p>
      ))}

      {showContents ? (
        <nav className="digest-contents" aria-label="Digest sections">
          {doc.sections.map((s) => (
            <a key={s.id} className="digest-contents-chip" href={`#${s.id}`}>
              <span className="truncate">{s.heading || "Updates"}</span>
              <span className="digest-contents-count">{s.postCount}</span>
            </a>
          ))}
        </nav>
      ) : null}

      {doc.sections.map((section) => (
        <SectionBlock key={section.id} section={section} collapsible={doc.postCount >= 4} />
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
}: {
  section: DigestSection;
  collapsible: boolean;
}) {
  const body = (
    <div className="digest-section-body">
      {section.groups.map((group, gi) => (
        <div key={gi} className="digest-group">
          {group.source ? <div className="digest-group-label">{group.source}</div> : null}
          {group.posts.map((post) => (
            <PostBlock key={post.id} post={post} />
          ))}
        </div>
      ))}
    </div>
  );

  if (!collapsible || !section.heading) {
    return (
      <section id={section.id} className="digest-section scroll-mt-24">
        {section.heading ? <h3 className="digest-section-heading">{section.heading}</h3> : null}
        {body}
      </section>
    );
  }

  return (
    <details id={section.id} className="digest-section scroll-mt-24" open>
      <summary className="digest-section-summary">
        <ChevronDown aria-hidden="true" className="digest-section-chevron" />
        <h3 className="digest-section-heading">{section.heading}</h3>
        <span className="digest-section-count">{section.postCount}</span>
      </summary>
      {body}
    </details>
  );
}

function PostBlock({ post }: { post: DigestPost }) {
  return (
    <article className="digest-post">
      {post.title ? <h4 className="digest-post-title">{post.title}</h4> : null}
      {post.lede ? (
        <p className="digest-lede">
          <Inline nodes={post.lede} />
        </p>
      ) : null}
      {post.paragraphs.length > 0 ? <ProseClamp paragraphs={post.paragraphs} /> : null}
      {post.media.length > 0 ? (
        <div className="digest-media">
          {post.media.map((m, i) =>
            m.kind === "video" ? (
              <VideoEmbed key={i} media={m} />
            ) : (
              <SourceLink key={i} media={m} />
            ),
          )}
        </div>
      ) : null}
    </article>
  );
}

const CLAMP_LINES = 6;

function ProseClamp({ paragraphs }: { paragraphs: DigestInline[][] }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflowing(el.scrollHeight - el.clientHeight > 6);
  }, [expanded, paragraphs]);

  return (
    <div className="digest-prose-wrap">
      <div
        ref={ref}
        className={`digest-prose${expanded ? "" : " is-clamped"}`}
        style={{ ["--dr-clamp-lines" as string]: String(CLAMP_LINES) }}
      >
        {paragraphs.map((p, i) => (
          <p key={i} className={i === 0 ? "" : "digest-prose-p"}>
            <Inline nodes={p} />
          </p>
        ))}
      </div>
      {overflowing || expanded ? (
        <button
          type="button"
          className="digest-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function VideoEmbed({ media }: { media: DigestMedia }) {
  const [playing, setPlaying] = useState(false);

  if (media.youtubeId) {
    return (
      <figure className="dr-video">
        {playing ? (
          <iframe
            className="dr-video-frame"
            src={`https://www.youtube-nocookie.com/embed/${media.youtubeId}?autoplay=1&rel=0`}
            title="Embedded video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="dr-video-facade"
            onClick={() => setPlaying(true)}
            aria-label="Play video"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="dr-video-thumb"
              src={`https://i.ytimg.com/vi/${media.youtubeId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
            />
            <span className="dr-play" aria-hidden="true">
              <Play className="h-5 w-5" />
            </span>
          </button>
        )}
        <a className="dr-video-out" href={media.url} target="_blank" rel="noreferrer">
          Watch on YouTube
          <ExternalLink className="h-3 w-3" />
        </a>
      </figure>
    );
  }

  // Non-YouTube video (bilibili/vimeo/etc.) — a rich link-out card rather than a
  // bare URL; safer than embedding arbitrary third-party players.
  return <SourceLink media={media} />;
}

function SourceLink({ media }: { media: DigestMedia }) {
  const label = media.label?.trim();
  return (
    <a className="dr-source" href={media.url} target="_blank" rel="noreferrer">
      {label ? <span className="dr-source-label">{label}</span> : null}
      <span className="dr-source-host">{media.host}</span>
      <ExternalLink className="dr-source-icon" aria-hidden="true" />
    </a>
  );
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
