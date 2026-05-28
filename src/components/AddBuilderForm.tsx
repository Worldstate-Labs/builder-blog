"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

const ERROR_SUGGEST_SEP = "__SUGGEST__";

function splitTaggedError(error: string): {
  errorMessage: string;
  errorSuggestId: DetectedSourceId | null;
} {
  if (!error) return { errorMessage: "", errorSuggestId: null };
  const idx = error.indexOf(ERROR_SUGGEST_SEP);
  if (idx < 0) return { errorMessage: error, errorSuggestId: null };
  return {
    errorMessage: error.slice(0, idx),
    errorSuggestId: error.slice(idx + ERROR_SUGGEST_SEP.length) as DetectedSourceId,
  };
}
import { Plus } from "lucide-react";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";
import {
  crossTypeWarning,
  isLikelyEpisodeOrPostUrl,
  podcastHostnameRejection,
  type DetectedSourceId,
} from "@/lib/source-value-detect";

type SourceOption = {
  id: string;
  label: string;
};

// Per-source-type placeholder hint for the URL/handle field. Keys
// mirror the sourceId values seeded from config/sources.json.
const PLACEHOLDER_BY_SOURCE_ID: Record<string, string> = {
  x: "@deepmind or https://x.com/deepmind",
  blog: "https://example.com/blog or https://example.com/feed.xml",
  youtube: "https://youtube.com/@deepmind",
  podcast: "https://podcasts.apple.com/…/id123 or https://feeds.example.com/show.rss",
  pdf: "https://example.com/paper.pdf",
  website: "https://example.com",
};

function placeholderForSourceId(sourceId: string): string {
  return PLACEHOLDER_BY_SOURCE_ID[sourceId] ?? "@handle or https://example.com/feed";
}

// Inline preview computed entirely on the client — no network. Mirrors
// the hard checks the server-side resolver will run, so the user gets
// the same verdict before pressing Submit. The server is still the
// source of truth (Apple iTunes lookup, SSRF, dedup, etc.).
type Preview =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "warn"; message: string; suggestId?: DetectedSourceId };

function computePreview(sourceType: string, value: string): Preview {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "idle" };

  // Hard rejections come first so they win over generic cross-type hints.
  if (sourceType === "podcast") {
    const rej = podcastHostnameRejection(trimmed);
    if (rej) return { kind: "error", message: rej };
  }
  const single = isLikelyEpisodeOrPostUrl(sourceType, trimmed);
  if (single) return { kind: "error", message: single };

  const cross = crossTypeWarning(sourceType, trimmed);
  if (cross) {
    return { kind: "warn", message: cross.message, suggestId: cross.suggestId };
  }
  return { kind: "idle" };
}

export function AddBuilderForm({ sourceOptions }: { sourceOptions: SourceOption[] }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const [sourceType, setSourceType] = useState<string>(sourceOptions[0]?.id ?? "x");
  const [sourceValue, setSourceValue] = useState("");

  // Debounce the inline preview so a fast typer doesn't see the banner
  // strobing on every keystroke. 200ms is short enough to feel immediate
  // on paste, long enough to skip mid-word noise. Empty input flushes
  // immediately so clearing the field hides any stale banner.
  const [debouncedValue, setDebouncedValue] = useState(sourceValue);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedValue(sourceValue), sourceValue ? 200 : 0);
    return () => window.clearTimeout(id);
  }, [sourceValue]);

  const preview = useMemo(
    () => computePreview(sourceType, debouncedValue),
    [sourceType, debouncedValue],
  );

  function applySuggestion(target: DetectedSourceId) {
    setSourceType(target);
    setError("");
  }

  function addBuilder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError("");
    setStatus("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/personal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(formData.get("name") ?? ""),
            sourceType: String(formData.get("sourceType") ?? "x"),
            sourceValue: String(formData.get("sourceValue") ?? ""),
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          builder?: BuilderLibraryEventItem;
          error?: string;
          warning?: string;
          suggestId?: DetectedSourceId;
        } | null;
        if (!response.ok) {
          // Surface the server's specific reason verbatim. Falls back to
          // a generic message only if the response had no body at all.
          if (payload?.suggestId) {
            // Stash the suggestion alongside the message so the click
            // handler below can apply it.
            setError(
              `${payload.error ?? "Could not add source"}${ERROR_SUGGEST_SEP}${payload.suggestId}`,
            );
          } else {
            setError(payload?.error ?? "Could not add source");
          }
          return;
        }
        if (!payload?.builder) throw new Error("Missing source");
        window.dispatchEvent(
          new CustomEvent<BuilderLibraryEventItem>(builderLibraryBuilderAdded, {
            detail: payload.builder,
          }),
        );
        form.reset();
        setSourceValue("");
        setStatus(payload.warning ? `Added — ${payload.warning}` : "Source added.");
      } catch {
        setError("Could not add source.");
      }
    });
  }

  // Split a possibly-tagged error message back into (message, suggestId).
  // Cheap string scan; no need to memoize.
  const { errorMessage, errorSuggestId } = splitTaggedError(error);

  return (
    <form className="grid gap-2" onSubmit={addBuilder}>
      <div className="grid items-center gap-2 sm:grid-cols-[11rem_1fr_auto]">
        <select
          aria-label="Source type"
          className="fb-input"
          name="sourceType"
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value)}
        >
          {sourceOptions.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Handle or URL"
          className="fb-input"
          name="sourceValue"
          placeholder={placeholderForSourceId(sourceType)}
          value={sourceValue}
          onChange={(event) => setSourceValue(event.target.value)}
          required
        />
        <button
          className="fb-btn dark w-full justify-center sm:w-auto"
          disabled={isPending}
          type="submit"
        >
          <Plus aria-hidden="true" />
          {isPending ? "Adding..." : "Add source"}
        </button>
      </div>
      {preview.kind !== "idle" ? (
        <div
          aria-live="polite"
          className="text-[11.5px]"
          style={{
            color:
              preview.kind === "error" ? "var(--danger)" : "var(--warm, var(--muted-strong))",
          }}
        >
          {preview.message}
          {preview.kind === "warn" && preview.suggestId ? (
            <>
              {" "}
              <button
                className="underline"
                onClick={() => preview.suggestId && applySuggestion(preview.suggestId)}
                style={{ background: "transparent", color: "inherit" }}
                type="button"
              >
                Switch
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          aria-label="Display name"
          className="fb-input flex-1"
          name="name"
          placeholder="Display name (optional)"
        />
        <span aria-live="polite" className="text-[11.5px]">
          {errorMessage ? (
            <>
              <span className="text-[var(--danger)]">{errorMessage}</span>
              {errorSuggestId ? (
                <>
                  {" "}
                  <button
                    className="underline"
                    onClick={() => errorSuggestId && applySuggestion(errorSuggestId)}
                    style={{ background: "transparent", color: "var(--danger)" }}
                    type="button"
                  >
                    Switch source type
                  </button>
                </>
              ) : null}
            </>
          ) : status ? (
            <span className="text-[var(--success)]">{status}</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
