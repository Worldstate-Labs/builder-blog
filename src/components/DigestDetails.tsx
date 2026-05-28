"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { useHydrated } from "@/components/ThemeToggle";

export type DigestSummary = {
  id: string;
  title: string;
  itemCount: number;
  language: string;
  createdAt: string;
};

export function DigestDetails({
  defaultOpen = false,
  digest,
  mode = "archive",
}: {
  defaultOpen?: boolean;
  digest: DigestSummary;
  mode?: "archive" | "today";
}) {
  const digestId = digest.id;
  const hydrated = useHydrated();
  const [content, setContent] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    defaultOpen || mode === "today" ? "loading" : "idle",
  );

  async function fetchDigest() {
    try {
      const response = await fetch(`/api/digests/${digestId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setContent(String(body.content ?? ""));
      setStatus("loaded");
    } catch {
      setStatus("error");
    }
  }

  function loadDigest() {
    if (content || status === "loading") return;
    setStatus("loading");
    void fetchDigest();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (defaultOpen || mode === "today") void fetchDigest();
    // Loading on mount is intentionally tied to the initial open mode only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === "today") {
    return (
      <article className="fb-digest">
        <div className="fb-digest-head">
          <div className="min-w-0">
            <div className="fb-digest-title">{digest.title}</div>
            <div className="fb-digest-sub">
              <span>{digest.itemCount} items</span>
              <span className="opacity-40">·</span>
              <span>{formatDate(digest.createdAt, hydrated)}</span>
            </div>
          </div>
          <span className="fb-digest-chip">
            <span
              aria-hidden="true"
              className="block h-2 w-2 rounded-full bg-[color:var(--signal)]"
            />
            Today
          </span>
        </div>
        <div className="fb-digest-body">
          <DigestBody content={content} status={status} variant="today" />
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
          setIsOpen(nextOpen);
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
          </span>
          <span className="item-summary-action">
            <BookOpen className="h-3.5 w-3.5" />
            Read
          </span>
        </summary>
        <DigestBody content={content} status={status} />
      </details>
    </article>
  );
}

function DigestBody({
  content,
  status,
  variant = "archive",
}: {
  content: string | null;
  status: "idle" | "loading" | "loaded" | "error";
  variant?: "today" | "archive";
}) {
  const isToday = variant === "today";

  if (status === "loading") {
    return (
      <div className="item-details" aria-live="polite" aria-busy="true">
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
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={
          isToday
            ? "text-sm text-[color:color-mix(in_oklch,var(--danger)_72%,white)]"
            : "item-details text-sm text-[var(--danger)]"
        }
        aria-live="polite"
      >
        Could not load digest.
      </div>
    );
  }

  return (
    <pre
      className={
        isToday
          ? "whitespace-pre-wrap font-sans text-[13.5px] leading-7 text-white/74 m-0"
          : "item-details whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--muted-strong)]"
      }
    >
      {content ?? ""}
    </pre>
  );
}

function formatDate(value: string, hydrated: boolean) {
  if (hydrated) return new Date(value).toLocaleDateString();
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
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
