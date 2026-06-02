"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";

type DigestPipelineTitleEditorProps = {
  headingId: string;
  initialTitle: string;
};

export function DigestPipelineTitleEditor({
  headingId,
  initialTitle,
}: DigestPipelineTitleEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      setError("Digest name cannot be empty.");
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

        if (!response.ok) throw new Error("Unable to rename digest");

        setTitle(nextTitle);
        setDraft(nextTitle);
        setEditing(false);
        router.refresh();
      } catch {
        setError("Could not rename digest.");
      }
    });
  }

  if (editing) {
    return (
      <form className="digest-title-edit-form" onSubmit={saveTitle}>
        <label className="sr-only" htmlFor="digest-title-input">
          Digest name
        </label>
        <input
          autoFocus
          className="digest-title-edit-input"
          disabled={isPending}
          id="digest-title-input"
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <button
          aria-busy={isPending}
          aria-label="Save digest name"
          className="fb-btn dark compact"
          disabled={isPending}
          type="submit"
        >
          <Check aria-hidden="true" />
        </button>
        <button
          aria-label="Cancel digest name edit"
          className="fb-btn ghost compact"
          disabled={isPending}
          onClick={cancelEditing}
          type="button"
        >
          <X aria-hidden="true" />
        </button>
        {error ? (
          <span className="digest-title-edit-error" role="status">
            {error}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <div className="digest-title-row">
      <h2 id={headingId} className="fb-section-heading">
        {title}
      </h2>
      <button
        aria-label="Edit digest name"
        className="fb-btn ghost compact digest-title-edit-button"
        onClick={startEditing}
        type="button"
      >
        <Pencil aria-hidden="true" />
      </button>
    </div>
  );
}
