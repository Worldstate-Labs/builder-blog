"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

export function RecommendationReasonsPopover({
  reasons,
}: {
  reasons: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

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

  if (reasons.length === 0) return null;

  return (
    <div className="fb-popover-anchor" ref={containerRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label="Why recommended"
        className="post-action-btn"
        onClick={() => setOpen((v) => !v)}
        title="Why recommended"
        type="button"
      >
        <Sparkles aria-hidden="true" className="post-action-popover-icon" />
      </button>
      {open && (
        <div className="fb-popover" id={popoverId} role="tooltip">
          <div className="fb-popover-row">
            <span className="fb-popover-label">Why recommended</span>
          </div>
          {reasons.map((reason) => (
            <div key={reason} className="fb-popover-row">
              <span>· {reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
