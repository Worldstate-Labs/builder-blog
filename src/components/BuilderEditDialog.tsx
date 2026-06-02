"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { BuilderLibraryEventItem } from "@/lib/builder-library-events";

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
  sourceOptions,
}: {
  builder: BuilderLibraryEventItem;
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
  const [isPending, startTransition] = useTransition();

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
    setOpen(true);
  }

  function save() {
    setError(null);
    setWarning(null);
    if (!sourceValue.trim()) {
      setError("URL or @handle is required.");
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
            sourceValue: sourceValue.trim(),
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
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <>
      <button
        aria-label={`Edit ${builder.name}`}
        className="builder-library-edit-button fb-icon-btn fb-icon-btn--xs"
        onClick={openDialog}
        title="Edit source"
        type="button"
      >
        <Pencil aria-hidden="true" className="h-3 w-3" />
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
          className="grid gap-0"
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
              Same three fields as when you added this source. Changes save
              immediately.
            </p>
          </header>

          <div className="grid gap-4" style={{ padding: "1rem 1.125rem" }}>
            <label className="grid gap-1 text-sm">
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

            <label className="grid gap-1 text-sm">
              <span className="builder-edit-dialog-field-label">URL or @handle</span>
              <input
                className="fb-input"
                value={sourceValue}
                onChange={(e) => setSourceValue(e.target.value)}
                placeholder="@handle or https://…"
                required
                style={{ fontFamily: "var(--font-geist-mono)" }}
              />
            </label>

            <label className="grid gap-1 text-sm">
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
                className="text-[12px] text-[var(--danger)]"
                role="alert"
              >
                {error}
              </span>
            ) : warning ? (
              <span
                className="text-[12px] text-[var(--muted-strong)]"
                role="status"
              >
                {warning}
              </span>
            ) : null}
          </div>

          <footer className="builder-edit-dialog-footer">
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
              {isPending ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
