"use client";

import { useState, useTransition } from "react";

type BuilderDetailActionsProps = {
  entityId: string;
  initialSubscribed: boolean;
  targetBuilderId: string | null;
};

/**
 * Client controls on the canonical builder detail page: Follow / Unfollow toggle only.
 * Channel preference is handled by ChannelPreferenceToggle in the Channels section.
 */
export function BuilderDetailActions({
  initialSubscribed,
  targetBuilderId,
}: BuilderDetailActionsProps) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const follow = (next: boolean) => {
    const previous = subscribed;
    setSubscribed(next);
    setError(null);
    startTransition(async () => {
      if (!targetBuilderId) return;
      try {
        const response = await fetch(`/api/builders/${targetBuilderId}/subscription`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscribed: next }),
        });
        if (!response.ok) throw new Error("Subscription update failed");
      } catch {
        setSubscribed(previous);
        setError("Couldn't update follow state.");
      }
    });
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending || !targetBuilderId}
          onClick={() => follow(!subscribed)}
          className={
            subscribed
              ? "fb-btn fb-btn-light fb-btn-compact"
              : "fb-btn fb-btn-dark fb-btn-compact"
          }
        >
          {isPending ? "..." : subscribed ? "✓ Following" : "Follow"}
        </button>
      </div>
      {error ? (
        <div className="text-xs text-[var(--danger)]" role="status">
          {error}
        </div>
      ) : null}
    </div>
  );
}
