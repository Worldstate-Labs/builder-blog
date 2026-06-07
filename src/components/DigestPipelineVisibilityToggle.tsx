"use client";

import { useState, useTransition } from "react";

type DigestPipelineVisibilityToggleProps = {
  initialShared: boolean;
};

export function DigestPipelineVisibilityToggle({
  initialShared,
}: DigestPipelineVisibilityToggleProps) {
  const [shared, setShared] = useState(initialShared);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateVisibility() {
    if (isPending) return;

    const nextShared = !shared;
    setShared(nextShared);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/digest-pipelines/share", {
          method: nextShared ? "POST" : "DELETE",
          headers: nextShared ? { "Content-Type": "application/json" } : undefined,
          body: nextShared ? JSON.stringify({}) : undefined,
        });

        if (!response.ok) throw new Error("Unable to update AI Digest sharing");
      } catch {
        setShared(!nextShared);
        setError("Could not update hub sharing.");
      }
    });
  }

  const label = shared ? "Shared on Hub" : "Share to Hub";
  const actionLabel = shared
    ? "Stop sharing AI Digest archive on Hub"
    : "Share AI Digest archive to Hub";

  return (
    <div className="hub-share-control">
      <button
        aria-label={actionLabel}
        aria-busy={isPending}
        aria-pressed={shared}
        className="hub-share-button"
        disabled={isPending}
        onClick={updateVisibility}
        type="button"
      >
        <span className="hub-share-label">
          {label}
        </span>
        <span className={`fb-toggle${shared ? " on" : ""}`} aria-hidden="true" />
      </button>
      {error ? (
        <span className="hub-share-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
