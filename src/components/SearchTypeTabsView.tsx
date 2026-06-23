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
  value: string;
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
  onSelect?: (value: string) => void;
  linkComponent?: SearchTypeTabLinkComponent;
};

export function SearchTypeTabsView({
  ariaLabel,
  controlsId,
  items,
  onSelect,
  linkComponent: LinkComponent = DefaultLink,
}: SearchTypeTabsViewProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const navigableKeys = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
    if (!navigableKeys.has(event.key)) return;

    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
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
    if (onSelect) {
      onSelect(items[nextIndex]!.value);
    }
  }

  return (
    <div
      aria-label={ariaLabel}
      className="fb-segmented-tabs filter-tabs"
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      {items.map((item) => {
        const commonProps = {
          "aria-controls": controlsId,
          "aria-label": item.ariaLabel,
          "aria-selected": item.active,
          className: "fb-btn compact",
          "data-active": item.active ? "true" : undefined,
          id: item.id,
          role: "tab",
          tabIndex: item.active ? 0 : -1,
        } as const;
        const content = (
          <>
            <span>{item.label}</span>
            {typeof item.count === "number" ? <CountBadge value={item.count} /> : null}
          </>
        );

        if (onSelect) {
          return (
            <button
              {...commonProps}
              key={item.id}
              onClick={() => onSelect(item.value)}
              type="button"
            >
              {content}
            </button>
          );
        }

        return (
          <LinkComponent
            {...commonProps}
            href={item.href}
            key={item.id}
          >
            {content}
          </LinkComponent>
        );
      })}
    </div>
  );
}
