"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";

type ParsedFetchTool = {
  runtime: string | null;
  model: string | null;
  skill: string | null;
  detail: string | null;
  raw: string;
};

export function parseFetchTool(value: string | null): ParsedFetchTool {
  if (!value) return { runtime: null, model: null, skill: null, detail: null, raw: "" };

  // Format: "<runtime> (model <model>) <skill name>(<detail>)"
  // Example: "Codex Desktop (model gpt-5.5) FollowBrief skill fetcher (YouTube RSS + feed description)"
  const pattern = /^(.+?)\s+\(model\s+(.+?)\)\s+(.+?)(?:\s+\((.+)\))?$/;
  const match = value.match(pattern);

  if (!match) {
    return { runtime: null, model: null, skill: null, detail: null, raw: value };
  }

  return {
    runtime: match[1]?.trim() ?? null,
    model: match[2]?.trim() ?? null,
    skill: match[3]?.trim() ?? null,
    detail: match[4]?.trim() ?? null,
    raw: value,
  };
}

export function FetchMethodPopover({
  accessibleLabel = "Summary method",
  fetchTool,
  summarizedAt,
}: {
  accessibleLabel?: string;
  fetchTool: string | null;
  summarizedAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const parsed = parseFetchTool(fetchTool);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="fb-popover-anchor" ref={containerRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label={accessibleLabel}
        className="post-action-btn"
        onClick={() => setOpen((v) => !v)}
        title="Summary method"
        type="button"
      >
        <Info aria-hidden="true" className="post-action-popover-icon" />
      </button>
      {open && (
        <div className="fb-popover" id={popoverId} role="tooltip">
          {parsed.runtime || parsed.model || parsed.detail ? (
            <>
              {parsed.runtime ? (
                <div className="fb-popover-row">
                  <span className="fb-popover-label">Local Agent</span>
                  <span>{parsed.runtime}</span>
                </div>
              ) : null}
              {parsed.detail ? (
                <div className="fb-popover-row">
                  <span className="fb-popover-label">Source note</span>
                  <span>{parsed.detail}</span>
                </div>
              ) : null}
            </>
          ) : fetchTool ? (
            <div className="fb-popover-row">
              <span className="fb-popover-label">Method</span>
              <span>{parsed.raw}</span>
            </div>
          ) : null}
          {summarizedAt ? (
            <div className="fb-popover-row">
              <span className="fb-popover-label">Summarized</span>
              <RelativeTime value={summarizedAt} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
