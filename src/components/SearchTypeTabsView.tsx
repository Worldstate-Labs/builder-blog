"use client";

import type { ComponentType, KeyboardEvent, ReactNode } from "react";
import { CountBadge } from "@/components/Count";

export type SearchTypeTabItem = {
  active: boolean;
  ariaLabel: string;
  count: number | null;
  href: string;
  id: string;
  label: string;
};

export type SearchTypeTabLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: string;
  tabIndex?: number;
  "aria-controls"?: string;
  "aria-label"?: string;
  "aria-selected"?: boolean;
  "data-active"?: "true" | undefined;
};

export type SearchTypeTabLinkComponent = ComponentType<SearchTypeTabLinkProps>;

// Dependency-free default. The SearchTypeTabs wrapper injects next/link to keep
// client-side navigation; Storybook / design-sync render with this anchor.
function DefaultLink({ href, children, ...rest }: SearchTypeTabLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export type SearchTypeTabsViewProps = {
  ariaLabel: string;
  controlsId: string;
  items: SearchTypeTabItem[];
  linkComponent?: SearchTypeTabLinkComponent;
};

export function SearchTypeTabsView({
  ariaLabel,
  controlsId,
  items,
  linkComponent: LinkComponent = DefaultLink,
}: SearchTypeTabsViewProps) {
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
        <LinkComponent
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
        </LinkComponent>
      ))}
    </div>
  );
}
