"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { SourceAvatar } from "@/components/SourceAvatar";
import { SourceCandidateList } from "@/components/SourceCandidateList";
import type { BuilderLibraryEventItem } from "@/lib/builder-library-events";
import { sourceLabelForType } from "@/lib/source-display";
import {
  FIXED_SOURCE_VALUE_BY_ID,
  placeholderForSourceId,
} from "@/lib/source-inputs";
import {
  type SourceCandidate,
  sourceCandidateMatches,
  sourceCandidateValue,
} from "@/lib/source-candidates";
import {
  crossTypeWarning,
  detectSourceTypeFromValue,
  isLikelyEpisodeOrPostUrl,
  podcastHostnameRejection,
  type DetectedSourceId,
} from "@/lib/source-value-detect";

type SourceOption = { id: string; label: string };

type Preview =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "warn"; message: string; suggestId?: DetectedSourceId };

type SaveOptions = {
  confirmedWarning?: boolean;
  confirmedClearFetchedPosts?: boolean;
};

type PendingConfirmation =
  | { kind: "warning"; warning: string }
  | {
      kind: "clearFetchedPosts";
      warning: string;
      feedItemCount: number;
      confirmedWarning?: boolean;
    };

function computePreview(sourceType: string, value: string): Preview {
  if (FIXED_SOURCE_VALUE_BY_ID[sourceType]) return { kind: "idle" };
  const trimmed = value.trim();
  if (!trimmed) return { kind: "idle" };

  if (sourceType === "podcast") {
    const rejection = podcastHostnameRejection(trimmed);
    if (rejection) return { kind: "error", message: rejection };
  }
  const singleItem = isLikelyEpisodeOrPostUrl(sourceType, trimmed);
  if (singleItem) return { kind: "error", message: singleItem };

  const crossType = crossTypeWarning(sourceType, trimmed);
  if (crossType) {
    return {
      kind: "warn",
      message: crossType.message,
      suggestId: crossType.suggestId,
    };
  }
  return { kind: "idle" };
}

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
  sourceCandidates,
  sourceOptions,
}: {
  builder: BuilderLibraryEventItem;
  onRemoveStateChange?: (builderId: string, removed: boolean) => void;
  sourceCandidates: SourceCandidate[];
  sourceOptions: SourceOption[];
}) {
  const router = useRouter();
  const sourceCandidateListId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastAutoSwitchedValueRef = useRef("");
  const [open, setOpen] = useState(false);

  const initialSourceValue =
    builder.handle && builder.sourceType === "x"
      ? `@${builder.handle}`
      : (builder.sourceUrl ?? builder.handle ?? "");

  const [name, setName] = useState(builder.name);
  const [sourceType, setSourceType] = useState(builder.sourceType);
  const [sourceValue, setSourceValue] = useState(initialSourceValue);
  const [selectedCandidate, setSelectedCandidate] = useState<SourceCandidate | null>(null);
  const [sourceCandidatesOpen, setSourceCandidatesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSuggestId, setErrorSuggestId] = useState<DetectedSourceId | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isPending, startTransition] = useTransition();
  const resolvedSourceValue = FIXED_SOURCE_VALUE_BY_ID[sourceType] ?? sourceValue;
  const sourceValueIsFixed = Boolean(FIXED_SOURCE_VALUE_BY_ID[sourceType]);
  const sourceOptionIds = useMemo(
    () => new Set(sourceOptions.map((source) => source.id)),
    [sourceOptions],
  );
  const sourceFeedbackId = `edit-builder-${builder.id}-source-feedback`;
  const sourcePreviewId = `edit-builder-${builder.id}-source-preview`;
  const preview = useMemo(
    () => computePreview(sourceType, resolvedSourceValue),
    [sourceType, resolvedSourceValue],
  );
  const sourceDescriptionIds = [
    preview.kind !== "idle" ? sourcePreviewId : null,
    error || pendingConfirmation || warning ? sourceFeedbackId : null,
  ]
    .filter(Boolean)
    .join(" ");
  const sourceCandidateSuggestions = useMemo(
    () =>
      sourceCandidatesOpen && !sourceValueIsFixed
        ? sourceCandidates
            .filter((candidate) => sourceCandidateMatches(candidate, resolvedSourceValue))
            .slice(0, 6)
        : [],
    [resolvedSourceValue, sourceCandidates, sourceCandidatesOpen, sourceValueIsFixed],
  );
  const editingOriginalSource =
    sourceType === builder.sourceType && resolvedSourceValue === initialSourceValue;
  const displayNameAvatarSource = selectedCandidate ?? {
    avatarDataUrl: editingOriginalSource ? builder.avatarDataUrl : null,
    avatarUrl: editingOriginalSource ? builder.avatarUrl : null,
    fetchUrl: editingOriginalSource ? builder.fetchUrl : null,
    name: name || sourceLabelForType(sourceType),
    sourceType,
    sourceUrl: sourceUrlFromInput(resolvedSourceValue),
  };

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

  useEffect(() => {
    const id = window.setTimeout(
      () => {
        const value = resolvedSourceValue.trim();
        if (!open || !value || sourceValueIsFixed) return;
        if (lastAutoSwitchedValueRef.current === value) return;
        const detected = formSourceTypeForValue(value, sourceOptionIds);
        if (!detected) return;

        lastAutoSwitchedValueRef.current = value;
        if (detected === sourceType) return;
        setSourceType(detected);
        setError(null);
        setErrorSuggestId(null);
        setWarning(null);
        setPendingConfirmation(null);
      },
      resolvedSourceValue ? 200 : 0,
    );
    return () => window.clearTimeout(id);
  }, [open, resolvedSourceValue, sourceOptionIds, sourceType, sourceValueIsFixed]);

  function openDialog() {
    // Reset form to the latest props on open so re-opening always
    // shows the canonical current values, not stale draft state.
    setName(builder.name);
    setSourceType(builder.sourceType);
    setSourceValue(initialSourceValue);
    setSelectedCandidate(null);
    setSourceCandidatesOpen(false);
    setError(null);
    setErrorSuggestId(null);
    setWarning(null);
    setPendingConfirmation(null);
    setConfirmingRemove(false);
    lastAutoSwitchedValueRef.current = "";
    setOpen(true);
  }

  function applySuggestion(target: DetectedSourceId) {
    setSourceType(target);
    setSelectedCandidate(null);
    setError(null);
    setErrorSuggestId(null);
    setWarning(null);
    setPendingConfirmation(null);
  }

  function applySourceCandidate(candidate: SourceCandidate) {
    setSelectedCandidate(candidate);
    setSourceType(candidate.sourceType);
    setSourceValue(sourceCandidateValue(candidate));
    setName(candidate.name);
    setSourceCandidatesOpen(false);
    clearSourceFeedback();
    lastAutoSwitchedValueRef.current = sourceCandidateValue(candidate).trim();
  }

  function clearSourceFeedback() {
    setError(null);
    setErrorSuggestId(null);
    setWarning(null);
    setPendingConfirmation(null);
  }

  function save(options: SaveOptions = {}) {
    setError(null);
    setErrorSuggestId(null);
    setWarning(null);
    if (!resolvedSourceValue.trim()) {
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
            ...(options.confirmedWarning ? { confirmedWarning: true } : {}),
            ...(options.confirmedClearFetchedPosts
              ? { confirmedClearFetchedPosts: true }
              : {}),
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          warning?: string;
          needsConfirmation?: boolean;
          needsClearFetchedPostsConfirmation?: boolean;
          feedItemCount?: number;
          suggestId?: DetectedSourceId;
        } | null;
        if (response.status === 409 && body?.needsConfirmation) {
          setPendingConfirmation({
            kind: "warning",
            warning: body.warning ?? "Review this source before saving it.",
          });
          return;
        }
        if (response.status === 409 && body?.needsClearFetchedPostsConfirmation) {
          setPendingConfirmation({
            kind: "clearFetchedPosts",
            warning:
              body.warning ??
              "Changing this source URL will clear fetched posts for this source.",
            feedItemCount: body.feedItemCount ?? builder.feedItemCount,
            ...(options.confirmedWarning ? { confirmedWarning: true } : {}),
          });
          return;
        }
        if (!response.ok) {
          setError(body?.error ?? "Could not save source.");
          setErrorSuggestId(body?.suggestId ?? null);
          return;
        }
        if (body?.warning) setWarning(body.warning);
        setOpen(false);
        // Server-fetched data on /builders is now stale — refresh
        // every route's RSC payload so the row picks up the new
        // name, sourceType, sourceUrl, etc.
        router.refresh();
      } catch {
        setError("Could not save source.");
      }
    });
  }

  function removeFromLibrary() {
    if (isPending) return;
    if (!confirmingRemove) {
      setError(null);
      setWarning(null);
      setPendingConfirmation(null);
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
          </header>

          <div className="builder-edit-dialog-body">
            <label className="builder-edit-dialog-field">
              <span className="builder-edit-dialog-field-label">Source type</span>
              <select
                className="fb-input"
                value={sourceType}
                onChange={(e) => {
                  setSourceType(e.target.value);
                  setSelectedCandidate(null);
                  clearSourceFeedback();
                }}
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
              <div className="source-url-combobox">
                <input
                  aria-autocomplete="list"
                  aria-controls={
                    sourceCandidateSuggestions.length > 0
                      ? sourceCandidateListId
                      : undefined
                  }
                  aria-describedby={sourceDescriptionIds || undefined}
                  aria-expanded={sourceCandidateSuggestions.length > 0}
                  aria-invalid={error ? "true" : undefined}
                  aria-readonly={sourceValueIsFixed}
                  autoComplete="off"
                  autoCorrect="off"
                  className="fb-input mono"
                  onBlur={() => window.setTimeout(() => setSourceCandidatesOpen(false), 120)}
                  onChange={(e) => {
                    if (sourceValueIsFixed) return;
                    setSourceValue(e.target.value);
                    setSelectedCandidate(null);
                    setSourceCandidatesOpen(true);
                    clearSourceFeedback();
                  }}
                  onFocus={() => setSourceCandidatesOpen(true)}
                  placeholder={placeholderForSourceId(sourceType)}
                  readOnly={sourceValueIsFixed}
                  required
                  role="combobox"
                  spellCheck={false}
                  value={resolvedSourceValue}
                />
                <SourceCandidateList
                  candidates={sourceCandidateSuggestions}
                  id={sourceCandidateListId}
                  onSelect={applySourceCandidate}
                />
              </div>
            </label>

            {preview.kind !== "idle" ? (
              <div
                id={sourcePreviewId}
                aria-live="polite"
                className={`add-source-inline-note ${
                  preview.kind === "error" ? "is-error" : "is-warning"
                }`}
              >
                {preview.message}
                {preview.kind === "warn" && preview.suggestId ? (
                  <>
                    {" "}
                    <button
                      className="add-source-text-action"
                      onClick={() => preview.suggestId && applySuggestion(preview.suggestId)}
                      type="button"
                    >
                      Switch source type
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            <label className="builder-edit-dialog-field">
              <span className="builder-edit-dialog-field-label">
                Display name (optional)
              </span>
              <div className="source-display-name-control">
                <SourceAvatar
                  className="source-display-name-avatar"
                  imageSize={28}
                  source={displayNameAvatarSource}
                />
                <input
                  className="fb-input"
                  onChange={(e) => {
                    setName(e.target.value);
                    setWarning(null);
                  }}
                  placeholder="Use detected name if blank"
                  value={name}
                />
              </div>
            </label>

            {error ? (
              <span
                id={sourceFeedbackId}
                className="builder-edit-dialog-message is-error"
                role="alert"
              >
                {error}
                {errorSuggestId ? (
                  <>
                    {" "}
                    <button
                      className="add-source-text-action is-error"
                      onClick={() => applySuggestion(errorSuggestId)}
                      type="button"
                    >
                      Switch source type
                    </button>
                  </>
                ) : null}
              </span>
            ) : pendingConfirmation ? (
              <div
                id={sourceFeedbackId}
                aria-live="polite"
                role="status"
                className="add-source-callout"
              >
                <div className="add-source-callout-copy">
                  <span className="add-source-callout-label">Confirm</span>
                  <span className="add-source-callout-body">
                    {pendingConfirmation.warning}
                  </span>
                </div>
                <div className="add-source-callout-actions">
                  <button
                    type="button"
                    className="fb-btn dark compact"
                    disabled={isPending}
                    onClick={() =>
                      pendingConfirmation.kind === "clearFetchedPosts"
                        ? save({
                            confirmedWarning: pendingConfirmation.confirmedWarning,
                            confirmedClearFetchedPosts: true,
                          })
                        : save({ confirmedWarning: true })
                    }
                  >
                    {isPending
                      ? "Saving"
                      : pendingConfirmation.kind === "clearFetchedPosts"
                        ? "Clear posts and save"
                        : "Save anyway"}
                  </button>
                  <button
                    type="button"
                    className="fb-btn compact"
                    disabled={isPending}
                    onClick={() => setPendingConfirmation(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
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
                {confirmingRemove ? "Confirm removal" : "Remove source"}
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
                disabled={isPending || Boolean(pendingConfirmation)}
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

function sourceUrlFromInput(value: string) {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function formSourceTypeForValue(
  value: string,
  sourceOptionIds: ReadonlySet<string>,
) {
  const detected = detectSourceTypeFromValue(value);
  if (!detected) return null;
  return sourceOptionIds.has(detected) ? detected : null;
}
