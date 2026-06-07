"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type DigestPipelineSelectorOption = {
  id: string;
  title: string;
  ownerLabel: string;
  isOwnPipeline: boolean;
};

export function DigestPipelineSelector({
  options,
  selectedPipeline,
  selectedPipelineId,
}: {
  options: DigestPipelineSelectorOption[];
  selectedPipeline: DigestPipelineSelectorOption;
  selectedPipelineId: string;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (options.length <= 1) {
    return (
      <div className="grid min-h-10 min-w-0 gap-0.5 rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">
        <span className="min-w-0 truncate font-[800]">{selectedPipeline.title}</span>
        <span className="min-w-0 truncate text-xs font-[650] text-[var(--muted)]">
          {pipelineOwnerLine(selectedPipeline)}
        </span>
      </div>
    );
  }

  return (
    <details className="group relative min-w-0" open={open} ref={pickerRef}>
      <summary
        className="grid min-h-10 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-left text-sm text-[var(--ink)] shadow-[var(--shadow-soft)] transition hover:border-[var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="min-w-0 truncate font-[800]">{selectedPipeline.title}</span>
          <span className="min-w-0 truncate text-xs font-[650] text-[var(--muted)]">
            {pipelineOwnerLine(selectedPipeline)}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
      </summary>
      <div className="absolute left-0 right-0 z-20 mt-2 grid gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--paper)] p-1 shadow-[var(--shadow-pop)]">
        {options.map((pipeline) => {
          const active = pipeline.id === selectedPipelineId;
          const href = pipeline.isOwnPipeline
            ? "/dashboard?tab=ai-digest"
            : `/dashboard?tab=ai-digest&pipeline=${pipeline.id}`;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={[
                "grid min-w-0 gap-0.5 rounded-[6px] px-3 py-2 text-sm text-[var(--ink)] no-underline transition hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]",
                active ? "bg-[var(--accent-soft)] font-[850] text-[var(--accent-strong)]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              href={href}
              key={pipeline.id}
              onClick={(event) => {
                setOpen(false);
                if (active) event.preventDefault();
              }}
            >
              <span className="min-w-0 truncate">{pipeline.title}</span>
              <span className="min-w-0 truncate text-xs font-[650] text-[var(--muted)]">
                {pipelineOwnerLine(pipeline)}
              </span>
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function pipelineOwnerLine(pipeline: DigestPipelineSelectorOption) {
  return pipeline.isOwnPipeline ? "Your digest" : pipeline.ownerLabel;
}
