"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";

type DigestPipelineTitleEditorProps = {
  className?: string;
  headingId: string;
  headingLevel?: 2 | 3;
  initialTitle: string;
};

export function DigestPipelineTitleEditor({
  className = "fb-section-heading",
  headingId,
  headingLevel = 2,
  initialTitle,
}: DigestPipelineTitleEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = `${headingId}-input`;
  const errorId = `${headingId}-error`;

  function startEditing() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(title);
    setError(null);
    setEditing(false);
  }

  function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const nextTitle = draft.trim();
    if (!nextTitle) {
      setError("Enter an AI Brief collection name.");
      return;
    }
    if (nextTitle === title) {
      setEditing(false);
      setError(null);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/digest-pipelines/share", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        });

        if (!response.ok) throw new Error("Could not save AI Brief collection name.");

        setTitle(nextTitle);
        setDraft(nextTitle);
        setEditing(false);
        router.refresh();
      } catch {
        setError("Could not save AI Brief collection name.");
      }
    });
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelEditing();
  }

  if (editing) {
    return (
      <form className="digest-title-edit-form" onSubmit={saveTitle}>
        <label className="sr-only" htmlFor={inputId}>
          AI Brief collection name
        </label>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? "true" : undefined}
          autoFocus
          className="digest-title-edit-input"
          disabled={isPending}
          id={inputId}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleInputKeyDown}
          value={draft}
        />
        <button
          aria-busy={isPending}
          aria-label="Save AI Brief collection name"
          className="fb-btn dark compact digest-title-icon-button"
          disabled={isPending}
          type="submit"
        >
          <Check aria-hidden="true" />
          <span className="fb-icon-tooltip" aria-hidden="true">
            Save
          </span>
        </button>
        <button
          aria-label="Cancel AI Brief collection name edit"
          className="fb-btn ghost compact digest-title-icon-button"
          disabled={isPending}
          onClick={cancelEditing}
          type="button"
        >
          <X aria-hidden="true" />
          <span className="fb-icon-tooltip" aria-hidden="true">
            Cancel
          </span>
        </button>
        {error ? (
          <span className="digest-title-edit-error" id={errorId} role="status">
            {error}
          </span>
        ) : null}
      </form>
    );
  }

  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div className="digest-title-row">
      <Heading id={headingId} className={className}>
        {title}
      </Heading>
      <button
        aria-label="Edit AI Brief collection name"
        className="fb-btn ghost compact digest-title-edit-button digest-title-icon-button"
        onClick={startEditing}
        type="button"
      >
        <Pencil aria-hidden="true" />
        <span className="fb-icon-tooltip" aria-hidden="true">
          Edit
        </span>
      </button>
    </div>
  );
}
