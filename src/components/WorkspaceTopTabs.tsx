"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";

export type WorkspaceTopTabItem<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  href?: string;
  panelId?: string;
  tabId?: string;
};

type WorkspaceTopTabsProps<TValue extends string = string> = {
  ariaLabel: string;
  items: Array<WorkspaceTopTabItem<TValue>>;
  onSelect?: (value: TValue) => void;
  selectedValue: TValue;
};

export function WorkspaceTopTabs<TValue extends string>({
  ariaLabel,
  items,
  onSelect,
  selectedValue,
}: WorkspaceTopTabsProps<TValue>) {
  function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    const navigableKeys = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
    if (!navigableKeys.has(event.key)) return;

    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (tabs.length === 0) return;

    event.preventDefault();
    const selectedIndex = Math.max(0, items.findIndex((item) => item.value === selectedValue));
    const focusedIndex = tabs.findIndex((tab) => tab === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
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
    <div className="workspace-top-tabs-row">
      <div
        className="fb-segmented-tabs workspace-top-tabs"
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleTabKeyDown}
      >
        {items.map((item) => {
          const selected = selectedValue === item.value;
          const commonProps = {
            "aria-controls": item.panelId,
            "aria-selected": selected,
            className: "fb-btn compact",
            "data-active": selected ? "true" : undefined,
            id: item.tabId,
            role: "tab",
            tabIndex: selected ? 0 : -1,
          } as const;

          if (onSelect) {
            return (
              <button
                {...commonProps}
                key={item.value}
                onClick={() => onSelect(item.value)}
                type="button"
              >
                {item.label}
              </button>
            );
          }

          return (
            <Link
              {...commonProps}
              href={item.href ?? "#"}
              key={item.value}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
