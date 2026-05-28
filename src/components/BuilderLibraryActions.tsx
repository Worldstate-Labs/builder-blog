"use client";

import { useState, useTransition } from "react";
import { Bell, X } from "lucide-react";

type BuilderLibraryActionsProps = {
  allowRemove?: boolean;
  builderId: string;
  initialSubscribed: boolean;
  onRemoveStateChange?: (builderId: string, removed: boolean) => void;
  onSubscriptionStateChange?: (
    builderId: string,
    subscribed: boolean,
    previousSubscribed: boolean,
  ) => void;
};

export function SubscribeAllLibraryBuildersButton({
  onSubscribedAll,
}: {
  onSubscribedAll?: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "done" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  function subscribeAll() {
    if (isPending) return;
    setPhase("idle");
    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/subscriptions", {
          method: "POST",
        });
        if (!response.ok) throw new Error("Unable to follow sources");
        onSubscribedAll?.();
        setPhase("done");
      } catch {
        setPhase("error");
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <button
        aria-busy={isPending}
        className="fb-btn dark"
        disabled={isPending}
        onClick={subscribeAll}
        type="button"
      >
        <Bell aria-hidden="true" />
        {isPending ? "Following..." : phase === "done" ? "Following" : "Follow all in library"}
      </button>
      {phase === "error" ? (
        <span className="text-xs text-[var(--danger)]" role="status">
          Could not follow all sources.
        </span>
      ) : null}
    </div>
  );
}

export function BuilderLibraryActions({
  allowRemove = true,
  builderId,
  initialSubscribed,
  onRemoveStateChange,
  onSubscriptionStateChange,
}: BuilderLibraryActionsProps) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (removed) return null;

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

  function removeFromLibrary() {
    if (isPending) return;
    setRemoved(true);
    onRemoveStateChange?.(builderId, true);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/builders/${builderId}/library`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Unable to remove source");
      } catch {
        setRemoved(false);
        onRemoveStateChange?.(builderId, false);
        setError("Could not remove source.");
      }
    });
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2.5">
        <button
          aria-busy={isPending}
          aria-pressed={subscribed}
          aria-label={subscribed ? "Unfollow" : "Follow"}
          className="inline-flex items-center gap-1.5"
          disabled={isPending}
          onClick={updateSubscription}
          type="button"
        >
          <span className="text-[12px] font-semibold text-[var(--muted-strong)]">
            Follow
          </span>
          <span className={`fb-toggle${subscribed ? " on" : ""}`} aria-hidden="true" />
        </button>
        {allowRemove ? (
          <button
            aria-busy={isPending}
            aria-label="Remove from library"
            className="fb-icon-btn fb-icon-btn--xs"
            disabled={isPending}
            onClick={removeFromLibrary}
            type="button"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {error ? (
        <span className="text-[11px] text-[var(--danger)]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
