"use client";

import { useEffect, useRef, useState, useTransition } from "react";

type DigestPipelineVisibilityToggleProps = {
  initialShared: boolean;
};

export function DigestPipelineVisibilityToggle({
  initialShared,
}: DigestPipelineVisibilityToggleProps) {
  const [shared, setShared] = useState(initialShared);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (confirmOpen && !dialog.open) {
      dialog.showModal();
    } else if (!confirmOpen && dialog.open) {
      dialog.close();
    }
  }, [confirmOpen]);

  function updateVisibility(nextShared = !shared) {
    if (isPending) return;

    setShared(nextShared);
    setError(null);
    setConfirmOpen(false);

    startTransition(async () => {
      try {
        const response = await fetch("/api/digest-pipelines/share", {
          method: nextShared ? "POST" : "DELETE",
          headers: nextShared ? { "Content-Type": "application/json" } : undefined,
          body: nextShared ? JSON.stringify({}) : undefined,
        });

        if (!response.ok) throw new Error("Could not update AI Brief collection sharing.");
      } catch {
        setShared(!nextShared);
        setError("Could not update AI Brief collection sharing.");
      }
    });
  }

  const label = shared ? "Remove from Hub" : "Share to Hub";
  const actionLabel = shared
    ? "Remove AI Brief collection from Hub"
    : "Share AI Brief collection to Hub";

  return (
    <div className="hub-share-control">
      <button
        aria-label={actionLabel}
        aria-busy={isPending}
        aria-pressed={shared}
        className={`fb-stateful-action hub-share-button ${shared ? "is-on" : "is-off"}`}
        disabled={isPending}
        onClick={() => {
          if (!shared) {
            setError(null);
            setConfirmOpen(true);
            return;
          }
          updateVisibility(false);
        }}
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
      <dialog
        ref={dialogRef}
        className="fb-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setConfirmOpen(false);
        }}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="fb-dialog-inner settings-dialog-stack">
          <div>
            <h3 className="fb-section-heading">Share AI Brief collection?</h3>
            <p className="settings-dialog-copy">
              Sharing publishes this AI Brief collection to Hub. Other users
              can see the latest AI Brief metadata, title, headline,
              description, import counts, and public Hub activity until you
              remove it.
            </p>
          </div>
          <div className="settings-dialog-actions">
            <button
              className="fb-btn light"
              disabled={isPending}
              onClick={() => setConfirmOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="fb-btn dark"
              disabled={isPending}
              onClick={() => updateVisibility(true)}
              type="button"
            >
              Continue sharing
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
