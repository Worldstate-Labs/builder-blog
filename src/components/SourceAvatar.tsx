"use client";

import { useState, type CSSProperties } from "react";
import { sourceIconFor } from "@/lib/source-icons";

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
  const realAvatarUrl = source.avatarUrl;
  const cachedAvatarUrl = source.avatarDataUrl ?? null;
  const faviconUrl = avatarFaviconUrl(source);
  const FallbackIcon = sourceIconFor(source.sourceType);
  // Prefer the persisted snapshot so third-party latency cannot hold the UI on a placeholder.
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

  function renderFallbackAvatar() {
    return (
      <span className={baseClassName} style={style}>
        <span className="source-avatar-fallback" aria-hidden="true">
          <FallbackIcon className="source-avatar-placeholder-icon" />
        </span>
      </span>
    );
  }

  function renderImageAvatar(url: string, eager = false) {
    return (
      <span className={baseClassName} style={frameStyle}>
        <span className="source-avatar-fallback" aria-hidden="true">
          <FallbackIcon className="source-avatar-placeholder-icon" />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          height={imageSize}
          key={url}
          loading={eager ? "eager" : "lazy"}
          onError={() => markFailed(url)}
          src={url}
          style={imageStyle}
          width={imageSize}
        />
      </span>
    );
  }

  if (cachedAvatarUrl && !failedUrls.has(cachedAvatarUrl)) {
    return renderImageAvatar(cachedAvatarUrl, true);
  }

  if (realAvatarUrl && !failedUrls.has(realAvatarUrl)) {
    return renderImageAvatar(realAvatarUrl);
  }

  if (faviconUrl && !failedUrls.has(faviconUrl)) {
    return renderImageAvatar(faviconUrl);
  }

  return renderFallbackAvatar();
}
