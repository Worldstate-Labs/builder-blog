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

  function removeImport() {
    if (isPending) return;
    setConfirmingRemove(false);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/imports", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId }),
        });
        if (!response.ok) throw new Error("Unable to remove source library import");
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
          className="fb-dialog"
          onClick={(event) => {
            if (event.target === removeDialogRef.current) setConfirmingRemove(false);
          }}
          onClose={() => setConfirmingRemove(false)}
          ref={removeDialogRef}
        >
          <div className="fb-dialog-inner settings-dialog-stack">
            <h3 className="fb-section-heading">Remove imported source library?</h3>
            <div className="settings-dialog-copy">
              <p>
                After removing <strong>{libraryName}</strong>, sources from this
                library will no longer appear in your Sources page or Following.
              </p>
              <p className="settings-dialog-warning">
                You can import it again from the Hub later.
              </p>
            </div>
            <div className="settings-dialog-actions">
              <button
                className="fb-btn light compact"
                onClick={() => setConfirmingRemove(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="fb-btn danger compact"
                onClick={removeImport}
                type="button"
              >
                Remove source library
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
        aria-label={`Remove ${libraryName} from imported source libraries`}
        className="fb-btn light compact import-remove-button"
        disabled={isPending}
        onClick={requestRemove}
        type="button"
      >
        <Trash2 className="import-remove-icon" />
        {isPending ? "Removing" : "Remove source library"}
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
