"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
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
  const menuId = useId();
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

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
      <div className="digest-pipeline-static">
        <span className="digest-pipeline-title">{selectedPipeline.title}</span>
        <span className="digest-pipeline-meta">
          {pipelineOwnerLine(selectedPipeline)}
        </span>
      </div>
    );
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOpen(false);
    summaryRef.current?.focus();
  }

  return (
    <details
      className="digest-pipeline-selector"
      onKeyDown={handlePickerKeyDown}
      open={open}
      ref={pickerRef}
    >
      <summary
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="digest-pipeline-trigger"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        ref={summaryRef}
      >
        <span className="digest-pipeline-copy">
          <span className="digest-pipeline-title">{selectedPipeline.title}</span>
          <span className="digest-pipeline-meta">
            {pipelineOwnerLine(selectedPipeline)}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="digest-pipeline-icon" />
      </summary>
      <div
        aria-label="AI Digest choices"
        className="digest-pipeline-menu"
        id={menuId}
        role="listbox"
      >
        {options.map((pipeline) => {
          const active = pipeline.id === selectedPipelineId;
          const href = pipeline.isOwnPipeline
            ? "/dashboard?tab=ai-digest"
            : `/dashboard?tab=ai-digest&pipeline=${pipeline.id}`;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-selected={active}
              className="digest-pipeline-option"
              data-active={active ? "true" : undefined}
              href={href}
              key={pipeline.id}
              onClick={(event) => {
                setOpen(false);
                if (active) event.preventDefault();
              }}
              role="option"
            >
              <span className="digest-pipeline-title">{pipeline.title}</span>
              <span className="digest-pipeline-meta">
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
  return pipeline.isOwnPipeline ? "Your AI Digest" : pipeline.ownerLabel;
}
