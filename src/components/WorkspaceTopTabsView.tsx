"use client";

import type { ComponentType, KeyboardEvent, ReactNode } from "react";

export type WorkspaceTopTabItem<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  href?: string;
  panelId?: string;
  tabId?: string;
};

export type WorkspaceTopTabLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: string;
  tabIndex?: number;
  "aria-controls"?: string;
  "aria-selected"?: boolean;
  "data-active"?: "true" | undefined;
};

export type WorkspaceTopTabLinkComponent = ComponentType<WorkspaceTopTabLinkProps>;

// Dependency-free default. The WorkspaceTopTabs wrapper injects next/link to
// keep client-side navigation; Storybook / design-sync render with this anchor.
function DefaultLink({ href, children, ...rest }: WorkspaceTopTabLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export type WorkspaceTopTabsViewProps<TValue extends string = string> = {
  ariaLabel: string;
  items: Array<WorkspaceTopTabItem<TValue>>;
  onSelect?: (value: TValue) => void;
  selectedValue: TValue;
  linkComponent?: WorkspaceTopTabLinkComponent;
};

export function WorkspaceTopTabsView<TValue extends string>({
  ariaLabel,
  items,
  onSelect,
  selectedValue,
  linkComponent: LinkComponent = DefaultLink,
}: WorkspaceTopTabsViewProps<TValue>) {
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
            <LinkComponent
              {...commonProps}
              href={item.href ?? "#"}
              key={item.value}
            >
              {item.label}
            </LinkComponent>
          );
        })}
      </div>
    </div>
  );
}
