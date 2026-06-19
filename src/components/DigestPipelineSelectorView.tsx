"use client";

import {
  type ComponentType,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";
import { UserName } from "@/components/UserName";

type PickerFocusDirection = "first" | "last" | "selected" | "next" | "previous";

const pickerNavigationKeys = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export type DigestPipelineSelectorOption = {
  id: string;
  title: string;
  ownerLabel: string;
  isOwnPipeline: boolean;
};

export type DigestPipelineLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  role?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  "aria-current"?: "page" | undefined;
  "aria-selected"?: boolean;
  "data-active"?: "true" | undefined;
};

export type DigestPipelineLinkComponent = ComponentType<DigestPipelineLinkProps>;

// Dependency-free default. The DigestPipelineSelector wrapper injects next/link
// to keep client-side navigation; Storybook / design-sync use this anchor.
function DefaultLink({ href, children, ...rest }: DigestPipelineLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export type DigestPipelineSelectorViewProps = {
  options: DigestPipelineSelectorOption[];
  selectedPipeline: DigestPipelineSelectorOption;
  selectedPipelineId: string;
  linkComponent?: DigestPipelineLinkComponent;
};

export function DigestPipelineSelectorView({
  options,
  selectedPipeline,
  selectedPipelineId,
  linkComponent: LinkComponent = DefaultLink,
}: DigestPipelineSelectorViewProps) {
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
          <PipelineOwnerLine pipeline={selectedPipeline} />
        </span>
      </div>
    );
  }

  function focusOption(direction: PickerFocusDirection) {
    const focusable = Array.from(
      pickerRef.current?.querySelectorAll<HTMLAnchorElement>(".digest-pipeline-option") ?? [],
    );
    if (focusable.length === 0) return;
    const activeIndex = focusable.findIndex((option) => option === document.activeElement);
    const selectedIndex = focusable.findIndex((option) => option.getAttribute("aria-selected") === "true");
    const baseIndex = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
    let nextIndex = baseIndex;
    if (direction === "first") {
      nextIndex = 0;
    } else if (direction === "last") {
      nextIndex = focusable.length - 1;
    } else if (direction === "next") {
      nextIndex = (baseIndex + 1) % focusable.length;
    } else if (direction === "previous") {
      nextIndex = (baseIndex - 1 + focusable.length) % focusable.length;
    }
    focusable[nextIndex]?.focus();
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
            <PipelineOwnerLine pipeline={selectedPipeline} />
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
            <LinkComponent
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
                <PipelineOwnerLine pipeline={pipeline} />
              </span>
            </LinkComponent>
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

function PipelineOwnerLine({ pipeline }: { pipeline: DigestPipelineSelectorOption }) {
  if (pipeline.isOwnPipeline) return "Your AI Digest collection";
  return <>Shared by <UserName>{pipeline.ownerLabel}</UserName></>;
}

function pipelineOwnerLine(pipeline: DigestPipelineSelectorOption) {
  return pipeline.isOwnPipeline ? "Your AI Digest collection" : `Shared by ${pipeline.ownerLabel}`;
}

function digestArchiveSourceLabel(pipeline: DigestPipelineSelectorOption) {
  return `${pipeline.title}, ${pipelineOwnerLine(pipeline)}`;
}
