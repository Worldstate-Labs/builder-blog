"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { contentSyncStateChanged } from "@/lib/content-sync-events";

type CloudLibraryResetSummary = {
  libraries: number;
  resetBuilders: number;
  resetSourceTasks: number;
  deletedFeedItems: number;
  deletedQueueItems: number;
  deletedRunTasks: number;
  deletedRuns: number;
  deletedAgentJobRuns: number;
};

export function AdminCloudLibraryMaintenancePanel() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function closeDialog() {
    if (isPending) return;
    setOpen(false);
    setConfirmation("");
  }

  function resetState() {
    if (isPending || confirmation !== "RESET") return;
    setStatus(null);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/cloud-fetch/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.error ?? "Could not reset cloud library state.");
          return;
        }
        setStatus(resetSummaryMessage(body.summary));
        window.dispatchEvent(new Event(contentSyncStateChanged));
        closeDialog();
      } catch {
        setError("Could not reset cloud library state.");
      }
    });
  }

  return (
    <section className="access-keys-panel">
      <div className="access-keys-head">
        <div className="access-keys-copy">
          <div className="access-keys-headline">
            <RotateCcw className="access-keys-headline-icon" aria-hidden="true" />
            <h2 className="fb-section-heading">Cloud library maintenance</h2>
          </div>
          <p className="access-keys-desc">
            Reset generated Cloud library posts and cloud source delivery logs while keeping
            language libraries, submitted sources, and submitter links. Stop the local worker
            host first if you want the log to stay empty.
          </p>
        </div>
      </div>

      <div className="account-data-actions">
        <button
          className="fb-btn light is-danger-outline"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setStatus(null);
            setOpen(true);
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          Reset Cloud library posts and fetch records
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
          closeDialog();
        }}
        onClose={() => setOpen(false)}
      >
        <div className="fb-dialog-inner settings-dialog-stack">
          <div>
            <h3 className="fb-section-heading">Reset Cloud library generated state?</h3>
            <p className="settings-dialog-copy">
              This deletes posts synced under Cloud library source owners, cloud source
              delivery logs, queued leases, per-source fetch outcomes, and cloud worker host
              run records. Language libraries, sources, and active user submissions are kept.
              A running worker host can create new records after the reset. Type RESET to
              continue.
            </p>
          </div>
          <input
            className="settings-dialog-input"
            disabled={isPending}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="RESET"
            value={confirmation}
          />
          <div className="settings-dialog-actions">
            <button
              className="fb-btn light"
              disabled={isPending}
              onClick={closeDialog}
              type="button"
            >
              Cancel
            </button>
            <button
              className="fb-btn danger"
              disabled={isPending || confirmation !== "RESET"}
              onClick={resetState}
              type="button"
            >
              Reset
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function resetSummaryMessage(summary: CloudLibraryResetSummary | null | undefined) {
  if (!summary) return "Cloud library generated state reset.";
  return [
    `Reset ${summary.resetBuilders} cloud sources across ${summary.libraries} language libraries.`,
    `Deleted ${summary.deletedFeedItems} posts, ${summary.deletedRuns} source delivery logs, ${summary.deletedQueueItems} queued leases, ${summary.deletedRunTasks} source outcomes, and ${summary.deletedAgentJobRuns} worker host logs.`,
  ].join(" ");
}
