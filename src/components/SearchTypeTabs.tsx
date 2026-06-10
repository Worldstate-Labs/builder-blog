"use client";

import Link from "next/link";
import type { KeyboardEvent } from "react";
import { CountBadge } from "@/components/Count";

export type SearchTypeTabItem = {
  active: boolean;
  ariaLabel: string;
  count: number | null;
  href: string;
  id: string;
  label: string;
};

export function SearchTypeTabs({
  ariaLabel,
  controlsId,
  items,
}: {
  ariaLabel: string;
  controlsId: string;
  items: SearchTypeTabItem[];
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const navigableKeys = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
    if (!navigableKeys.has(event.key)) return;

    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));
    if (tabs.length === 0) return;

    event.preventDefault();
    const activeIndex = Math.max(0, items.findIndex((item) => item.active));
    const focusedIndex = tabs.findIndex((tab) => tab === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : activeIndex;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;

    tabs[nextIndex]?.focus();
  }

  return (
    <div
      aria-label={ariaLabel}
      className="fb-segmented-tabs filter-tabs"
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      {items.map((item) => (
        <Link
          aria-controls={controlsId}
          aria-label={item.ariaLabel}
          aria-selected={item.active}
          className="fb-btn compact"
          data-active={item.active ? "true" : undefined}
          href={item.href}
          id={item.id}
          key={item.id}
          role="tab"
          tabIndex={item.active ? 0 : -1}
        >
          <span>{item.label}</span>
          {typeof item.count === "number" ? <CountBadge value={item.count} /> : null}
        </Link>
      ))}
    </div>
  );
}
