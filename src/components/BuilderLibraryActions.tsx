"use client";

import { useState, useTransition } from "react";
import { Bell, BellOff, Trash2 } from "lucide-react";

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
        if (!response.ok) throw new Error("Unable to subscribe sources");
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
        className="button-dark gap-2"
        disabled={isPending}
        onClick={subscribeAll}
        type="button"
      >
        <Bell className="h-4 w-4" />
        {isPending ? "Subscribing..." : phase === "done" ? "Subscribed" : "Subscribe all in library"}
      </button>
      {phase === "error" ? (
        <span className="text-xs text-[var(--danger)]" role="status">
          Could not subscribe all sources.
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
    <div className="grid gap-2">
      <div className="row-actions">
        <button
          aria-busy={isPending}
          className={`${subscribed ? "button-light" : "button-dark"} button-compact gap-2`}
          disabled={isPending}
          onClick={updateSubscription}
          type="button"
        >
          {subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {isPending ? "Updating..." : subscribed ? "Unsubscribe" : "Subscribe"}
        </button>
        {allowRemove ? (
          <button
            aria-busy={isPending}
            className="button-light button-compact button-danger gap-2"
            disabled={isPending}
            onClick={removeFromLibrary}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            {isPending ? "Removing..." : "Remove from library"}
          </button>
        ) : null}
      </div>
      {error ? (
        <span className="text-xs text-[var(--danger)]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
