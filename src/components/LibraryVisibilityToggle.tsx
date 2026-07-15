"use client";

import { useEffect, useId, useRef, useState, useTransition, type RefObject } from "react";

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const syncedInitialIsPublicRef = useRef(initialIsPublic);

  useEffect(() => {
    if (isPending || syncedInitialIsPublicRef.current === initialIsPublic) return;
    syncedInitialIsPublicRef.current = initialIsPublic;
    setIsPublic(initialIsPublic);
  }, [initialIsPublic, isPending]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (confirmOpen && !dialog.open) {
      dialog.showModal();
    } else if (!confirmOpen && dialog.open) {
      dialog.close();
    }
  }, [confirmOpen]);

  function updateVisibility(nextIsPublic = !isPublic) {
    if (disabled || isPending) return;

    setIsPublic(nextIsPublic);
    setError(null);
    setConfirmOpen(false);

    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/personal-availability", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPublic: nextIsPublic, name }),
        });

        if (!response.ok) {
          throw new Error("Could not update source library sharing.");
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
    const compactLabel = isPublic ? "Keep private" : "Share to Hub";
    const actionLabel = isPublic
      ? "Remove source library from Hub"
      : "Share source library to Hub";

    return (
      <div className="hub-share-control">
        <button
          aria-label={actionLabel}
          aria-describedby={disabled ? disabledReasonId : undefined}
          aria-busy={isPending}
          aria-pressed={isPublic}
          className={`fb-stateful-action hub-share-button ${isPublic ? "is-on" : "is-off"}`}
          disabled={disabled || isPending}
          onClick={() => {
            if (!isPublic) {
              setError(null);
              setConfirmOpen(true);
              return;
            }
            updateVisibility(false);
          }}
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
        <ShareLibraryDialog
          dialogRef={dialogRef}
          isPending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => updateVisibility(true)}
        />
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
        onClick={() => {
          if (!isPublic) {
            setError(null);
            setConfirmOpen(true);
            return;
          }
          updateVisibility(false);
        }}
        type="button"
      >
        <span className="library-visibility-track" aria-hidden="true">
          <span className="library-visibility-thumb" />
        </span>
        <span>{isPending ? "Updating" : isPublic ? "Shared" : "Private"}</span>
      </button>
      <ShareLibraryDialog
        dialogRef={dialogRef}
        isPending={isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => updateVisibility(true)}
      />
    </div>
  );
}

function ShareLibraryDialog({
  dialogRef,
  isPending,
  onCancel,
  onConfirm,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <dialog
      ref={dialogRef}
      className="fb-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <div className="fb-dialog-inner settings-dialog-stack">
        <div>
          <h3 className="fb-section-heading">Share source library?</h3>
          <p className="settings-dialog-copy">
            Sharing publishes this source library to Hub. Other users can see
            source names, source links, the library name, description, counts,
            and public Hub activity until you remove it.
          </p>
        </div>
        <div className="settings-dialog-actions">
          <button
            className="fb-btn light"
            disabled={isPending}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="fb-btn dark"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            Continue sharing
          </button>
        </div>
      </div>
    </dialog>
  );
}
