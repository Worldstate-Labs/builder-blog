import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";

export function FeedLoadingState({ label }: { label: string }) {
  return (
    <div className="feed-content-stack">
      <div className="feed-skeleton-list" aria-live="polite" aria-busy="true">
        <div className="feed-skeleton-card" />
        <div className="feed-skeleton-card" />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

export function FeedEmptyState({
  actions,
  ariaLive,
  body,
  role,
  title,
  tone = "empty",
}: {
  actions?: ReactNode;
  ariaLive?: "polite" | "assertive";
  body?: string;
  role?: "alert";
  title: string;
  tone?: "empty" | "error";
}) {
  return (
    <div className="feed-content-stack">
      <EmptyState
        actions={actions}
        ariaLive={ariaLive}
        body={body}
        className="feed-state-panel"
        role={role}
        title={title}
        tone={tone}
      />
    </div>
  );
}
