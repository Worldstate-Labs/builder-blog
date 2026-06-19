"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Download, Trash2 } from "lucide-react";
import { signOut } from "next-auth/react";

export function AccountDataPanel() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, startExportTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (deleteOpen && !dialog.open) {
      dialog.showModal();
    } else if (!deleteOpen && dialog.open) {
      dialog.close();
    }
  }, [deleteOpen]);

  function closeDeleteDialog() {
    if (isDeleting) return;
    setDeleteOpen(false);
    setDeleteConfirmation("");
  }

  function exportAccountData() {
    if (isExporting) return;
    setStatus(null);
    setError(null);

    startExportTransition(async () => {
      try {
        const response = await fetch("/api/account/export", {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error("Could not export account data.");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "followbrief-account-export.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setStatus("Account export downloaded.");
      } catch {
        setError("Could not export account data.");
      }
    });
  }

  function deleteAccount() {
    if (isDeleting || deleteConfirmation !== "DELETE") return;
    setStatus(null);
    setError(null);

    startDeleteTransition(async () => {
      try {
        const response = await fetch("/api/account/delete", {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Could not delete account.");
        }

        setStatus("Account deleted.");
        await signOut({ callbackUrl: "/" });
      } catch {
        setError("Could not delete account.");
      }
    });
  }

  return (
    <section className="access-keys-panel fb-panel">
      <div className="access-keys-head">
        <div className="access-keys-copy">
          <div className="access-keys-headline">
            <Download className="access-keys-headline-icon" aria-hidden="true" />
            <h2 className="fb-section-heading">Account data</h2>
          </div>
          <p className="access-keys-desc">
            Export account data or delete your FollowBrief account, including
            reads, favorites, settings, Hub sharing records, AI Digest records,
            and Local Agent activity.
          </p>
        </div>
      </div>

      <div className="account-data-actions">
        <button
          className="fb-btn light"
          disabled={isExporting || isDeleting}
          onClick={exportAccountData}
          type="button"
        >
          <Download aria-hidden="true" />
          Export account data
        </button>
        <button
          className="fb-btn light is-danger-outline"
          disabled={isExporting || isDeleting}
          onClick={() => {
            setError(null);
            setStatus(null);
            setDeleteOpen(true);
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          Delete account
        </button>
      </div>

      {status ? (
        <span className="access-keys-status" role="status">
          <span className="access-keys-status-message">{status}</span>
        </span>
      ) : null}
      {error ? (
        <span className="access-keys-status" role="alert">
          <span className="access-keys-status-message is-error">{error}</span>
        </span>
      ) : null}

      <dialog
        ref={dialogRef}
        className="fb-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeDeleteDialog();
        }}
        onClose={() => setDeleteOpen(false)}
      >
        <div className="fb-dialog-inner settings-dialog-stack">
          <div>
            <h3 className="fb-section-heading">Delete account?</h3>
            <p className="settings-dialog-copy">
              This permanently removes your account, sessions, access keys,
              source library records, AI Digest records, preferences, reads,
              favorites, imports, and Hub sharing records. Type DELETE to
              continue.
            </p>
          </div>
          <input
            className="settings-dialog-input"
            disabled={isDeleting}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder="DELETE"
            value={deleteConfirmation}
          />
          <div className="settings-dialog-actions">
            <button
              className="fb-btn light"
              disabled={isDeleting}
              onClick={closeDeleteDialog}
              type="button"
            >
              Cancel
            </button>
            <button
              className="fb-btn danger"
              disabled={isDeleting || deleteConfirmation !== "DELETE"}
              onClick={deleteAccount}
              type="button"
            >
              Delete account
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
