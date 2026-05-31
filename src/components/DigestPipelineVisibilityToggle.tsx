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

        if (!response.ok) throw new Error("Unable to update digest pipeline sharing");
      } catch {
        setShared(!nextShared);
        setError("Could not update hub sharing.");
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        aria-busy={isPending}
        aria-pressed={shared}
        className="inline-flex items-center gap-1.5 disabled:cursor-wait disabled:opacity-60"
        disabled={isPending}
        onClick={updateVisibility}
        type="button"
      >
        <span className="text-[12px] font-semibold text-[var(--muted-strong)]">
          Share to Hub
        </span>
        <span className={`fb-toggle${shared ? " on" : ""}`} aria-hidden="true" />
      </button>
      {error ? (
        <span className="text-[10.5px] text-[var(--danger)]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
