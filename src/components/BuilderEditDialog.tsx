"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import type { BuilderLibraryEventItem } from "@/lib/builder-library-events";
import {
  FIXED_SOURCE_VALUE_BY_ID,
  placeholderForSourceId,
} from "@/lib/source-inputs";

type SourceOption = { id: string; label: string };

/**
 * Per-row "edit" pencil + modal that updates the same three fields
 * the user filled in at creation time (sourceType / sourceValue /
 * display name). Saves via PATCH /api/builders/[id]/personal and
 * triggers router.refresh so the updated row picks up the new fields
 * on the next render.
 */
export function BuilderEditDialog({
  builder,
  onRemoveStateChange,
  sourceOptions,
}: {
  builder: BuilderLibraryEventItem;
  onRemoveStateChange?: (builderId: string, removed: boolean) => void;
  sourceOptions: SourceOption[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const initialSourceValue =
    builder.handle && builder.sourceType === "x"
      ? `@${builder.handle}`
      : (builder.sourceUrl ?? builder.handle ?? "");

  const [name, setName] = useState(builder.name);
  const [sourceType, setSourceType] = useState(builder.sourceType);
  const [sourceValue, setSourceValue] = useState(initialSourceValue);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isPending, startTransition] = useTransition();
  const resolvedSourceValue = FIXED_SOURCE_VALUE_BY_ID[sourceType] ?? sourceValue;
  const sourceValueIsFixed = Boolean(FIXED_SOURCE_VALUE_BY_ID[sourceType]);
  const sourceFeedbackId = `edit-builder-${builder.id}-source-feedback`;

  // Sync the underlying <dialog>'s open state with React state.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        // Already open; ignore.
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Catch native close events (Escape, programmatic) so React state
  // stays in sync.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => setOpen(false);
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, []);

  function openDialog() {
    // Reset form to the latest props on open so re-opening always
    // shows the canonical current values, not stale draft state.
    setName(builder.name);
    setSourceType(builder.sourceType);
    setSourceValue(initialSourceValue);
    setError(null);
    setWarning(null);
    setConfirmingRemove(false);
    setOpen(true);
  }

  function save() {
    setError(null);
    setWarning(null);
    if (!sourceValue.trim()) {
      setError("Handle or URL is required.");
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch(`/api/builders/${builder.id}/personal`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            sourceType,
            sourceValue: resolvedSourceValue.trim(),
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.error ?? `HTTP ${response.status}`);
          return;
        }
        if (body?.warning) setWarning(body.warning);
        setOpen(false);
        // Server-fetched data on /builders is now stale — refresh
        // every route's RSC payload so the row picks up the new
        // name, sourceType, sourceUrl, etc.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save source.");
      }
    });
  }

  function removeFromLibrary() {
    if (isPending) return;
    if (!confirmingRemove) {
      setError(null);
      setWarning(null);
      setConfirmingRemove(true);
      return;
    }

    onRemoveStateChange?.(builder.id, true);
    setOpen(false);
    setConfirmingRemove(false);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/builders/${builder.id}/library`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Could not remove source.");
        router.refresh();
      } catch {
        onRemoveStateChange?.(builder.id, false);
      }
    });
  }

  return (
    <>
      <button
        aria-label={`Edit source ${builder.name}`}
        className="builder-library-edit-button fb-icon-btn fb-icon-btn--xs"
        onClick={openDialog}
        title="Edit source"
        type="button"
      >
        <Pencil aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`edit-builder-${builder.id}-title`}
        className="builder-edit-dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
      >
        <form
          method="dialog"
          className="builder-edit-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <header className="builder-edit-dialog-header">
            <h2
              id={`edit-builder-${builder.id}-title`}
              className="builder-edit-dialog-title"
            >
              Edit source
            </h2>
            <p className="builder-edit-dialog-sub">
              Update source type, handle or URL, and display name.
            </p>
          </header>

          <div className="builder-edit-dialog-body">
            <label className="builder-edit-dialog-field">
              <span className="builder-edit-dialog-field-label">Source type</span>
              <select
                className="fb-input"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
              >
                {sourceOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="builder-edit-dialog-field">
              <span className="builder-edit-dialog-field-label">Handle or URL</span>
              <input
                aria-describedby={error || warning ? sourceFeedbackId : undefined}
                aria-invalid={error ? "true" : undefined}
                aria-readonly={sourceValueIsFixed}
                className="fb-input mono"
                value={resolvedSourceValue}
                onChange={(e) => {
                  if (sourceValueIsFixed) return;
                  setSourceValue(e.target.value);
                  setError(null);
                  setWarning(null);
                }}
                placeholder={placeholderForSourceId(sourceType)}
                readOnly={sourceValueIsFixed}
                required
              />
            </label>

            <label className="builder-edit-dialog-field">
              <span className="builder-edit-dialog-field-label">
                Display name (optional)
              </span>
              <input
                className="fb-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Leave blank to use the resolved name"
              />
            </label>

            {error ? (
              <span
                id={sourceFeedbackId}
                className="builder-edit-dialog-message is-error"
                role="alert"
              >
                {error}
              </span>
            ) : warning ? (
              <span
                id={sourceFeedbackId}
                className="builder-edit-dialog-message"
                role="status"
              >
                {warning}
              </span>
            ) : null}
          </div>

          <footer className="builder-edit-dialog-footer">
            <div className="builder-edit-dialog-danger">
              <button
                type="button"
                className={`fb-btn compact builder-edit-remove-button${confirmingRemove ? " is-confirming" : ""}`}
                disabled={isPending}
                onClick={removeFromLibrary}
              >
                <Trash2 aria-hidden="true" />
                {confirmingRemove ? "Confirm remove" : "Remove source"}
              </button>
            </div>
            <div className="builder-edit-dialog-footer-actions">
              <button
                type="button"
                className="fb-btn light compact"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="fb-btn dark compact"
                disabled={isPending}
              >
                {isPending ? "Saving" : "Save changes"}
              </button>
            </div>
          </footer>
        </form>
      </dialog>
    </>
  );
}
