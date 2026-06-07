"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
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
      setError("AI Digest name cannot be empty.");
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

        if (!response.ok) throw new Error("Unable to rename AI Digest");

        setTitle(nextTitle);
        setDraft(nextTitle);
        setEditing(false);
        router.refresh();
      } catch {
        setError("Could not rename AI Digest.");
      }
    });
  }

  if (editing) {
    return (
      <form className="digest-title-edit-form" onSubmit={saveTitle}>
        <label className="sr-only" htmlFor={`${headingId}-input`}>
          AI Digest name
        </label>
        <input
          autoFocus
          className="digest-title-edit-input"
          disabled={isPending}
          id={`${headingId}-input`}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <button
          aria-busy={isPending}
          aria-label="Save AI Digest name"
          className="fb-btn dark compact"
          disabled={isPending}
          type="submit"
        >
          <Check aria-hidden="true" />
        </button>
        <button
          aria-label="Cancel AI Digest name edit"
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

  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div className="digest-title-row">
      <Heading id={headingId} className={className}>
        {title}
      </Heading>
      <button
        aria-label="Edit AI Digest name"
        className="fb-btn ghost compact digest-title-edit-button"
        onClick={startEditing}
        type="button"
      >
        <Pencil aria-hidden="true" />
      </button>
    </div>
  );
}
