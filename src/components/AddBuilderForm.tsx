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
import { Globe, Plus } from "lucide-react";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";
import { sourceIcons } from "@/lib/source-icons";
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

function deriveDisplayName(sourceType: string, sourceValue: string): string {
  const trimmed = sourceValue.trim();
  if (!trimmed) return "";
  if (sourceType === "x") {
    const m = trimmed.match(/(?:x\.com|twitter\.com)\/@?([A-Za-z0-9_]+)/i);
    if (m) return m[1];
    if (trimmed.startsWith("@")) return trimmed.slice(1);
    if (/^[A-Za-z0-9_]+$/.test(trimmed)) return trimmed;
    return "";
  }
  if (sourceType === "youtube") {
    const handle = trimmed.match(/youtube\.com\/@([A-Za-z0-9_.-]+)/i);
    if (handle) return handle[1];
    const cFmt = trimmed.match(/youtube\.com\/c\/([A-Za-z0-9_.-]+)/i);
    if (cFmt) return cFmt[1];
    const userFmt = trimmed.match(/youtube\.com\/user\/([A-Za-z0-9_.-]+)/i);
    if (userFmt) return userFmt[1];
    return "";
  }
  // blog / website / podcast — don't guess from the URL hostname.
  // "podcasts.apple.com" or "feeds.fireside.fm" are never the source's
  // real name. Leave blank so the server-side enrichment (og:title,
  // iTunes collectionName, etc.) fills in the actual title when the
  // user submits with display name empty.
  return "";
}

