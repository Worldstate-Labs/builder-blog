"use client";

import { useRef, useSyncExternalStore } from "react";
import { Maximize } from "lucide-react";

// Matches the landing page's mobile breakpoint in globals.css.
const MOBILE_QUERY = "(max-width: 900px)";

// The store never changes after mount, so subscribe is a no-op: the server and
// the first (hydration) client render both read `false`, keeping markup in sync
// and avoiding a hydration mismatch; the post-hydration render reads `true`.
const noopSubscribe = () => () => {};
const getHydrated = () => true;
const getServerHydrated = () => false;

export function PromoVideo() {
  const hydrated = useSyncExternalStore(noopSubscribe, getHydrated, getServerHydrated);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Read the viewport once, after hydration. Swapping the src on resize would
  // restart a playing film, so a mid-session viewport change keeps this choice.
  if (!hydrated) return null;
  const isMobile = window.matchMedia(MOBILE_QUERY).matches;

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
