"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

type LibraryImportRemoveButtonProps = {
  builderCount: number;
  libraryId: string;
  libraryName: string;
};

export function LibraryImportRemoveButton({
  builderCount,
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
    <div className="inline-flex flex-col items-end gap-1">
      <button
        aria-busy={isPending}
        aria-label={`Remove ${libraryName} from library`}
        className="button-light button-compact button-danger gap-2"
        disabled={isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          removeImport();
        }}
        type="button"
      >
        <Trash2 className="h-4 w-4" />
        {isPending ? "Removing" : `Remove ${builderCount}`}
      </button>
      {error ? (
        <span className="text-xs text-[var(--danger)]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
