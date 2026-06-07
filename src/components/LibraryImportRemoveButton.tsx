"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

type LibraryImportRemoveButtonProps = {
  libraryId: string;
  libraryName: string;
};

export function LibraryImportRemoveButton({
  libraryId,
  libraryName,
}: LibraryImportRemoveButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (removed) return null;

  function removeImport() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/imports", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId }),
        });
        if (!response.ok) throw new Error("Unable to remove library import");
        setRemoved(true);
        router.refresh();
      } catch {
        setError("Could not remove imported library.");
      }
    });
  }

  return (
    <div className="import-remove-control">
      <button
        aria-busy={isPending}
        aria-label={`Remove ${libraryName} from library`}
        className="fb-btn light compact import-remove-button"
        disabled={isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          removeImport();
        }}
        type="button"
      >
        <Trash2 className="import-remove-icon" />
        {isPending ? "Removing" : "Remove library"}
      </button>
      {error ? (
        <span className="import-remove-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
