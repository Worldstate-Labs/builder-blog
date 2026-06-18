"use client";

import { useState, useTransition } from "react";

type BuilderDetailActionsProps = {
  entityId: string;
  initialSubscribed: boolean;
  sourceName: string;
};

/**
 * Follow / unfollow button on the entity detail page.
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
  sourceName,
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
        setError(`Could not update Following for ${sourceName}.`);
      }
    });
  };

  return (
    <div className="builder-detail-action-stack">
      <div className="builder-detail-action-row">
        <button
          type="button"
          disabled={isPending}
          aria-busy={isPending}
          aria-pressed={subscribed}
          aria-label={`${subscribed ? "Unfollow" : "Follow"} ${sourceName}`}
          onClick={() => follow(!subscribed)}
          className={`fb-follow-button${subscribed ? " is-following" : " is-follow"}`}
        >
          {isPending ? "Updating" : subscribed ? "Following" : "Follow"}
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
