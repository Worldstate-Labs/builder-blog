"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

type ParsedCrawlingTool = {
  runtime: string | null;
  model: string | null;
  skill: string | null;
  detail: string | null;
  raw: string;
};

export function parseCrawlingTool(value: string | null): ParsedCrawlingTool {
  if (!value) return { runtime: null, model: null, skill: null, detail: null, raw: "" };

  // Format: "<runtime> (model <model>) <skill name>(<detail>)"
  // Example: "Codex Desktop (model gpt-5.5) FollowBrief skill crawler (YouTube RSS + feed description)"
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

export function CrawlingMethodPopover({
  crawlingTool,
  summarizedAt,
}: {
  crawlingTool: string | null;
  summarizedAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const parsed = parseCrawlingTool(crawlingTool);
  const summarizedDate = summarizedAt
    ? new Date(summarizedAt).toLocaleDateString()
    : null;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="fb-popover-anchor" ref={containerRef}>
      <button
        aria-label="Summary method"
        className="post-action-btn"
        onClick={() => setOpen((v) => !v)}
        title="Summary method"
        type="button"
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <div className="fb-popover" role="tooltip">
          {parsed.runtime || parsed.model || parsed.detail ? (
            <>
              {parsed.runtime ? (
                <div className="fb-popover-row">
                  <span className="fb-popover-label">Agent runtime</span>
                  <span>{parsed.runtime}</span>
                </div>
              ) : null}
              {parsed.model ? (
                <div className="fb-popover-row">
                  <span className="fb-popover-label">Model</span>
                  <span>{parsed.model}</span>
                </div>
              ) : null}
              {parsed.detail ? (
                <div className="fb-popover-row">
                  <span className="fb-popover-label">Source detail</span>
                  <span>{parsed.detail}</span>
                </div>
              ) : null}
            </>
          ) : crawlingTool ? (
            <div className="fb-popover-row">
              <span className="fb-popover-label">Method</span>
              <span>{parsed.raw}</span>
            </div>
          ) : null}
          {summarizedDate ? (
            <div className="fb-popover-row">
              <span className="fb-popover-label">Summarized</span>
              <span>{summarizedDate}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
