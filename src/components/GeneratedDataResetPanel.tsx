"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import { generatedDataResetSummary } from "@/lib/generated-data-reset-summary";
import { translateUiPhrase } from "@/lib/i18n-phrases";

export function GeneratedDataResetPanel() {
  const { locale } = useI18n();
  const tr = (text: string) => translateUiPhrase(locale, text) ?? text;
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

  function dismissDialog() {
    setOpen(false);
    setConfirmation("");
  }

  function closeDialog() {
    if (isPending) return;
    dismissDialog();
  }

  function resetGeneratedData() {
    if (isPending || confirmation !== "RESET") return;
    setStatus(null);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/account/generated-data/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(tr(body?.error ?? "Could not reset generated data."));
          return;
        }
        setStatus(tr(generatedDataResetSummary(body?.summary)));
        window.dispatchEvent(new Event(contentSyncStateChanged));
        dismissDialog();
      } catch {
        setError(tr("Could not reset generated data."));
      }
    });
  }

  return (
    <section className="access-keys-panel fb-panel">
      <div className="access-keys-head">
        <div className="access-keys-copy">
          <div className="access-keys-headline">
            <RotateCcw className="access-keys-headline-icon" aria-hidden="true" />
            <h2 className="fb-section-heading">{tr("Generated data")}</h2>
          </div>
          <p className="access-keys-desc">
            {tr(
              "Delete posts, fetch logs, AI Briefs, brief logs, and personal Agent run records generated for your account. Sources, subscriptions, schedules, reads, and favorites are kept.",
            )}
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
          {tr("Reset fetch and AI Brief data")}
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
            <h3 className="fb-section-heading">{tr("Reset your generated data?")}</h3>
            <p className="settings-dialog-copy">
              {tr(
                "This deletes generated posts, fetch logs, AI Briefs, brief logs, inclusion markers, and personal Agent run records for your account only. Sources, subscriptions, schedules, reads, and favorites are kept. Type RESET to continue.",
              )}
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
              {tr("Cancel")}
            </button>
            <button
              className="fb-btn danger"
              disabled={isPending || confirmation !== "RESET"}
              onClick={resetGeneratedData}
              type="button"
            >
              {tr("Reset")}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
