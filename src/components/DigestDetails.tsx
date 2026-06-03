"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { DigestContent, type DigestSourceLink } from "@/components/DigestContent";
import { useHydrated } from "@/components/ThemeToggle";

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
  status: "idle" | "loading" | "loaded" | "error";
};

export function DigestDetails({
  defaultOpen = false,
  digest,
  mode = "archive",
  sourceLinks = [],
}: {
  defaultOpen?: boolean;
  digest: DigestSummary;
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
      status: initialStatus,
    }),
    [defaultOpen, initialStatus, stateKey],
  );
  const [digestState, setDigestState] = useState<DigestLoadState>(initialState);
  const currentState = digestState.key === stateKey ? digestState : initialState;
  const { content, isOpen, status } = currentState;
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
          <div className="fb-digest-title-row">
            <div className="min-w-0">
              <div className="fb-digest-title">{digest.title}</div>
              <div className="fb-digest-sub">
                <span>{digest.itemCount} items</span>
              </div>
            </div>
            <span className="fb-digest-chip">{formatDateTime(digest.createdAt, hydrated)}</span>
          </div>
          {headerHeadline ? (
            <DigestHeadlineSummary text={headerHeadline} />
          ) : status === "loading" ? (
            <DigestHeadlineSummary loading />
          ) : null}
        </div>
        <div className="fb-digest-body">
          <DigestBody content={content} sourceLinks={sourceLinks} status={status} variant="today" />
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
              <span>
                {digest.itemCount} items · {digest.language}
              </span>
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
        <DigestBody content={content} sourceLinks={sourceLinks} status={status} />
      </details>
    </article>
  );
}

function DigestBody({
  content,
  sourceLinks,
  status,
  variant = "archive",
}: {
  content: string | null;
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
            ? "fb-digest-chip inline-flex items-center gap-1.5"
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
        <div className="text-sm text-[var(--danger)]" aria-live="polite">
          {errorNode}
        </div>
      );
    }

    return (
      <div
        className="item-details text-sm text-[var(--danger)]"
        aria-live="polite"
      >
        {errorNode}
      </div>
    );
  }

  if (isToday) {
    return <DigestContent content={content ?? ""} sourceLinks={sourceLinks} tone="paper" />;
  }
  return (
    <div className="item-details">
      <DigestContent content={content ?? ""} sourceLinks={sourceLinks} tone="paper" />
    </div>
  );
}

function DigestHeadlineSummary({
  loading = false,
  text,
}: {
  loading?: boolean;
  text?: string;
}) {
  return (
    <section
      className={`digest-headline-summary${loading ? " is-loading" : ""}`}
      aria-busy={loading || undefined}
      aria-label="Digest headlines"
    >
      <div className="digest-headline-kicker">Headlines</div>
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

function digestPreviewFromContent(content: string) {
  const text = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^#{1,6}\s+/.test(line)) return false;
      if (/^AI Digest\b/i.test(line)) return false;
      if (/^(原文|source|link)[:：]/i.test(line)) return false;
      if (/^https?:\/\//i.test(line)) return false;
      return true;
    })
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  return text.length > 300 ? `${text.slice(0, 297).trimEnd()}...` : text;
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
