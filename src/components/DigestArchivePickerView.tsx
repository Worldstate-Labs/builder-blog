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
import { CountMeta } from "@/components/Count";
import { RelativeTime, useNow } from "@/components/RelativeTime";
import { relativeTime } from "@/lib/relative-time";

type PickerFocusDirection = "first" | "last" | "selected" | "next" | "previous";

const pickerNavigationKeys = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export type DigestArchivePickerOption = {
  id: string;
  createdAt: string;
  itemCount: number;
};

export type DigestPickerLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  role?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  "aria-current"?: "page" | undefined;
  "aria-selected"?: boolean;
};

export type DigestPickerLinkComponent = ComponentType<DigestPickerLinkProps>;

// Dependency-free default. The DigestArchivePicker wrapper injects next/link to
// keep client-side navigation; Storybook / design-sync render with this anchor.
function DefaultLink({ href, children, ...rest }: DigestPickerLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export type DigestArchivePickerViewProps = {
  digests: DigestArchivePickerOption[];
  latestDigestId: string | null;
  selectedDigestId: string | null;
  selectedPipelineId: string;
  linkComponent?: DigestPickerLinkComponent;
};

export function DigestArchivePickerView({
  digests,
  latestDigestId,
  selectedDigestId,
  selectedPipelineId,
  linkComponent: LinkComponent = DefaultLink,
}: DigestArchivePickerViewProps) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const menuId = useId();
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const selectedDigest = digests.find((digest) => digest.id === selectedDigestId) ?? digests[0];
  const selectedLabel = selectedDigest
    ? digestArchiveLabel({
        digest: selectedDigest,
        now,
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
          isLatest={selectedDigest.id === latestDigestId}
        />
        <ChevronDown aria-hidden="true" className="digest-picker-icon" />
      </summary>
      <div className="digest-picker-menu" id={menuId} role="listbox" aria-label="AI Digest issues">
        {digests.map((digest) => {
          const selected = digest.id === selectedDigest.id;
          return (
            <LinkComponent
              aria-current={selected ? "page" : undefined}
              aria-selected={selected}
              className="digest-picker-option"
              href={digestHref({ digestId: digest.id, selectedPipelineId })}
              key={digest.id}
              onClick={(event) => {
                setOpen(false);
                if (selected) event.preventDefault();
              }}
              role="option"
            >
              <DigestPickerItem
                digest={digest}
                isLatest={digest.id === latestDigestId}
              />
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

function DigestPickerItem({
  digest,
  isLatest,
}: {
  digest: DigestArchivePickerOption;
  isLatest: boolean;
}) {
  return (
    <span className="digest-picker-item">
      <RelativeTime className="digest-picker-date" value={digest.createdAt} />
      <CountMeta label={digest.itemCount === 1 ? "post" : "posts"} value={digest.itemCount} />
      {isLatest ? <span className="digest-latest-mark">Latest</span> : null}
    </span>
  );
}

function digestArchiveLabel({
  digest,
  now,
  isLatest,
}: {
  digest: DigestArchivePickerOption;
  now: number | null;
  isLatest: boolean;
}) {
  const postLabel = `${digest.itemCount} ${digest.itemCount === 1 ? "post" : "posts"}`;
  return [
    relativeTime(digest.createdAt, now ?? Date.now()),
    postLabel,
    isLatest ? "Latest" : "",
  ].filter(Boolean).join(", ");
}

function digestHref({
  digestId,
  selectedPipelineId,
}: {
  digestId: string;
  selectedPipelineId: string;
}) {
  const params = new URLSearchParams({ tab: "ai-digest", digest: digestId });
  params.set("pipeline", selectedPipelineId);
  return `/dashboard?${params.toString()}`;
}
