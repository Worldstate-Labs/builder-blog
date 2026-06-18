"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

type LibraryImportRemoveButtonProps = {
  libraryId: string;
  libraryName: string;
};

export function LibraryImportRemoveButton({
  libraryId,
  libraryName,
}: LibraryImportRemoveButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = removeDialogRef.current;
    if (!dialog) return;
    if (confirmingRemove) {
      if (!dialog.open) dialog.showModal();
    }
  }, [confirmingRemove]);

  if (removed) return null;

  function requestRemove(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isPending) return;
    setError(null);
    setConfirmingRemove(true);
  }

  function closeRemoveDialog() {
    if (removeDialogRef.current?.open) {
      removeDialogRef.current.close();
    }
    setConfirmingRemove(false);
  }

  function handleRemoveDialogClose() {
    setConfirmingRemove(false);
  }

  function removeImport() {
    if (isPending) return;
    closeRemoveDialog();
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/imports", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId }),
        });
        if (!response.ok) throw new Error("Could not remove imported source library.");
        setRemoved(true);
        router.refresh();
      } catch {
        setError("Could not remove imported source library.");
      }
    });
  }

  const removeDialog = confirmingRemove && typeof document !== "undefined"
    ? createPortal(
        <dialog
          aria-labelledby="import-remove-source-library-title"
          className="fb-dialog"
          onClick={(event) => {
            if (event.target === removeDialogRef.current) closeRemoveDialog();
          }}
          onClose={handleRemoveDialogClose}
          ref={removeDialogRef}
        >
          <div className="fb-dialog-inner settings-dialog-stack">
            <h3 className="fb-section-heading" id="import-remove-source-library-title">
              Remove imported source library?
            </h3>
            <div className="settings-dialog-copy">
              <p>
                Removing <strong>{libraryName}</strong> removes its sources from
                Sources and stops feeding AI Digest and Following.
              </p>
              <p className="settings-dialog-warning">
                You can import it again from Hub.
              </p>
            </div>
            <div className="settings-dialog-actions">
              <button
                className="fb-btn light compact"
                onClick={closeRemoveDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="fb-btn danger compact"
                onClick={removeImport}
                type="button"
              >
                Remove import
              </button>
            </div>
          </div>
        </dialog>,
        document.body,
      )
    : null;

  return (
    <div className="import-remove-control">
      <button
        aria-busy={isPending}
        aria-label={`Remove imported source library ${libraryName}`}
        className="fb-btn light compact import-remove-button"
        disabled={isPending}
        onClick={requestRemove}
        type="button"
      >
        <Trash2 className="import-remove-icon" />
        {isPending ? "Removing" : "Remove import"}
      </button>
      {error ? (
        <span className="import-remove-error" role="status">
          {error}
        </span>
      ) : null}
      {removeDialog}
    </div>
  );
}
