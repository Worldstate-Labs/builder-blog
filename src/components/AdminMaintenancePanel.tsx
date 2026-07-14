"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { contentSyncStateChanged } from "@/lib/content-sync-events";

type ResetSummary = {
  users: number;
  resetBuilders: number;
  deletedFeedItems: number;
  deletedLibraryFetchRuns: number;
  deletedDigests: number;
  deletedDigestRuns: number;
  deletedDigestedItems: number;
  deletedAgentJobRuns: number;
  resetCloudSourceTasks: number;
  deletedCloudQueueItems: number;
  deletedCloudRunTasks: number;
  deletedCloudRuns: number;
  deletedCloudAgentJobRuns: number;
};

export function AdminMaintenancePanel() {
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
        const response = await fetch("/api/admin/maintenance/fetch-digest-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.error ?? "Could not reset fetch and brief state.");
          return;
        }
        setStatus(resetSummaryMessage(body.summary));
        window.dispatchEvent(new Event(contentSyncStateChanged));
        closeDialog();
      } catch {
        setError("Could not reset fetch and brief state.");
      }
    });
  }

  return (
    <section className="access-keys-panel fb-panel">
      <div className="access-keys-head">
        <div className="access-keys-copy">
          <div className="access-keys-headline">
            <RotateCcw className="access-keys-headline-icon" aria-hidden="true" />
            <h2 className="fb-section-heading">Admin maintenance</h2>
          </div>
          <p className="access-keys-desc">
            Reset all generated local and Cloud fetch and AI Brief state while keeping
            accounts, sources, subscriptions, reads, and favorites.
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
          Reset all fetch and brief state
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
            <h3 className="fb-section-heading">Reset generated state?</h3>
            <p className="settings-dialog-copy">
              This deletes local and Cloud fetched posts, queues, fetch logs, AI Briefs,
              brief logs, brief inclusion markers, and related Agent run records
              for every user. Sources and subscriptions are kept. Type RESET to
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

function resetSummaryMessage(summary: ResetSummary | null | undefined) {
  if (!summary) return "Fetch and brief state reset.";
  const logCount =
    summary.deletedLibraryFetchRuns +
    summary.deletedDigestRuns +
    summary.deletedAgentJobRuns +
    summary.deletedCloudRuns +
    summary.deletedCloudAgentJobRuns;
  const cloudWorkCount =
    summary.deletedCloudQueueItems + summary.deletedCloudRunTasks;
  return [
    `Reset ${summary.resetBuilders} sources for ${summary.users} users.`,
    `Deleted ${summary.deletedFeedItems} posts, ${summary.deletedDigests} briefs, ${logCount} logs, and ${cloudWorkCount} Cloud work records.`,
  ].join(" ");
}
