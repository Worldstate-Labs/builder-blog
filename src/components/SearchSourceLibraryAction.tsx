"use client";

import { useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";

type LibraryStatus = "in_library" | "not_in_library";

export function SearchSourceLibraryAction({
  libraryStatus,
  sourceName,
  sourceType,
  sourceValue,
}: {
  libraryStatus: LibraryStatus;
  sourceName: string;
  sourceType: string | null | undefined;
  sourceValue: string | null | undefined;
}) {
  const [status, setStatus] = useState<LibraryStatus>(libraryStatus);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (status === "in_library") {
    return (
      <span className="search-source-library-status" role="status">
        <Check aria-hidden="true" />
        In library
      </span>
    );
  }

  if (!sourceValue) return null;

  function addSource() {
    if (isPending || !sourceValue) return;
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/personal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: sourceName,
            sourceType: sourceType ?? "website",
            sourceValue,
            ...(pendingConfirmation ? { confirmedWarning: true } : {}),
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          builder?: BuilderLibraryEventItem;
          error?: string;
          needsConfirmation?: boolean;
          warning?: string;
        } | null;

        if (response.status === 409 && payload?.needsConfirmation) {
          setPendingConfirmation(true);
          setMessage(payload.warning ?? "Review this source before adding it.");
          return;
        }

        if (!response.ok) {
          if (response.status === 409 && payload?.error?.toLowerCase().includes("already")) {
            setStatus("in_library");
            return;
          }
          setMessage(payload?.error ?? "Could not add source.");
          return;
        }

        if (payload?.builder) {
          window.dispatchEvent(
            new CustomEvent<BuilderLibraryEventItem>(builderLibraryBuilderAdded, {
              detail: {
                ...payload.builder,
                addWarning: pendingConfirmation ? null : payload.warning ?? null,
              },
            }),
          );
        }
        setPendingConfirmation(false);
        setStatus("in_library");
      } catch {
        setMessage("Could not add source.");
      }
    });
  }

  return (
    <span className="search-source-library-action-wrap">
      <button
        aria-busy={isPending}
        className="fb-btn dark compact search-source-library-action"
        disabled={isPending}
        onClick={addSource}
        type="button"
      >
        <Plus aria-hidden="true" />
        {isPending ? "Adding" : pendingConfirmation ? "Add anyway" : "Add source"}
      </button>
      {message ? (
        <span
          className={`search-source-library-message${
            pendingConfirmation ? " is-warning" : " is-error"
          }`}
          role={pendingConfirmation ? "status" : "alert"}
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}
