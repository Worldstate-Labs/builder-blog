"use client";

import { useEffect, useState, useTransition } from "react";
import { Star } from "lucide-react";

type ChannelPreferenceToggleProps = {
  entityId: string;
  builderId: string;
  initialIsPreferred: boolean;
};

const channelPreferenceChanged = "followbrief:channel-preference-changed";

type ChannelPreferenceChangedDetail = {
  entityId: string;
  preferredBuilderId: string | null;
};

/**
 * Star toggle that sets/clears the user's pinned primary channel for an entity.
 * Clicking a non-preferred row PATCHes with the builderId.
 * Clicking the currently-preferred row clears it (PATCH with builderId: null).
 */
export function ChannelPreferenceToggle({
  entityId,
  builderId,
  initialIsPreferred,
}: ChannelPreferenceToggleProps) {
  const [isPreferred, setIsPreferred] = useState(initialIsPreferred);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function handlePreferenceChanged(event: Event) {
      const customEvent = event as CustomEvent<ChannelPreferenceChangedDetail>;
      if (customEvent.detail.entityId !== entityId) return;
      setIsPreferred(customEvent.detail.preferredBuilderId === builderId);
    }

    window.addEventListener(channelPreferenceChanged, handlePreferenceChanged);
    return () => {
      window.removeEventListener(channelPreferenceChanged, handlePreferenceChanged);
    };
  }, [builderId, entityId]);

  const toggle = () => {
    const next = !isPreferred;
    const previousIsPreferred = isPreferred;
    setIsPreferred(next);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/channel-preference", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            builderId: next ? builderId : null,
          }),
        });
        if (!response.ok) throw new Error("Channel preference update failed");
        window.dispatchEvent(
          new CustomEvent<ChannelPreferenceChangedDetail>(channelPreferenceChanged, {
            detail: {
              entityId,
              preferredBuilderId: next ? builderId : null,
            },
          }),
        );
      } catch {
        setIsPreferred(previousIsPreferred);
        setError("Could not update preference.");
      }
    });
  };

  return (
    <div className="channel-preference-control">
      <button
        type="button"
        disabled={isPending}
        aria-busy={isPending}
        onClick={toggle}
        title={isPreferred ? "Clear preferred channel" : "Set as preferred channel"}
        className="channel-preference-button"
        aria-pressed={isPreferred}
      >
        <Star
          size={13}
          className="channel-preference-icon"
        />
        <span>{isPreferred ? "Preferred" : "Set as preferred"}</span>
      </button>
      {error ? (
        <div className="channel-preference-error" role="status">
          {error}
        </div>
      ) : null}
    </div>
  );
}
