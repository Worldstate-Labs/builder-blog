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

        if (!response.ok) throw new Error("Could not update AI Digest collection sharing.");
      } catch {
        setShared(!nextShared);
        setError("Could not update AI Digest collection sharing.");
      }
    });
  }

  const label = shared ? "Remove from Hub" : "Share to Hub";
  const actionLabel = shared
    ? "Remove AI Digest collection from Hub"
    : "Share AI Digest collection to Hub";

  return (
    <div className="hub-share-control">
      <button
        aria-label={actionLabel}
        aria-busy={isPending}
        className="hub-share-button"
        disabled={isPending}
        onClick={updateVisibility}
        type="button"
      >
        <span className="hub-share-label">
          {label}
        </span>
      </button>
      {error ? (
        <span className="hub-share-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