export function AddBuilderForm({ sourceOptions }: { sourceOptions: SourceOption[] }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  // Pre-add confirmation: when the server returns a warning flagged
  // as requiresConfirmation (e.g. blog has no RSS feed → agent path),
  // we don't persist yet — we show this inline confirm block instead.
  // The user clicks "Add anyway" to re-submit with confirmedWarning.
  const [pendingConfirmation, setPendingConfirmation] = useState<{ warning: string } | null>(null);
  // Post-add soft warning that doesn't require confirmation (e.g.
  // transient 503, missing OG/title). Rendered as a warm banner.
  const [warning, setWarning] = useState("");
  const [isPending, startTransition] = useTransition();
  const [sourceType, setSourceType] = useState<string>(sourceOptions[0]?.id ?? "x");
  const [sourceValue, setSourceValue] = useState("");
  // Display name auto-derives from sourceType + sourceValue when the
  // user hasn't typed in the field themselves. Once they edit (or
  // even clear the auto-filled value), we stop overwriting it so we
  // don't fight the user's intent.
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

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

  // Derived display name (computed at render-time, not via setState in
  // useEffect — that lint rule fires on cascading-render patterns).
  // The input shows the derived value until the user types in the
  // field, at which point `nameTouched` flips and the typed value
  // wins.
  const derivedName = useMemo(
    () => deriveDisplayName(sourceType, debouncedValue),
    [sourceType, debouncedValue],
  );
  const effectiveName = nameTouched ? name : derivedName;

  function applySuggestion(target: DetectedSourceId) {
    setSourceType(target);
    setError("");
  }

  function submitAdd(confirmedWarning: boolean) {
    if (isPending) return;
    setError("");
    setStatus("");
    setWarning("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/personal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: effectiveName.trim(),
            sourceType,
            sourceValue,
            ...(confirmedWarning ? { confirmedWarning: true } : {}),
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          builder?: BuilderLibraryEventItem;
          error?: string;
          warning?: string;
          needsConfirmation?: boolean;
          suggestId?: DetectedSourceId;
        } | null;
        // 409 with needsConfirmation → show inline confirm prompt; do
        // not treat as a failure or success.
        if (response.status === 409 && payload?.needsConfirmation) {
          setPendingConfirmation({
            warning: payload.warning ?? "This source needs your confirmation before it can be added.",
          });
          return;
        }
        if (!response.ok) {
          if (payload?.suggestId) {
            setError(
              `${payload.error ?? "Could not add source"}${ERROR_SUGGEST_SEP}${payload.suggestId}`,
            );
          } else {
            setError(payload?.error ?? "Could not add source");
          }
          return;
        }
        if (!payload?.builder) throw new Error("Missing source");
        // When the user just came through the confirm flow, they've
        // already acknowledged the warning — don't carry it through
        // to the post-add UI (PrivateLibraryPanel would keep the
        // panel open; the warm banner would re-state what the user
        // just confirmed). The server still echoes payload.warning
        // for diagnostic reasons; we drop it here.
        const surfacedWarning = confirmedWarning ? null : payload.warning ?? null;
        window.dispatchEvent(
          new CustomEvent<BuilderLibraryEventItem>(builderLibraryBuilderAdded, {
            detail: { ...payload.builder, addWarning: surfacedWarning },
          }),
        );
        setSourceValue("");
        setName("");
        setNameTouched(false);
        setPendingConfirmation(null);
        if (surfacedWarning) {
          setWarning(surfacedWarning);
          setStatus("");
        } else {
          setStatus("Source added.");
          setWarning("");
        }
      } catch {
        setError("Could not add source.");
      }
    });
  }

  function addBuilder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitAdd(false);
  }

  // Split a possibly-tagged error message back into (message, suggestId).
  // Cheap string scan; no need to memoize.
  const { errorMessage, errorSuggestId } = splitTaggedError(error);

  return (
    <form className="grid gap-2" onSubmit={addBuilder}>
      <div role="radiogroup" aria-label="Source type" className="flex flex-wrap gap-1.5">
        {sourceOptions.map((source) => {
          const Icon = sourceIcons[source.id] ?? Globe;
          const selected = source.id === sourceType;
          return (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setSourceType(source.id);
                // The pending confirmation was tied to the previous
                // source type — invalidate so the user isn't asked
                // to confirm a different source than the one shown.
                setPendingConfirmation(null);
              }}
              className="source-pick"
              data-selected={selected ? "true" : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{source.label}</span>
            </button>
          );
        })}
      </div>
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
        <input
          aria-label="Handle or URL"
          className="fb-input"
          name="sourceValue"
          placeholder={placeholderForSourceId(sourceType)}
          value={sourceValue}
          onChange={(event) => {
            setSourceValue(event.target.value);
            // Editing the URL invalidates a stale confirm prompt.
            setPendingConfirmation(null);
          }}
          required
        />
        <button
          className="fb-btn dark w-full justify-center sm:w-auto"
          disabled={isPending || Boolean(pendingConfirmation)}
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
          placeholder="Display name (auto-filled from URL — edit to override)"
          value={effectiveName}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
          }}
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
      {pendingConfirmation ? (
        <div
          aria-live="polite"
          role="status"
          className="mt-1 rounded-md border px-3 py-2.5"
          style={{
            borderColor: "var(--warm-line, var(--line))",
            background: "var(--warm-paper, var(--paper-strong))",
            color: "var(--warm-strong, var(--ink))",
          }}
        >
          <div className="flex items-baseline gap-2">
            <span
              style={{
                fontFamily: "var(--font-geist-mono)",
                fontSize: "11px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted-strong)",
              }}
            >
              Confirm
            </span>
            <span className="text-[12.5px] leading-5">{pendingConfirmation.warning}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="fb-btn dark compact"
              disabled={isPending}
              onClick={() => submitAdd(true)}
            >
              {isPending ? "Adding..." : "Add anyway"}
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
      ) : null}
      {warning ? (
        <div
          aria-live="polite"
          role="status"
          className="mt-1 rounded-md border px-3 py-2 text-[12.5px] leading-5"
          style={{
            borderColor: "var(--warm-line, var(--line))",
            background: "var(--warm-paper, var(--paper-strong))",
            color: "var(--warm-strong, var(--ink))",
          }}
        >
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: "0.5rem", color: "var(--muted-strong)" }}>
            Heads up
          </span>
          {warning}
        </div>
      ) : null}
    </form>
  );
}
