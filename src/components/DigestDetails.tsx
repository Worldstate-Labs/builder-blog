"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { DigestContent, type DigestSourceLink } from "@/components/DigestContent";
import { useHydrated } from "@/components/ThemeToggle";
import { digestPreviewFromContent } from "@/lib/digest-headline";
import { displayLanguagePreference } from "@/lib/language-preference";

export type DigestSummary = {
  id: string;
  title: string;
  headlineSummary: string | null;
  itemCount: number;
  language: string;
  createdAt: string;
};

type DigestLoadState = {
  content: string | null;
  isOpen: boolean;
  key: string;
  originalSummariesByUrl: Record<string, string>;
  status: "idle" | "loading" | "loaded" | "error";
};

export function DigestDetails({
  defaultOpen = false,
  digest,
  headerAction,
  isLatest = false,
  mode = "archive",
  sourceLinks = [],
}: {
  defaultOpen?: boolean;
  digest: DigestSummary;
  headerAction?: ReactNode;
  isLatest?: boolean;
  mode?: "archive" | "today";
  sourceLinks?: DigestSourceLink[];
}) {
  const digestId = digest.id;
  const hydrated = useHydrated();
  const stateKey = `${digestId}:${defaultOpen ? "open" : "closed"}:${mode}`;
  const initialStatus = defaultOpen || mode === "today" ? "loading" : "idle";
  const initialState: DigestLoadState = useMemo(
    () => ({
      content: null,
      isOpen: defaultOpen,
      key: stateKey,
      originalSummariesByUrl: {},
      status: initialStatus,
    }),
    [defaultOpen, initialStatus, stateKey],
  );
  const [digestState, setDigestState] = useState<DigestLoadState>(initialState);
  const currentState = digestState.key === stateKey ? digestState : initialState;
  const { content, isOpen, status } = currentState;
  const originalSummariesByUrl = currentState.originalSummariesByUrl;
  const headerHeadline = resolveHeadlineSummary(digest.headlineSummary, content, status);

  const updateDigestState = useCallback((
    updater: (current: DigestLoadState) => Omit<DigestLoadState, "key">,
  ) => {
    setDigestState((current) => {
      const base = current.key === stateKey ? current : initialState;
      return { ...updater(base), key: stateKey };
    });
  }, [initialState, stateKey]);

  const fetchDigest = useCallback(async () => {
    try {
      const response = await fetch(`/api/digests/${digestId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      updateDigestState((current) => ({
        ...current,
        content: String(body.content ?? ""),
        originalSummariesByUrl: cleanOriginalSummaries(body.originalSummariesByUrl),
        status: "loaded",
      }));
    } catch {
      updateDigestState((current) => ({
        ...current,
        status: "error",
      }));
    }
  }, [digestId, updateDigestState]);

  function loadDigest() {
    if (content || status === "loading") return;
    updateDigestState((current) => ({ ...current, status: "loading" }));
    void fetchDigest();
  }

  useEffect(() => {
    if (defaultOpen || mode === "today") {
      const id = window.setTimeout(() => void fetchDigest(), 0);
      return () => window.clearTimeout(id);
    }
  }, [defaultOpen, fetchDigest, mode]);

  if (mode === "today") {
    return (
      <article className="fb-digest">
        <div className="fb-digest-head">
          {headerHeadline ? (
            <DigestHeadlineSummary headerAction={headerAction} isLatest={isLatest} text={headerHeadline} />
          ) : status === "loading" ? (
            <DigestHeadlineSummary headerAction={headerAction} isLatest={isLatest} loading />
          ) : null}
        </div>
        <div className="fb-digest-body">
          <DigestBody
            content={content}
            originalSummariesByUrl={originalSummariesByUrl}
            sourceLinks={sourceLinks}
            status={status}
            variant="today"
          />
        </div>
      </article>
    );
  }

  return (
    <article id={digest.id} className="digest-card digest-card-compact">
      <details
        className="item-disclosure"
        open={isOpen}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          updateDigestState((current) => ({ ...current, isOpen: nextOpen }));
          if (nextOpen) void loadDigest();
        }}
      >
        <summary className="item-summary">
          <span className="min-w-0">
            <span className="item-kicker">
              <span>{formatDateTime(digest.createdAt, hydrated)}</span>
              <CountMeta label={digest.itemCount === 1 ? "item" : "items"} value={digest.itemCount} />
              <span>{displayLanguagePreference(digest.language)}</span>
            </span>
            <span className="item-title">{digest.title}</span>
            {headerHeadline ? (
              <span className="item-headline-preview">{headerHeadline}</span>
            ) : null}
          </span>
          <span className="item-summary-action">
            <BookOpen className="h-3.5 w-3.5" />
            Read
          </span>
        </summary>
        <DigestBody
          content={content}
          originalSummariesByUrl={originalSummariesByUrl}
          sourceLinks={sourceLinks}
          status={status}
        />
      </details>
    </article>
  );
}

function DigestBody({
  content,
  originalSummariesByUrl,
  sourceLinks,
  status,
  variant = "archive",
}: {
  content: string | null;
  originalSummariesByUrl: Record<string, string>;
  sourceLinks: DigestSourceLink[];
  status: "idle" | "loading" | "loaded" | "error";
  variant?: "today" | "archive";
}) {
  const isToday = variant === "today";

  if (status === "loading") {
    const loadingChip = (
      <span
        className={
          isToday
            ? "fb-digest-chip digest-loading-chip"
            : "status-chip"
        }
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading digest
      </span>
    );

    if (isToday) {
      return loadingChip;
    }

    return (
      <div className="item-details" aria-live="polite" aria-busy="true">
        {loadingChip}
      </div>
    );
  }

  if (status === "error") {
    const errorNode = <span>Could not load digest.</span>;
    if (isToday) {
      return (
        <div className="digest-load-error" aria-live="polite">
          {errorNode}
        </div>
      );
    }

    return (
      <div
        className="item-details digest-load-error"
        aria-live="polite"
      >
        {errorNode}
      </div>
    );
  }

  if (isToday) {
    return (
      <DigestContent
        content={content ?? ""}
        originalSummariesByUrl={originalSummariesByUrl}
        showContents={false}
        showSectionCounts
        sourceLinks={sourceLinks}
        tone="paper"
      />
    );
  }
  return (
    <div className="item-details">
      <DigestContent
        content={content ?? ""}
        originalSummariesByUrl={originalSummariesByUrl}
        sourceLinks={sourceLinks}
        tone="paper"
      />
    </div>
  );
}

function DigestHeadlineSummary({
  headerAction,
  isLatest = false,
  loading = false,
  text,
}: {
  headerAction?: ReactNode;
  isLatest?: boolean;
  loading?: boolean;
  text?: string;
}) {
  return (
    <section
      className={`digest-headline-summary${loading ? " is-loading" : ""}`}
      aria-busy={loading || undefined}
      aria-label="Digest headlines"
    >
      <div className="digest-headline-top">
        <div className="digest-headline-label-row">
          <div className="digest-headline-kicker">Headlines</div>
          {isLatest ? <span className="digest-latest-mark">Latest</span> : null}
        </div>
        {headerAction ? <div className="digest-headline-action">{headerAction}</div> : null}
      </div>
      {loading ? (
        <div className="digest-headline-loading" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : (
        <p className="digest-headline-text">{text}</p>
      )}
    </section>
  );
}

function resolveHeadlineSummary(
  headlineSummary: string | null,
  content: string | null,
  status: DigestLoadState["status"],
) {
  const stored = headlineSummary?.trim();
  if (stored) return stored;
  if (status !== "loaded" || !content?.trim()) return null;
  return digestPreviewFromContent(content);
}

function cleanOriginalSummaries(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([url, summary]) => [url, typeof summary === "string" ? summary.trim() : ""] as const)
    .filter(([url, summary]) => url.length > 0 && summary.length > 0);
  return Object.fromEntries(entries);
}

function formatDateTime(value: string, hydrated: boolean) {
  if (hydrated) return new Date(value).toLocaleString();
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}
