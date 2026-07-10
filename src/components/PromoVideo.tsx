"use client";

import { useEffect, useState } from "react";

// Matches the landing page's mobile breakpoint in globals.css.
const MOBILE_QUERY = "(max-width: 900px)";

export function PromoVideo() {
  // Picked once at mount — swapping the src on resize would restart a
  // playing film, so a mid-session viewport change keeps the first choice.
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(
      window.matchMedia(MOBILE_QUERY).matches
        ? "/followbrief-promo-mobile.mp4"
        : "/followbrief-promo.mp4",
    );
  }, []);

  if (!src) return null;

  return (
    <video
      src={src}
      aria-label="FollowBrief promo film"
      controls
      playsInline
      preload="metadata"
    />
  );
}
