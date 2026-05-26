"use client";

import { useState, useTransition } from "react";

export type DetailChannelOption = {
  builderId: string;
  libraryName: string;
  isOwnChannel: boolean;
  isAdminCommunity: boolean;
};

type BuilderDetailActionsProps = {
  entityId: string;
  initialSubscribed: boolean;
  initialPrimaryBuilderId: string | null;
  channels: DetailChannelOption[];
};

/**
 * Client controls on the canonical builder detail page:
 *   - Follow / Unfollow toggle (writes Subscription scoped to entity).
 *   - Primary channel selector (writes UserChannelPreference).
 *
 * Uses the first channel as the implicit subscribe-via target; the API resolves to the
 * entity regardless, so any channel of the entity works.
 */
export function BuilderDetailActions({
  entityId,
  initialSubscribed,
  initialPrimaryBuilderId,
  channels,
}: BuilderDetailActionsProps) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [primary, setPrimary] = useState(initialPrimaryBuilderId ?? channels[0]?.builderId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const follow = (next: boolean) => {
    const previous = subscribed;
    setSubscribed(next);
    setError(null);
    startTransition(async () => {
      const targetBuilderId = primary ?? channels[0]?.builderId;
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

  const switchPrimary = (builderId: string) => {
    const previous = primary;
    setPrimary(builderId);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/channel-preference", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId, builderId }),
        });
        if (!response.ok) throw new Error("Channel switch failed");
      } catch {
        setPrimary(previous);
        setError("Couldn't switch source channel.");
      }
    });
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending || channels.length === 0}
          onClick={() => follow(!subscribed)}
          className={
            subscribed
              ? "fb-btn fb-btn-light fb-btn-compact"
              : "fb-btn fb-btn-dark fb-btn-compact"
          }
        >
          {isPending ? "..." : subscribed ? "✓ Following" : "Follow"}
        </button>

        {channels.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
            <span>Source:</span>
            <select
              className="fb-select"
              value={primary ?? ""}
              onChange={(e) => switchPrimary(e.target.value)}
              disabled={isPending}
            >
              {channels.map((ch) => (
                <option key={ch.builderId} value={ch.builderId}>
                  {ch.libraryName}
                  {ch.isOwnChannel ? " (own)" : ch.isAdminCommunity ? " (community)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : channels[0] ? (
          <span className="text-sm text-[var(--muted-strong)]">
            Source: <span className="font-mono">{channels[0].libraryName}</span>
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="text-xs text-[var(--danger)]" role="status">
          {error}
        </div>
      ) : null}
    </div>
  );
}
