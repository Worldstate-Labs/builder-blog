"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { useHydrated } from "@/components/ThemeToggle";

type PickerFocusDirection = "first" | "last" | "selected" | "next" | "previous";

const pickerNavigationKeys = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export type DigestArchivePickerOption = {
  id: string;
  createdAt: string;
  itemCount: number;
};

export function DigestArchivePicker({
  digests,
  isOwnPipeline,
  latestDigestId,
  selectedDigestId,
  selectedPipelineId,
}: {
  digests: DigestArchivePickerOption[];
  isOwnPipeline: boolean;
  latestDigestId: string | null;
  selectedDigestId: string | null;
  selectedPipelineId: string;
}) {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();
  const menuId = useId();
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const selectedDigest = digests.find((digest) => digest.id === selectedDigestId) ?? digests[0];
  const selectedLabel = selectedDigest
    ? digestArchiveLabel({
        digest: selectedDigest,
        hydrated,
        isLatest: selectedDigest.id === latestDigestId,
      })
    : "";

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (!selectedDigest) return null;

  if (digests.length <= 1) {
    return (
      <div className="digest-picker-static" aria-label={`AI Digest issue: ${selectedLabel}`}>
        <DigestPickerItem
          digest={selectedDigest}
          hydrated={hydrated}
          isLatest={selectedDigest.id === latestDigestId}
        />
      </div>
    );
  }

  function focusOption(direction: PickerFocusDirection) {
    const options = Array.from(
      pickerRef.current?.querySelectorAll<HTMLAnchorElement>(".digest-picker-option") ?? [],
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
    <details className="digest-picker" onKeyDown={handlePickerKeyDown} open={open} ref={pickerRef}>
      <summary
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Choose AI Digest issue, current: ${selectedLabel}`}
        className="digest-picker-summary"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        ref={summaryRef}
      >
        <span className="sr-only">AI Digest issue</span>
        <DigestPickerItem
          digest={selectedDigest}
          hydrated={hydrated}
          isLatest={selectedDigest.id === latestDigestId}
        />
        <ChevronDown aria-hidden="true" className="digest-picker-icon" />
      </summary>
      <div className="digest-picker-menu" id={menuId} role="listbox" aria-label="AI Digest issues">
        {digests.map((digest) => {
          const selected = digest.id === selectedDigest.id;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              aria-selected={selected}
              className="digest-picker-option"
              href={digestHref({ digestId: digest.id, isOwnPipeline, selectedPipelineId })}
              key={digest.id}
              onClick={(event) => {
                setOpen(false);
                if (selected) event.preventDefault();
              }}
              role="option"
            >
              <DigestPickerItem
                digest={digest}
                hydrated={hydrated}
                isLatest={digest.id === latestDigestId}
              />
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

function DigestPickerItem({
  digest,
  hydrated,
  isLatest,
}: {
  digest: DigestArchivePickerOption;
  hydrated: boolean;
  isLatest: boolean;
}) {
  return (
    <span className="digest-picker-item">
      <span className="digest-picker-date">{formatDigestPickerDate(digest.createdAt, hydrated)}</span>
      <CountMeta label={digest.itemCount === 1 ? "post" : "posts"} value={digest.itemCount} />
      {isLatest ? <span className="digest-latest-mark">Latest</span> : null}
    </span>
  );
}

function digestArchiveLabel({
  digest,
  hydrated,
  isLatest,
}: {
  digest: DigestArchivePickerOption;
  hydrated: boolean;
  isLatest: boolean;
}) {
  const postLabel = `${digest.itemCount} ${digest.itemCount === 1 ? "post" : "posts"}`;
  return [
    formatDigestPickerDate(digest.createdAt, hydrated),
    postLabel,
    isLatest ? "Latest" : "",
  ].filter(Boolean).join(", ");
}

function digestHref({
  digestId,
  isOwnPipeline,
  selectedPipelineId,
}: {
  digestId: string;
  isOwnPipeline: boolean;
  selectedPipelineId: string;
}) {
  const params = new URLSearchParams({ tab: "ai-digest", digest: digestId });
  if (!isOwnPipeline) params.set("pipeline", selectedPipelineId);
  return `/dashboard?${params.toString()}`;
}

function formatDigestPickerDate(value: string, hydrated: boolean) {
  if (hydrated) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}
