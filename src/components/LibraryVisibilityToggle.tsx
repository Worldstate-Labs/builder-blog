"use client";

import { useId, useState, useTransition } from "react";

type LibraryVisibilityToggleProps = {
  compact?: boolean;
  disabled: boolean;
  initialIsPublic: boolean;
  isAdminLibrary?: boolean;
  name: string;
};

export function LibraryVisibilityToggle({
  compact = false,
  disabled,
  initialIsPublic,
  isAdminLibrary = false,
  name,
}: LibraryVisibilityToggleProps) {
  const disabledReasonId = useId();
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
        setError("Could not update source library sharing.");
      }
    });
  }

  if (compact) {
    const compactLabel = isPublic ? "Remove from Hub" : "Share to Hub";
    const actionLabel = isPublic
      ? "Remove source library from Hub"
      : "Share source library to Hub";

    return (
      <div className="hub-share-control">
        <button
          aria-label={actionLabel}
          aria-describedby={disabled ? disabledReasonId : undefined}
          aria-busy={isPending}
          className="hub-share-button"
          disabled={disabled || isPending}
          onClick={updateVisibility}
          type="button"
        >
          <span className="hub-share-label">
            {compactLabel}
          </span>
        </button>
        {error ? (
          <span className="hub-share-error" role="status">
            {error}
          </span>
        ) : null}
        {disabled ? (
          <span className="hub-share-disabled" id={disabledReasonId}>
            Add a source to share.
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="library-visibility-control">
      <div className="library-visibility-copy">
        <span>Source library sharing</span>
        <strong>
          {isPublic
            ? isAdminLibrary
              ? "Community source library on Hub"
              : "Shared on Hub"
            : "Private"}
        </strong>
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
        <span>{isPending ? "Updating" : isPublic ? "Shared" : "Private"}</span>
      </button>
    </div>
  );
}
