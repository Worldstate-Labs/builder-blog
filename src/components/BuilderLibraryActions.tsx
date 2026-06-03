"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
    <div className="builder-library-bulk-action">
      <button
        aria-busy={isPending}
        className="fb-btn light compact"
        disabled={isPending}
        onClick={subscribeAll}
        type="button"
      >
        <Bell aria-hidden="true" />
        {isPending ? "Following..." : phase === "done" ? "Following" : "Follow all"}
      </button>
      {phase === "error" ? (
        <span className="builder-library-action-error" role="status">
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
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    },
    [],
  );

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

  function handleRemoveClick() {
    if (isPending) return;
    if (!confirmingRemove) {
      // Arm: first click switches the button to a danger-styled
      // "Confirm?" label and auto-disarms after 4 s of no second click.
      setConfirmingRemove(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingRemove(false);
        confirmTimerRef.current = null;
      }, 4000);
      return;
    }
    // Second click: commit the delete.
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmingRemove(false);
    removeFromLibrary();
  }

  return (
    <div className="builder-library-action-stack">
      <div className="builder-library-follow-row">
        <button
          aria-busy={isPending}
          aria-pressed={subscribed}
          aria-label={subscribed ? "Unfollow" : "Follow"}
          className="builder-library-follow-toggle"
          disabled={isPending}
          onClick={updateSubscription}
          type="button"
        >
          <span>{subscribed ? "Following" : "Follow"}</span>
          <span className={`fb-toggle${subscribed ? " on" : ""}`} aria-hidden="true" />
        </button>
        {allowRemove ? (
          confirmingRemove ? (
            <button
              aria-busy={isPending}
              aria-label="Confirm remove from library"
              className="builder-library-remove-confirm"
              disabled={isPending}
              onClick={handleRemoveClick}
              type="button"
            >
              Remove?
            </button>
          ) : (
            <button
              aria-busy={isPending}
              aria-label="Remove from library"
              className="builder-library-remove-button fb-icon-btn fb-icon-btn--xs"
              disabled={isPending}
              onClick={handleRemoveClick}
              type="button"
            >
              <X aria-hidden="true" className="builder-library-remove-icon" />
            </button>
          )
        ) : null}
      </div>
      {error ? (
        <span className="builder-library-action-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
