"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";

type ChannelPreferenceToggleProps = {
  entityId: string;
  builderId: string;
  initialIsPreferred: boolean;
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
      } catch {
        setIsPreferred(previousIsPreferred);
        setError("Couldn't update preference.");
      }
    });
  };

  return (
    <div className="channel-preference-control">
      <button
        type="button"
        disabled={isPending}
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
