"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize } from "lucide-react";

// Matches the landing page's mobile breakpoint in globals.css.
const MOBILE_QUERY = "(max-width: 900px)";

export function PromoVideo() {
  // Picked once at mount — swapping the src on resize would restart a
  // playing film, so a mid-session viewport change keeps the first choice.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setIsMobile(window.matchMedia(MOBILE_QUERY).matches);
  }, []);

  if (isMobile === null) return null;

  const enterFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    // iPhone Safari has no element requestFullscreen; it exposes the vendor
    // method on the video element instead.
    const withVendor = video as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    };
    if (typeof video.requestFullscreen === "function") {
      void video.requestFullscreen();
    } else if (typeof withVendor.webkitEnterFullscreen === "function") {
      withVendor.webkitEnterFullscreen();
    }
  };

  return (
    <>
      <video
        ref={videoRef}
        src={isMobile ? "/followbrief-promo-mobile.mp4" : "/followbrief-promo.mp4"}
        aria-label="FollowBrief promo film"
        controls
        playsInline
        preload="metadata"
      />
      {isMobile ? (
        <button
          type="button"
          className="lp-film-fullscreen"
          aria-label="Enter fullscreen"
          onClick={enterFullscreen}
        >
          <Maximize aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
