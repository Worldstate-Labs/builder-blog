"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";

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
      <article className="feed-card">
        <div className="item-kicker">
          <span>Today digest</span>
          <span>{formatDate(digest.createdAt)}</span>
          <span>{digest.itemCount} items</span>
        </div>
        <h2 className="mt-3 text-xl font-semibold leading-snug">{digest.title}</h2>
        <DigestBody content={content} status={status} />
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
              <span>{formatDateTime(digest.createdAt)}</span>
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
}: {
  content: string | null;
  status: "idle" | "loading" | "loaded" | "error";
}) {
  if (status === "loading") {
    return (
      <div className="item-details" aria-live="polite" aria-busy="true">
        <span className="status-chip">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading digest
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="item-details text-sm text-[var(--danger)]" aria-live="polite">
        Could not load digest.
      </div>
    );
  }

  return (
    <pre className="item-details whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--muted-strong)]">
      {content ?? ""}
    </pre>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}
