"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { useHydrated } from "@/components/ThemeToggle";

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
  const selectedDigest = digests.find((digest) => digest.id === selectedDigestId) ?? digests[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (!selectedDigest) return null;

  return (
    <details className="digest-picker" open={open} ref={pickerRef}>
      <summary
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="digest-picker-summary"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span className="sr-only">Saved AI Digests</span>
        <DigestPickerItem
          digest={selectedDigest}
          hydrated={hydrated}
          isLatest={selectedDigest.id === latestDigestId}
        />
        <ChevronDown aria-hidden="true" className="digest-picker-icon" />
      </summary>
      <div className="digest-picker-menu" id={menuId} role="listbox" aria-label="Saved AI Digests">
        {digests.map((digest) => {
          const selected = digest.id === selectedDigest.id;
          return (
            <Link
              aria-current={selected ? "true" : undefined}
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
