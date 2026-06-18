"use client";

import { useState, type CSSProperties } from "react";

export type SourceAvatarSource = {
  avatarDataUrl?: string | null;
  avatarUrl: string | null;
  fetchUrl: string | null;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
};

type SourceAvatarProps = {
  className?: string;
  imageSize?: number;
  source: SourceAvatarSource;
  style?: CSSProperties;
};

function avatarMonogram(source: SourceAvatarSource): string {
  // Strip a leading "@" so X handles like "@karpathy" render as "K"
  // instead of "@", which was indistinguishable across rows.
  const cleaned = source.name.replace(/^@+/, "").trim();
  const first = cleaned.charAt(0) || source.name.charAt(0) || "?";
  return first.toUpperCase();
}

function avatarFaviconUrl(source: SourceAvatarSource): string | null {
  // For X and YouTube every row shares the same platform host, so
  // the favicon would be the same generic logo for every account.
  if (source.sourceType === "x" || source.sourceType === "youtube") return null;
  const url = source.sourceUrl ?? source.fetchUrl;
  if (!url) return null;
  try {
    const host = new URL(url).host;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

export function SourceAvatar({
  className = "",
  imageSize = 36,
  source,
  style,
}: SourceAvatarProps) {
  const monogram = avatarMonogram(source);
  const realAvatarUrl = source.avatarUrl;
  const cachedAvatarUrl = source.avatarDataUrl ?? null;
  const faviconUrl = avatarFaviconUrl(source);
  // Priority chain: live server-resolved photo -> cached DB snapshot -> host favicon -> monogram.
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const baseClassName = `fb-src-icon ${className}`.trim();
  const imageStyle: CSSProperties = {
    height: "100%",
    inset: 0,
    objectFit: "cover",
    position: "absolute",
    width: "100%",
  };
  const frameStyle: CSSProperties = {
    ...style,
    overflow: "hidden",
    padding: 0,
    position: "relative",
  };

  function markFailed(url: string) {
    setFailedUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }

  function renderImageAvatar(url: string) {
    return (
      <span className={baseClassName} style={frameStyle}>
        <span className="source-avatar-fallback" aria-hidden="true">
          {monogram}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          height={imageSize}
          key={url}
          loading="lazy"
          onError={() => markFailed(url)}
          src={url}
          style={imageStyle}
          width={imageSize}
        />
      </span>
    );
  }

  if (realAvatarUrl && !failedUrls.has(realAvatarUrl)) {
    return renderImageAvatar(realAvatarUrl);
  }

  if (cachedAvatarUrl && !failedUrls.has(cachedAvatarUrl)) {
    return renderImageAvatar(cachedAvatarUrl);
  }

  if (faviconUrl && !failedUrls.has(faviconUrl)) {
    return renderImageAvatar(faviconUrl);
  }

  return (
    <span className={baseClassName} style={style}>
      {monogram}
    </span>
  );
}
