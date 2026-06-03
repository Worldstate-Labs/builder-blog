"use client";

import { useState, useTransition } from "react";

type BuilderDetailActionsProps = {
  entityId: string;
  initialSubscribed: boolean;
};

/**
 * Follow / unfollow toggle on the entity detail page.
 *
 * "Follow" is entity-level from the user's perspective ("follow this
 * creator"), even though Subscription rows are stored per-channel.
 * The server endpoint fans the toggle out across every channel of
 * this entity that the user has in their pool, and `initialSubscribed`
 * reflects "any channel currently subscribed". Per-channel granular
 * control still lives on the library row toggle.
 */
export function BuilderDetailActions({
  entityId,
  initialSubscribed,
}: BuilderDetailActionsProps) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const follow = (next: boolean) => {
    const previous = subscribed;
    setSubscribed(next);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/builders/entity/${entityId}/subscription`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscribed: next }),
          },
        );
        if (!response.ok) throw new Error("Subscription update failed");
      } catch {
        setSubscribed(previous);
        setError("Couldn't update follow state.");
      }
    });
  };

  return (
    <div className="builder-detail-action-stack">
      <div className="builder-detail-action-row">
        <button
          type="button"
          disabled={isPending}
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
        <div className="builder-detail-action-error" role="status">
          {error}
        </div>
      ) : null}
    </div>
  );
}
