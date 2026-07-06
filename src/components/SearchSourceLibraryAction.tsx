"use client";

import { useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";
import type { DetectedSourceId } from "@/lib/source-value-detect";

type LibraryStatus = "in_library" | "not_in_library";

type AddSourcePayload = {
  builder?: BuilderLibraryEventItem;
  error?: string;
  needsConfirmation?: boolean;
  suggestId?: DetectedSourceId;
  warning?: string;
};

const switchSourceTypePrompt = " Switch source type?";

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
  const [suggestedSourceType, setSuggestedSourceType] = useState<DetectedSourceId | null>(null);
  const [activeSourceType, setActiveSourceType] = useState(sourceType ?? "website");
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

  function submitAdd({
    sourceTypeOverride,
  }: {
    sourceTypeOverride?: DetectedSourceId;
  } = {}) {
    if (isPending || !sourceValue) return;
    const sourceTypeToSubmit = sourceTypeOverride ?? activeSourceType;
    setMessage(null);
    setSuggestedSourceType(null);
    setActiveSourceType(sourceTypeToSubmit);

    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/personal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: sourceName,
            sourceType: sourceTypeToSubmit,
            sourceValue,
            ...(pendingConfirmation ? { confirmedWarning: true } : {}),
          }),
        });
        const payload = (await response.json().catch(() => null)) as AddSourcePayload | null;

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
          if (payload?.suggestId) {
            setSuggestedSourceType(payload.suggestId);
            setMessage(messageWithoutSwitchPrompt(payload.error ?? "Could not add source."));
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
        onClick={() => submitAdd()}
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
          {!pendingConfirmation && suggestedSourceType ? (
            <>
              {" "}
              <button
                className="add-source-text-action is-error"
                disabled={isPending}
                onClick={() => submitAdd({ sourceTypeOverride: suggestedSourceType })}
                type="button"
              >
                Switch source type
              </button>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function messageWithoutSwitchPrompt(value: string) {
  return value.endsWith(switchSourceTypePrompt)
    ? value.slice(0, -switchSourceTypePrompt.length).trimEnd()
    : value;
}
