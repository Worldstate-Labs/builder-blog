"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type PickerFocusDirection = "first" | "last" | "selected" | "next" | "previous";

const pickerNavigationKeys = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

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
  const selectedLabel = digestArchiveSourceLabel(selectedPipeline);

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
      <div
        aria-label={`AI Digest collection: ${selectedLabel}`}
        className="digest-pipeline-static"
      >
        <span className="digest-pipeline-title">{selectedPipeline.title}</span>
        <span className="digest-pipeline-meta">
          {pipelineOwnerLine(selectedPipeline)}
        </span>
      </div>
    );
  }

  function focusOption(direction: PickerFocusDirection) {
    const options = Array.from(
      pickerRef.current?.querySelectorAll<HTMLAnchorElement>(".digest-pipeline-option") ?? [],
    );
    if (options.length === 0) return;
    const activeIndex = options.findIndex((option) => option === document.activeElement);
    const selectedIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
    const baseIndex = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
    let nextIndex = baseIndex;
    if (direction === "first") {
      nextIndex = 0;
    } else if (direction === "last") {
      nextIndex = options.length - 1;
    } else if (direction === "next") {
      nextIndex = (baseIndex + 1) % options.length;
    } else if (direction === "previous") {
      nextIndex = (baseIndex - 1 + options.length) % options.length;
    }
    options[nextIndex]?.focus();
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      summaryRef.current?.focus();
      return;
    }

    if (!pickerNavigationKeys.has(event.key)) return;
    event.preventDefault();
    if (!open) {
      setOpen(true);
      window.requestAnimationFrame(() => {
        focusOption(initialFocusDirectionForKey(event.key));
      });
      return;
    }
    focusOption(focusDirectionForKey(event.key));
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
        aria-label={`Choose AI Digest collection, current: ${selectedLabel}`}
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
        aria-label="AI Digest collections"
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

function initialFocusDirectionForKey(key: string): PickerFocusDirection {
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return "selected";
}

function focusDirectionForKey(key: string): PickerFocusDirection {
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return key === "ArrowDown" ? "next" : "previous";
}

function pipelineOwnerLine(pipeline: DigestPipelineSelectorOption) {
  return pipeline.isOwnPipeline ? "Your AI Digest" : `Shared by ${pipeline.ownerLabel}`;
}

function digestArchiveSourceLabel(pipeline: DigestPipelineSelectorOption) {
  return `${pipeline.title}, ${pipelineOwnerLine(pipeline)}`;
}
