"use client";

import { useState, useTransition } from "react";

type LibraryVisibilityToggleProps = {
  disabled: boolean;
  initialIsPublic: boolean;
  name: string;
};

export function LibraryVisibilityToggle({
  disabled,
  initialIsPublic,
  name,
}: LibraryVisibilityToggleProps) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateVisibility() {
    if (disabled || isPending) return;

    const nextIsPublic = !isPublic;
    setIsPublic(nextIsPublic);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/personal-availability", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPublic: nextIsPublic, name }),
        });

        if (!response.ok) {
          throw new Error("Unable to update library visibility");
        }

        const payload = (await response.json()) as { isPublic?: boolean };
        setIsPublic(Boolean(payload.isPublic));
      } catch {
        setIsPublic(!nextIsPublic);
        setError("Could not update hub availability.");
      }
    });
  }

  return (
    <div className="library-visibility-control">
      <div className="library-visibility-copy">
        <span>Hub availability</span>
        <strong>{isPublic ? "Public on Hub" : "Private"}</strong>
        {error ? <small role="status">{error}</small> : null}
      </div>
      <button
        aria-busy={isPending}
        aria-pressed={isPublic}
        className={`library-visibility-toggle ${isPublic ? "is-on" : ""}`}
        disabled={disabled || isPending}
        onClick={updateVisibility}
        type="button"
      >
        <span className="library-visibility-track" aria-hidden="true">
          <span className="library-visibility-thumb" />
        </span>
        <span>{isPending ? "Updating" : isPublic ? "Public" : "Private"}</span>
      </button>
    </div>
  );
}
