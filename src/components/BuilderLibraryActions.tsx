"use client";

import { useState, useTransition } from "react";

type BuilderLibraryActionsProps = {
  builderId: string;
  initialSubscribed: boolean;
  onSubscriptionStateChange?: (
    builderId: string,
    subscribed: boolean,
    previousSubscribed: boolean,
  ) => void;
};

export function BuilderLibraryActions({
  builderId,
  initialSubscribed,
  onSubscriptionStateChange,
}: BuilderLibraryActionsProps) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateSubscription() {
    if (isPending) return;
    const previousSubscribed = subscribed;
    const nextSubscribed = !subscribed;
    setSubscribed(nextSubscribed);
    onSubscriptionStateChange?.(builderId, nextSubscribed, previousSubscribed);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/builders/${builderId}/subscription`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscribed: nextSubscribed }),
        });
        if (!response.ok) throw new Error("Unable to update subscription");
        const payload = (await response.json()) as { subscribed?: boolean };
        const confirmedSubscribed = Boolean(payload.subscribed);
        setSubscribed(confirmedSubscribed);
        if (confirmedSubscribed !== nextSubscribed) {
          onSubscriptionStateChange?.(builderId, confirmedSubscribed, nextSubscribed);
        }
      } catch {
        setSubscribed(previousSubscribed);
        onSubscriptionStateChange?.(builderId, previousSubscribed, nextSubscribed);
        setError("Could not update subscription.");
      }
    });
  }

  return (
    <div className="builder-library-action-stack">
      <div className="builder-library-follow-row">
        <button
          aria-busy={isPending}
          aria-pressed={subscribed}
          aria-label={subscribed ? "Unfollow" : "Follow"}
          className={`fb-follow-button${subscribed ? " is-following" : " is-follow"}`}
          disabled={isPending}
          onClick={updateSubscription}
          type="button"
        >
          {isPending ? "Updating..." : subscribed ? "Following" : "Follow"}
        </button>
      </div>
      {error ? (
        <span className="builder-library-action-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
